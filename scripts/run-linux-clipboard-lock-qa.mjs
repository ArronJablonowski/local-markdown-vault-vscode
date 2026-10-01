// Native Linux clipboard and Lock/Edit QA in a private Xvfb session.
// Required: MDLP_LINUX_QA_HOST, MDLP_LINUX_QA_KEY, MDLP_LINUX_QA_EXTENSION.
// Optional: MDLP_LINUX_CLIPBOARD_ARTIFACTS. No document edits use editor APIs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = required('MDLP_LINUX_QA_HOST'), installed = required('MDLP_LINUX_QA_EXTENSION');
assert.match(host, /^[A-Za-z0-9][A-Za-z0-9_.@:-]+$/);
assert.ok(installed.startsWith('/') && installed !== '/');
const sshOptions = ['-i', required('MDLP_LINUX_QA_KEY'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10'];
const artifacts = resolve(root, '.vscode-test', process.env.MDLP_LINUX_CLIPBOARD_ARTIFACTS ?? 'linux-clipboard-lock-ui');
const local = await mkdtemp(join(tmpdir(), 'mdlp-linux-clipboard-'));
const unicode = 'Unicode clipboard fixture\nCaf\u00e9, na\u00efve, \u6771\u4eac, \ud83d\ude80\nFinal multiline record.';
const code = 'const message = "Clipboard \u03a9 \ud83d\ude80";\nconsole.log(message);';
const widgets = `Start mixed selection\n\n| Name | Value |\n| --- | --- |\n| Alpha bravo | Charlie delta |\n\nCODE_SECTION\n\n\`\`\`typescript\n${code}\n\`\`\`\n\n- [ ] Preserve task\n\n> [!note] Local note\n> Preserve the full callout.\n\nEnd mixed selection`;
const tableTarget = 'Before\n\n| Item | Count |\n| --- | --- |\n| Keep original | 2 |\n\nAfter';
const initial = new Map([
  ['Unicode clipboard.md', unicode],
  ['Mixed widgets.md', widgets],
  ['Paste target.md', '# Clipboard paste target\n\nPASTE_HERE\n\nTSV_HERE\n\nPLAIN_HERE\n\nCODE_HERE\n\nUNLOCK_HERE\n'],
  ['Spreadsheet seed.md', 'Item\tQuantity\nApples\t3\nPears\t7\n'],
  ['External text seed.md', 'External'],
  ['Consecutive table paste.md', tableTarget],
  ['Immediate Tab paste.md', tableTarget],
  ['Pasted table replacement.md', 'Replace this entire synthetic note.'],
]);
const expected = new Map(initial);
const report = { startedAt: new Date().toISOString(), platform: 'linux-arm64', completed: false, passed: false, checks: [], failures: [], samples: [], files: [], pageErrors: [], consoleErrors: [], keys: 0, clipboardReads: 0 };
let remote, processGroup, tunnel, browser, page, frame, current, display, authority;
await mkdir(artifacts, { recursive: true });

try {
  report.environment = (await ssh('uname -a; /usr/bin/code --version')).trim();
  remote = (await ssh('mktemp -d /tmp/mdlp-linux-clipboard-XXXXXX')).trim();
  assert.match(remote, /^\/tmp\/mdlp-linux-clipboard-[A-Za-z0-9]+$/);
  report.remoteTemporary = remote;
  await mkdir(join(local, 'profile/User'), { recursive: true });
  await mkdir(join(local, 'Clipboard QA Vault'));
  await writeFile(join(local, 'profile/User/settings.json'), JSON.stringify({
    'workbench.startupEditor': 'none', 'update.mode': 'none', 'telemetry.telemetryLevel': 'off',
    'window.dialogStyle': 'custom', 'files.autoSave': 'off', 'git.openRepositoryInParentFolders': 'never',
    'mdLivePreview.defaultEditor': 'livePreview', 'mdLivePreview.defaultEditingMode': 'editing',
    'mdLivePreview.autoSave': true, 'mdLivePreview.vault.openBehavior': 'newTab',
  }, null, 2));
  for (const [name, text] of initial) await writeFile(join(local, 'Clipboard QA Vault', name), text);
  await command('scp', [...sshOptions, '-r', join(local, 'profile'), join(local, 'Clipboard QA Vault'), `${host}:${remote}/`]);
  await ssh(`mkdir ${q(`${remote}/extensions`)} && cp -a ${q(installed)} ${q(`${remote}/extensions/`)}`);
  report.extensionSha256 = (await ssh(`sha256sum ${q(`${installed}/dist/extension.js`)} ${q(`${installed}/dist/webview-editor.js`)}`)).trim();
  const remotePort = Number((await ssh("python3 -c 'import socket; s=socket.socket(); s.bind((\"127.0.0.1\",0)); print(s.getsockname()[1]); s.close()'")).trim());
  const args = [`${remote}/Clipboard QA Vault`, '--new-window', '--disable-updates', '--disable-telemetry', '--skip-welcome', '--skip-release-notes', `--user-data-dir=${remote}/profile`, `--extensions-dir=${remote}/extensions`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${remotePort}`];
  const launch = `printf '%s\\n%s\\n' "$DISPLAY" "$XAUTHORITY" > ${q(`${remote}/display.txt`)}; exec dbus-run-session /usr/share/code/code ${args.map(q).join(' ')}`;
  processGroup = Number((await ssh(`setsid xvfb-run -a -s '-screen 0 1600x1000x24' sh -c ${q(launch)} >${q(`${remote}/code.log`)} 2>&1 < /dev/null & printf '%s' "$!"`)).trim());
  assert.ok(Number.isSafeInteger(processGroup) && processGroup > 1);
  const port = await reservePort();
  tunnel = spawn('ssh', [...sshOptions, '-N', '-o', 'ExitOnForwardFailure=yes', '-L', `127.0.0.1:${port}:127.0.0.1:${remotePort}`, host], { stdio: 'ignore' });
  await wait(async () => { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 2000 }); return true; } catch { return false; } }, 'Linux workbench', 40000);
  [display, authority] = (await ssh(`cat ${q(`${remote}/display.txt`)}`)).trim().split('\n');
  assert.match(display, /^:\d+$/); assert.ok(authority.startsWith('/tmp/'));
  report.clipboardDisplay = display;
  page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().includes('workbench'));
  assert.ok(page); page.setDefaultTimeout(10000);
  page.on('pageerror', error => report.pageErrors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  await page.bringToFront();
  await trustSyntheticWorkspace();
  await page.getByRole('tab', { name: /Local Markdown Vault/ }).click();

  await check('Ctrl+C copies selected Unicode exactly', async () => {
    await open('Unicode clipboard.md'); await find('Caf\u00e9'); await press('Control+c');
    await copied('Caf\u00e9'); await saved();
  });
  await check('Ctrl+A and Ctrl+C copy multiline Unicode exactly', async () => {
    await frame.locator('.cm-content').focus(); await press('Control+a'); await press('Control+c');
    await copied(unicode); await saved();
  });
  await check('Ctrl+X cuts multiline Unicode and Ctrl+V restores every byte', async () => {
    await press('Control+x'); expected.set(current, ''); await copied(unicode); await saved();
    await press('Control+v'); expected.set(current, unicode); await saved();
  });
  await check('Paste undo and redo preserve the full Unicode document', async () => {
    await press('Control+z'); expected.set(current, ''); await saved();
    await press('Control+y'); expected.set(current, unicode); await saved();
  });
  await check('Native multiline clipboard replaces the selected destination only', async () => {
    await open('Paste target.md'); await find('PASTE_HERE'); await press('Control+v');
    expected.set(current, expected.get(current).replace('PASTE_HERE', unicode)); await saved();
  });
  await check('Selection across rendered table, code, task, and callout copies exact Markdown', async () => {
    await open('Mixed widgets.md'); await find('End mixed selection'); await press('ArrowRight');
    await press('Control+Home'); await press('Control+Shift+End'); await press('Control+c');
    await copied(widgets); await saved();
  });
  await check('Code copy button omits fences and preserves Unicode', async () => {
    await find('CODE_SECTION'); await press('ArrowLeft');
    await frame.getByRole('button', { name: 'Copy code block', exact: true }).click();
    await copied(code); await saved();
  });
  await check('Copied code pastes through the native clipboard without lost characters', async () => {
    await open('Paste target.md'); await find('CODE_HERE'); await press('Control+v');
    expected.set(current, expected.get(current).replace('CODE_HERE', code)); await saved();
  });
  await check('Native TSV clipboard becomes an exact Markdown table and undoes once', async () => {
    await open('Spreadsheet seed.md'); await frame.locator('.cm-content').focus(); await press('Control+a'); await press('Control+c');
    await copied(initial.get('Spreadsheet seed.md'));
    await open('Paste target.md'); const before = expected.get(current);
    await find('TSV_HERE'); await press('Control+v');
    expected.set(current, before.replace('TSV_HERE', '| Item | Quantity |\n| --- | --- |\n| Apples | 3 |\n| Pears | 7 |'));
    await saved(); await press('Control+z'); expected.set(current, before); await saved();
  });
  await check('Native Ctrl+Shift+V pastes once as plain text before immediate typing', async () => {
    const before = expected.get(current), text = initial.get('Spreadsheet seed.md');
    const typed = 'Immediate typing after plain paste.';
    await copied(text); await find('PLAIN_HERE');
    await frame.evaluate(() => {
      window.__linuxPlainPasteQA = { keys: [], paste: [] };
      document.addEventListener('keydown', event => {
        if (event.key.toLowerCase() === 'v') window.__linuxPlainPasteQA.keys.push({
          key: event.key, code: event.code, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, isTrusted: event.isTrusted,
        });
      }, true);
      document.addEventListener('paste', event => window.__linuxPlainPasteQA.paste.push({
        isTrusted: event.isTrusted, types: [...event.clipboardData.types], text: event.clipboardData.getData('text/plain'),
      }), true);
    });
    // Uppercase V sends the actual shifted key. Do not pause/read geometry/clipboard
    // between this native shortcut and typing: asynchronous replay must not reorder it.
    await press('Control+Shift+V');
    await page.keyboard.type(typed);
    expected.set(current, before.replace('PLAIN_HERE', text + typed));
    await saved();
    await delay(1500); await unchanged('plain paste has no delayed replay');
    const events = await frame.evaluate(() => window.__linuxPlainPasteQA);
    report.plainPaste = { events, delayedReplayCheckMs: 1500, sourceSha256: hash(await state()), diskSha256: hash(await disk()) };
    assert.ok(events.keys.some(event => event.key === 'V' && event.code === 'KeyV' && event.ctrlKey && event.shiftKey && event.isTrusted));
    assert.equal(events.paste.length, 1, 'exactly one native paste event');
    assert.equal(events.paste[0].isTrusted, true); assert.equal(events.paste[0].text, text);
    await screenshot('plain-paste-immediate-typing');
  });
  await check('Lock preserves keyboard selection and Copy across widgets', async () => {
    await open('Mixed widgets.md'); await setLocked(true);
    await frame.locator('.cm-content').focus(); await press('Control+a'); await press('Control+c');
    await copied(widgets); await saved();
  });
  await check('Locked typing, Paste, Cut, Backspace, Delete, and Enter cannot change source', async () => {
    await frame.locator('.cm-content').focus(); await press('Control+a');
    for (const key of ['x', 'Control+v', 'Control+Shift+V', 'Control+x', 'Backspace', 'Delete', 'Enter']) {
      await press(key); await unchanged(`locked ${key}`);
    }
  });
  await check('Locked checkbox clicks cannot mutate a task', async () => {
    await find('End mixed selection'); await press('ArrowRight');
    const checkbox = frame.locator('.mlp-checkbox').first();
    assert.equal(await checkbox.getAttribute('aria-checked'), 'false');
    const box = await checkbox.boundingBox(); assert.ok(box);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    assert.equal(await checkbox.getAttribute('aria-checked'), 'false');
    await unchanged('locked checkbox');
  });
  await check('Locked table cells cannot become editable or accept paste', async () => {
    const cell = frame.locator('.mlp-table td').first(); await cell.click();
    assert.notEqual(await cell.getAttribute('contenteditable'), 'true');
    await page.keyboard.type('BLOCKED TABLE'); await press('Control+v');
    await unchanged('locked table');
  });
  await check('Locked source reveal remains read-only', async () => {
    await frame.getByRole('button', { name: 'Show Markdown source', exact: true }).first().click();
    await page.keyboard.type('BLOCKED SOURCE'); await press('Control+v'); await press('Delete');
    await unchanged('locked source');
  });
  await check('Code copy button remains usable while locked', async () => {
    await find('CODE_SECTION'); await press('ArrowLeft');
    await frame.getByRole('button', { name: 'Copy code block', exact: true }).click();
    await copied(code); await unchanged('locked code copy');
  });
  await check('Unlock restores typing, native Paste, and exact saving', async () => {
    await setLocked(false); await find('End mixed selection'); await press('ArrowRight');
    await page.keyboard.type('\n\nUnlocked typing.\n'); await press('Control+v');
    expected.set(current, widgets + '\n\nUnlocked typing.\n' + code); await saved();
  });
  await check('Unlocked table edit saves while preserving all other source', async () => {
    await find('Start mixed selection'); await press('ArrowLeft');
    const cell = frame.locator('.mlp-table td').first(); await cell.click();
    assert.equal(await cell.getAttribute('contenteditable'), 'true');
    await press('Control+a'); await page.keyboard.type('Alpha verified'); await press('Enter');
    expected.set(current, expected.get(current).replace('| Alpha bravo |', '| Alpha verified |')); await saved();
  });
  await check('Unlocked checkbox edits save and undo without losing text', async () => {
    await find('End mixed selection'); await press('ArrowRight');
    const before = expected.get(current);
    await frame.locator('.mlp-checkbox').first().click();
    expected.set(current, before.replace('- [ ] Preserve task', '- [x] Preserve task')); await saved();
    await frame.locator('.cm-content').focus(); await press('Control+z');
    expected.set(current, before); await saved();
  });
  await check('Consecutive native text pastes remain in the same rendered table cell', async () => {
    await open('External text seed.md'); await press('Control+a'); await press('Control+c');
    const text = initial.get(current); await copied(text); await saved();
    await open('Consecutive table paste.md');
    await frame.locator('.mlp-table td').first().click(); await press('Control+a');
    // No refocus or locator wait between pastes: the live cell must keep ownership.
    await press('Control+v'); await press('Control+v');
    expected.set(current, tableTarget.replace('Keep original', text + text)); await saved();
    assert.equal(await frame.locator('.mlp-table-cell-editing').evaluate(cell => document.activeElement === cell), true);
    await delay(500); await unchanged('consecutive table paste has no delayed replay');
    await screenshot('consecutive-table-paste');
  });
  await check('Immediate Tab then typing and native Paste preserve the next cell draft', async () => {
    await open('External text seed.md'); await press('Control+a'); await press('Control+c');
    const text = initial.get(current); await copied(text); await saved();
    await open('Immediate Tab paste.md');
    await frame.locator('.mlp-table td').first().click(); await press('Control+a');
    await page.keyboard.type('Left');
    // Deliberately no frame, locator, source, clipboard, or disk read after Tab.
    await press('Tab'); await page.keyboard.type('Typed '); await press('Control+v');
    expected.set(current, tableTarget.replace('| Keep original | 2 |', `| Left | Typed ${text} |`)); await saved();
    const active = await frame.evaluate(() => ({ row: document.activeElement?.getAttribute('data-mlp-row'), col: document.activeElement?.getAttribute('data-mlp-col') }));
    assert.deepEqual(active, { row: '1', col: '1' });
    await delay(500); await unchanged('Tab typing and paste have no delayed replay');
    await screenshot('immediate-tab-type-paste');
  });
  await check('Select All replacing a native-pasted TSV table keeps the first typed character', async () => {
    await open('Spreadsheet seed.md'); await press('Control+a'); await press('Control+c');
    await copied(initial.get(current)); await saved();
    await open('Pasted table replacement.md');
    const grid = '| Item | Quantity |\n| --- | --- |\n| Apples | 3 |\n| Pears | 7 |\n\n';
    const replacement = 'External selection to replace';
    for (let attempt = 0; attempt < 5; attempt++) {
      await frame.locator('.cm-content').focus(); await press('Control+a'); await press('Control+v');
      expected.set(current, grid); await saved();
      assert.equal(await frame.locator('.mlp-table').count(), 1, 'TSV paste rendered a table');
      await frame.locator('.cm-content').focus();
      await press('Control+a'); await page.keyboard.type(replacement);
      expected.set(current, replacement); await saved();
    }
    report.tableReplacementRounds = 5;
    await delay(500); await unchanged('typed replacement has no delayed replay');
    await screenshot('pasted-table-typed-replacement');
  });
  for (const [name, text] of expected) {
    const actual = await disk(name);
    report.files.push({ name, initialSha256: hash(initial.get(name)), expectedSha256: hash(text), finalSha256: hash(actual), exactExpected: actual === text });
    await writeFile(join(artifacts, name), actual);
    assert.equal(actual, text, `Final source mismatch: ${name}`);
  }
  report.completed = true; report.passed = report.failures.length === 0 && report.pageErrors.length === 0;
} catch (error) {
  report.failures.push({ stage: 'session', error: String(error), stack: error.stack });
  await screenshot('session-failure').catch(() => {});
  if (page) await writeFile(join(artifacts, 'session-failure-dom.txt'), await page.locator('body').innerText().catch(String));
  console.error(error);
} finally {
  if (remote) await writeFile(join(artifacts, 'linux-code.log'), await ssh(`cat ${q(`${remote}/code.log`)}`).catch(String));
  if (processGroup) await ssh(`kill -TERM -- -${processGroup}`).catch(() => {});
  await browser?.close().catch(() => {}); tunnel?.kill();
  if (report.passed && remote) { await ssh(`rm -r -- ${q(remote)}`).catch(error => { report.cleanupError = String(error); }); }
  report.finishedAt = new Date().toISOString();
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  await rm(local, { recursive: true, force: true });
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failures: report.failures.length, keys: report.keys, clipboardReads: report.clipboardReads, artifacts }));
  if (!report.passed) process.exitCode = 1;
}

function required(name) { const value = process.env[name]; assert.ok(value, `Set ${name} explicitly`); return value; }
function q(value) { return `'${String(value).replaceAll("'", "'\\''")}'`; }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
async function command(binary, args) {
  const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] }), out = [], errors = [];
  child.stdout.on('data', data => out.push(data)); child.stderr.on('data', data => errors.push(data));
  await new Promise((done, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? done() : reject(new Error(`${binary} exited ${code}: ${Buffer.concat(errors)}`))); });
  return Buffer.concat(out).toString();
}
async function ssh(script) { return command('ssh', [...sshOptions, host, script]); }
async function press(key) { report.keys++; await page.keyboard.press(key); }
async function state() { return frame.evaluate(() => document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()); }
async function disk(name = current) { return ssh(`cat ${q(`${remote}/Clipboard QA Vault/${name}`)}`); }
async function clipboard() {
  report.clipboardReads++;
  const script = 'import gi,json; gi.require_version("Gtk","3.0"); from gi.repository import Gtk,Gdk; Gtk.init([]); print(json.dumps(Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text()))';
  return JSON.parse(await ssh(`env DISPLAY=${q(display)} XAUTHORITY=${q(authority)} python3 -c ${q(script)}`));
}
async function copied(text) { await wait(async () => await clipboard() === text, 'exact native clipboard'); }
async function saved() {
  await wait(async () => await state() === expected.get(current) && await disk() === expected.get(current), `exact saved source: ${current}`, 12000);
  report.samples.push({ file: current, expectedSha256: hash(expected.get(current)), diskSha256: hash(await disk()), sourceSha256: hash(await state()) });
}
async function unchanged(label) { await delay(250); assert.equal(await state(), expected.get(current), label); assert.equal(await disk(), expected.get(current), label); }
async function setLocked(value) {
  const toggle = frame.locator('.mlp-editing-mode-toggle');
  if (await toggle.getAttribute('aria-pressed') !== String(value)) await toggle.click();
  assert.equal(await toggle.getAttribute('aria-pressed'), String(value));
  assert.equal(await frame.locator('.cm-content').evaluate(node => node.isContentEditable), !value);
}
async function find(text) {
  await frame.locator('.cm-content').focus(); await press('Control+f');
  await frame.locator('.cm-search input[name="search"]').fill(text); await press('Enter'); await press('Escape');
  assert.equal(await frame.evaluate(() => { const s = document.querySelector('.cm-content').cmTile.root.view.state; return s.sliceDoc(s.selection.main.from, s.selection.main.to); }), text);
}
async function open(name) {
  current = name;
  // The native vault tree virtualizes rows when the fixture set grows. Open
  // the exact synthetic path through Quick Open, independent of sidebar height.
  await press('Control+p');
  await page.locator('.quick-input-widget:visible .quick-input-box input').fill(`${remote}/Clipboard QA Vault/${name}`);
  await page.locator('.quick-input-widget:visible .monaco-list-row').filter({ hasText: name }).first().click();
  await wait(async () => {
    for (const candidate of page.frames()) {
      if (candidate.isDetached() || !await candidate.locator('.cm-content').count()) continue;
      if (await candidate.evaluate(text => document.visibilityState === 'visible' && document.querySelector('.cm-content').cmTile.root.view.state.doc.toString() === text, expected.get(name))) { frame = candidate; return true; }
    }
    return false;
  }, `open ${name}`, 20000);
  await frame.locator('.cm-content').focus();
}
async function trustSyntheticWorkspace() {
  const trust = page.getByRole('button', { name: /Yes, I trust the authors/ });
  await trust.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await trust.isVisible()) await trust.click();
  if (await page.getByText('Restricted Mode', { exact: true }).count()) {
    await press('Control+Shift+p'); await page.locator('.quick-input-widget:visible .quick-input-box input').fill('>Workspaces: Manage Workspace Trust');
    await page.locator('.quick-input-widget:visible .monaco-list-row').filter({ hasText: 'Manage Workspace Trust' }).first().click();
    await page.getByRole('button', { name: 'Trust', exact: true }).click();
    if (await trust.isVisible()) await trust.click();
    await page.getByText('You trust this folder', { exact: true }).waitFor({ state: 'visible' });
  }
  await press('Escape'); const modal = page.locator('.monaco-modal-editor-block');
  if (await modal.isVisible()) { await press('Control+w'); await modal.waitFor({ state: 'hidden' }); }
}
async function check(label, operation) {
  try { await operation(); report.checks.push(label); console.log(`PASS ${label}`); }
  catch (error) {
    report.failures.push({ label, file: current, error: String(error), stack: error.stack, actualSource: frame && await state().catch(() => undefined), expectedSource: expected.get(current), actualDisk: current && await disk().catch(() => undefined), clipboard: display && await clipboard().catch(() => undefined) });
    await screenshot(`failure-${report.failures.length}`).catch(() => {});
    console.error(`FAIL ${label}: ${error}`);
    await press('Escape').catch(() => {});
    if (frame && current) expected.set(current, await state());
  }
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
}
async function screenshot(name) { if (page) await page.screenshot({ path: join(artifacts, `${name}.png`) }); }
async function wait(condition, label, timeout = 10000) { const until = Date.now() + timeout; while (Date.now() < until) { if (await condition()) return; await delay(100); } throw new Error(`Timed out: ${label}`); }
async function reservePort() { const server = createServer(); await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); }); const port = server.address().port; await new Promise(done => server.close(done)); return port; }
