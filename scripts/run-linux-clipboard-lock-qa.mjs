// Native Linux clipboard and Lock/Edit QA in a private profile.
// Required: MDLP_LINUX_QA_HOST, MDLP_LINUX_QA_KEY, MDLP_LINUX_QA_EXTENSION.
// Optional: MDLP_LINUX_CLIPBOARD_ARTIFACTS. No document edits use editor APIs.
// The arrow runner's EXECUTABLE, CLI and desktop DISPLAY options are supported.
// USE_CLI=1 keeps Xvfb alive; TOOL_PATH optionally provides user-space QA tools.
// WINDOW_MANAGER and WM_LIBRARY_PATH provide focus management inside Xvfb only.
// CALLOUT_LIST_QA=1 adds native list/callout editing and exact-save fixtures;
// ASSERT_CALLOUT_TITLES=1 also verifies that body edits retain styled titles.
// PASTE_SAVE_QA=1 adds external clipboard and save-durability cases on a private
// display; CLOSE_REPEATS=0..20 adds immediate-close stress cases.
// RAPID_MIXED_QA=1 adds large mixed-object notes with immediate file switching.
// WINDOW_RESTART_QA=1 closes and relaunches the entire private workbench.
// CALLOUT_OBJECT_QA=1 adds rendered mixed-object callout edits and exact saves.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = required('MDLP_LINUX_QA_HOST'), installed = required('MDLP_LINUX_QA_EXTENSION');
const executable = process.env.MDLP_LINUX_QA_EXECUTABLE ?? '/usr/share/code/code';
const cli = process.env.MDLP_LINUX_QA_CLI ?? '/usr/bin/code';
assert.ok(executable.startsWith('/') && cli.startsWith('/'));
assert.match(host, /^[A-Za-z0-9][A-Za-z0-9_.@:-]+$/);
assert.ok(installed.startsWith('/') && installed !== '/');
const sshOptions = ['-i', required('MDLP_LINUX_QA_KEY'), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10'];
const artifacts = resolve(root, '.vscode-test', process.env.MDLP_LINUX_CLIPBOARD_ARTIFACTS ?? 'linux-clipboard-lock-ui');
const caseFilter = process.env.MDLP_LINUX_QA_TEST_GREP ? new RegExp(process.env.MDLP_LINUX_QA_TEST_GREP) : undefined;
const windowRestartQA = process.env.MDLP_LINUX_WINDOW_RESTART_QA === '1';
if (windowRestartQA) {
  assert.equal(process.env.MDLP_LINUX_PASTE_SAVE_QA, '1');
  assert.notEqual(process.env.MDLP_LINUX_QA_DISPLAY_MODE, 'desktop', 'Window restart tests require a private desktop');
}
const local = await mkdtemp(join(tmpdir(), 'mdlp-linux-clipboard-'));
const unicode = 'Unicode clipboard fixture\nCaf\u00e9, na\u00efve, \u6771\u4eac, \ud83d\ude80\nFinal multiline record.';
const code = 'const message = "Clipboard \u03a9 \ud83d\ude80";\nconsole.log(message);';
const widgets = `Start mixed selection\n\n| Name | Value |\n| --- | --- |\n| Alpha bravo | Charlie delta |\n\nCODE_SECTION\n\n\`\`\`typescript\n${code}\n\`\`\`\n\n- [ ] Preserve task\n\n> [!note] Local note\n> Preserve the full callout.\n\nEnd mixed selection`;
const tableTarget = 'Before\n\n| Item | Count |\n| --- | --- |\n| Keep original | 2 |\n\nAfter';
const tableList = '<ul><li>Confirm **scope**.<ul><li>Review evidence.</li><li>Check gaps.</li></ul></li><li>Record decision.</li></ul>';
const tableListNote = `Before list table\n\n| Actions | Status |\n| --- | --- |\n| ${tableList} | Preserve neighbor |\n\nAfter list table`;
const initial = new Map([
  ['Unicode clipboard.md', unicode],
  ['Mixed widgets.md', widgets],
  ['Paste target.md', '# Clipboard paste target\n\nPASTE_HERE\n\nTSV_HERE\n\nPLAIN_HERE\n\nCODE_HERE\n\nUNLOCK_HERE\n'],
  ['Spreadsheet seed.md', 'Item\tQuantity\nApples\t3\nPears\t7\n'],
  ['External text seed.md', 'External'],
  ['Consecutive table paste.md', tableTarget],
  ['Immediate Tab paste.md', tableTarget],
  ['Pasted table replacement.md', 'Replace this entire synthetic note.'],
  ['Nested table lists.md', tableListNote],
]);
const expected = new Map(initial);
const paragraphCases = [];
if (process.env.MDLP_LINUX_CALLOUT_PARAGRAPH_QA === '1') {
  assert.equal(process.env.MDLP_LINUX_PASTE_SAVE_QA, '1');
  for (const size of [1000, 100000, 1000000, 2000000]) for (const quote of ['> ', '> > ']) {
    const name = `Paragraph paste ${size} ${quote.length}.md`;
    const text = `# Paragraph paste ${size} ${quote.length}\n\n${quote}[!note]+ Meeting\n${quote}TARGET\n\nOutside sentinel`;
    const payload = 'First paragraph Ω 🚀.\n\n' + 'Evidence and decisions retained. '.repeat(Math.ceil(size / 33)) + '\n\nFinal paragraph.';
    initial.set(name, text); expected.set(name, text); paragraphCases.push({ name, text, payload, quote });
  }
}
const calloutObjectCases = [];
if (process.env.MDLP_LINUX_CALLOUT_OBJECT_QA === '1') {
  assert.equal(process.env.MDLP_LINUX_PASTE_SAVE_QA, '1');
  const fixture = await readFile(join(root, 'test/fixtures/callout-qa/mixed-objects.md'), 'utf8');
  for (const type of ['warning', 'constructor', '__proto__']) {
    const name = `Callout objects ${type}.md`, title = `Mixed ${type}`;
    const text = fixture.replace('[!warning]+ Mixed objects', `[!${type}]+ ${title}`);
    initial.set(name, text); expected.set(name, text); calloutObjectCases.push({ name, title, text });
  }
}
// Mixed objects expose redraw/save races that prose-only padding cannot cover.
const rapidCases = [];
if (process.env.MDLP_LINUX_RAPID_MIXED_QA === '1') {
  assert.equal(process.env.MDLP_LINUX_PASTE_SAVE_QA, '1', 'Rapid mixed QA requires the native paste/save harness');
  for (const size of [120000, 300000, 450000]) {
    const name = `Rapid mixed ${size}.md`;
    const section = index => `## Meeting ${index}\n\n> [!note]+ Decisions ${index}\n> - Parent decision\n>     - [ ] Nested action\n> > [!warning] Risk\n> > Preserve evidence.\n\n| Owner | Status |\n| --- | --- |\n| Team ${index} | Pending |\n\n\`\`\`typescript\nconst meeting = ${index};\nconsole.log(meeting);\n\`\`\`\n\n\`\`\`mermaid\nflowchart LR\n A-->B\n B-->C\n\`\`\`\n\nMath $x^2$ and **decisions**, #meeting, 🚀.\n\n`;
    let body = `# Rapid mixed report ${size}\n\n`;
    for (let index = 0; body.length < size; index++) body += section(index);
    for (const position of ['TOP', 'MIDDLE', 'BOTTOM']) {
      const marker = `EDIT_${size}_${position}`;
      const offset = position === 'TOP' ? body.indexOf('## Meeting') : position === 'MIDDLE' ? body.indexOf('## Meeting', Math.floor(body.length / 2)) : body.length;
      body = body.slice(0, offset) + marker + '\n\n' + body.slice(offset);
      rapidCases.push({ name, marker });
    }
    initial.set(name, body); expected.set(name, body);
  }
}
const pasteSaveCases = [];
const externalPasteCases = [];
const closeCases = [];
const closeRepeats = Number(process.env.MDLP_LINUX_QA_CLOSE_REPEATS ?? 0);
assert.ok(Number.isSafeInteger(closeRepeats) && closeRepeats >= 0 && closeRepeats <= 20, 'Close-repeat count must be 0–20');
const pasteSaveText = 'Reviewed \u03a9 \ud83d\ude80';
if (process.env.MDLP_LINUX_PASTE_SAVE_QA === '1') {
  initial.set('Clipboard save seed.md', pasteSaveText); expected.set('Clipboard save seed.md', pasteSaveText);
  for (let index = 0; index < closeRepeats; index++) {
    const name = `Close race table ${index + 1}.md`;
    const text = '# Review\n\n| Owner | Status |\n| --- | --- |\n| Reviewed now | Preserve neighbor |\n\nEnd sentinel';
    initial.set(name, text); expected.set(name, text); closeCases.push({ name, text });
  }
  for (const size of [0, 120000, ...(windowRestartQA ? [450000] : [])]) for (const kind of ['callout', 'list', 'table', 'code']) {
    const padding = size ? '# Report history\n\n' + 'Retain previous meeting decisions and evidence.\n\n'.repeat(Math.ceil(size / 48)) : '';
    const object = {
      callout: '> [!warning]+ Review\n> - Owner: PASTE_TARGET\n> - [ ] Preserve task',
      list: '- Parent\n    - Owner: PASTE_TARGET\n    - Preserve sibling',
      table: '| Owner | Status |\n| --- | --- |\n| PASTE_TARGET | Preserve neighbor |',
      code: '```typescript\nconst owner = "PASTE_TARGET";\nconsole.log(owner);\n```',
    }[kind];
    const name = `Paste save ${kind} ${size}.md`, text = `${padding}# Current review\n\n${object}\n\nEnd sentinel`;
    initial.set(name, text); expected.set(name, text); pasteSaveCases.push({ name, kind, text });
    if (!size) {
      const externalName = `External paste ${kind}.md`;
      initial.set(externalName, text); expected.set(externalName, text);
      externalPasteCases.push({ name: externalName, kind, text });
    }
  }
}
// Optional native editing matrix; all edits use keyboard/mouse events, never editor dispatch.
const listCases = [];
const meetingCases = [];
if (process.env.MDLP_LINUX_CALLOUT_LIST_QA === '1') {
  for (const quote of ['', '> ', '> > ']) for (const indent of ['', '    ', '\t']) for (const marker of ['-', '*', '+', '- [ ]', '- [x]']) {
    const name = `Callout list ${String(listCases.length + 1).padStart(2, '0')}.md`;
    const text = `# Meeting notes\n\n${quote ? `${quote}[!note]+ Meeting\n` : ''}${indent ? `${quote}- Parent\n` : ''}${quote}${indent}${marker} First decision`;
    initial.set(name, text); expected.set(name, text);
    listCases.push({ name, quote, indent, marker, text });
  }
  for (const { type, quote } of [{ type: 'note', quote: '> ' }, { type: 'warning', quote: '> ' }, { type: 'abstract', quote: '> ' }, { type: 'nested-warning', quote: '> > ' }]) {
    const name = `Meeting callout ${type}.md`, title = `${type} meeting`;
    const text = `Intro\n\n${type === 'nested-warning' ? '> [!note]+ Outer meeting\n' : ''}${quote}[!${type === 'nested-warning' ? 'warning' : type}]+ ${title}`;
    initial.set(name, text); expected.set(name, text);
    meetingCases.push({ name, title, text, quote });
  }
}
const report = { startedAt: new Date().toISOString(), platform: 'linux', completed: false, passed: false, checks: [], skipped: [], failures: [], samples: [], files: [], pageErrors: [], consoleErrors: [], keys: 0, clipboardReads: 0 };
report.editorAssociationsSeeded = process.env.MDLP_LINUX_QA_EXPLICIT_ASSOCIATIONS !== '0';
let remote, processGroup, tunnel, browser, page, frame, current, display, authority;
await mkdir(artifacts, { recursive: true });

try {
  report.environment = (await ssh(`uname -a; ${q(cli)} --version`)).trim();
  report.platform = `linux-${(await ssh('uname -m')).trim()}`;
  remote = (await ssh('mktemp -d /tmp/mdlp-linux-clipboard-XXXXXX')).trim();
  assert.match(remote, /^\/tmp\/mdlp-linux-clipboard-[A-Za-z0-9]+$/);
  report.remoteTemporary = remote;
  await mkdir(join(local, 'profile/User'), { recursive: true });
  await mkdir(join(local, 'Clipboard QA Vault'));
  await mkdir(join(local, 'Clipboard QA Vault', 'Vault operations'));
  await writeFile(join(local, 'profile/User/settings.json'), JSON.stringify({
    'workbench.startupEditor': 'none', 'update.mode': 'none', 'telemetry.telemetryLevel': 'off',
    'window.dialogStyle': 'custom', 'files.autoSave': 'off', 'git.openRepositoryInParentFolders': 'never',
    'mdLivePreview.defaultEditor': 'livePreview', 'mdLivePreview.defaultEditingMode': 'editing',
    'mdLivePreview.autoSave': true, 'mdLivePreview.vault.openBehavior': 'newTab',
    // Only this disposable synthetic-data profile; restricted-mode behavior has
    // its own packaged smoke suite. Never change the NOC user's trust settings.
    ...(process.env.MDLP_LINUX_PASTE_SAVE_QA === '1' ? { 'security.workspace.trust.enabled': false } : {}),
    // Quick Open can precede the extension's asynchronous first-run settings sync.
    ...(process.env.MDLP_LINUX_QA_EXPLICIT_ASSOCIATIONS === '0' ? {} : {
      'workbench.editorAssociations': { '*.md': 'mdLivePreview.editor', '*.markdown': 'mdLivePreview.editor' },
    }),
  }, null, 2));
  for (const [name, text] of initial) await writeFile(join(local, 'Clipboard QA Vault', name), text);
  await command('scp', [...sshOptions, '-r', join(local, 'profile'), join(local, 'Clipboard QA Vault'), `${host}:${remote}/`]);
  await ssh(`mkdir ${q(`${remote}/extensions`)} && cp -a ${q(installed)} ${q(`${remote}/extensions/`)}`);
  report.extensionSha256 = (await ssh(`sha256sum ${q(`${installed}/dist/extension.js`)} ${q(`${installed}/dist/webview-editor.js`)}`)).trim();
  const remotePort = Number((await ssh("python3 -c 'import socket; s=socket.socket(); s.bind((\"127.0.0.1\",0)); print(s.getsockname()[1]); s.close()'")).trim());
  const args = [`${remote}/Clipboard QA Vault`, '--new-window', '--disable-updates', '--disable-telemetry', '--skip-welcome', '--skip-release-notes', `--user-data-dir=${remote}/profile`, `--extensions-dir=${remote}/extensions`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${remotePort}`];
  if (process.env.MDLP_LINUX_QA_USE_CLI === '1') args.push('--wait');
  const toolPath = process.env.MDLP_LINUX_QA_TOOL_PATH;
  if (toolPath) assert.ok(toolPath.startsWith('/') && !toolPath.includes(':'));
  const toolEnv = toolPath ? `env PATH=${q(toolPath + ':/usr/bin:/bin:/snap/bin')} ` : '';
  let launcher = "xvfb-run -a -s '-screen 0 1600x1000x24'";
  let sessionLauncher = 'dbus-run-session';
  if (process.env.MDLP_LINUX_QA_DISPLAY_MODE === 'desktop') {
    const desktopDisplay = required('MDLP_LINUX_QA_DISPLAY'), desktopAuthority = required('MDLP_LINUX_QA_XAUTHORITY'), runtime = required('MDLP_LINUX_QA_RUNTIME_DIR');
    assert.match(desktopDisplay, /^:\d+(?:\.\d+)?$/); assert.ok(desktopAuthority.startsWith('/') && runtime.startsWith('/'));
    launcher = `env DISPLAY=${q(desktopDisplay)} XAUTHORITY=${q(desktopAuthority)} XDG_RUNTIME_DIR=${q(runtime)} DBUS_SESSION_BUS_ADDRESS=${q('unix:path=' + runtime + '/bus')}`;
    sessionLauncher = '';
    report.displayMode = 'desktop';
  }
  const wm = process.env.MDLP_LINUX_QA_WINDOW_MANAGER, wmLibraries = process.env.MDLP_LINUX_QA_WM_LIBRARY_PATH;
  if (wm) assert.ok(wm.startsWith('/') && process.env.MDLP_LINUX_QA_DISPLAY_MODE !== 'desktop', 'QA window manager must use a private display');
  if (wmLibraries) assert.ok(wmLibraries.startsWith('/'));
  const wmLaunch = wm ? `${wmLibraries ? 'env LD_LIBRARY_PATH=' + q(wmLibraries) + ' ' : ''}${q(wm)} >${q(`${remote}/wm.log`)} 2>&1 & ` : '';
  const application = `${sessionLauncher} ${q(executable)} ${args.map(q).join(' ')}`;
  // Keep only the disposable X server alive across normal application exits.
  const launch = `printf '%s\\n%s\\n' "$DISPLAY" "$XAUTHORITY" > ${q(`${remote}/display.txt`)}; ${wmLaunch}${windowRestartQA ? application + '; sleep 3600' : 'exec ' + application}`;
  processGroup = Number((await ssh(`setsid ${toolEnv}${launcher} sh -c ${q(launch)} >${q(`${remote}/code.log`)} 2>&1 < /dev/null & printf '%s' "$!"`)).trim());
  assert.ok(Number.isSafeInteger(processGroup) && processGroup > 1);
  const port = await reservePort();
  tunnel = spawn('ssh', [...sshOptions, '-N', '-o', 'ExitOnForwardFailure=yes', '-L', `127.0.0.1:${port}:127.0.0.1:${remotePort}`, host], { stdio: 'ignore' });
  await wait(async () => { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 2000 }); return true; } catch { return false; } }, 'Linux workbench', 40000);
  [display, authority] = (await ssh(`cat ${q(`${remote}/display.txt`)}`)).trim().split('\n');
  assert.match(display, /^:\d+$/); assert.ok(authority.startsWith(process.env.MDLP_LINUX_QA_DISPLAY_MODE === 'desktop' ? '/run/user/' : '/tmp/'));
  report.clipboardDisplay = display;
  await wait(() => browser.contexts().flatMap(context => context.pages()).some(candidate => candidate.url().includes('workbench')), 'workbench page', 15000);
  page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().includes('workbench'));
  assert.ok(page); page.setDefaultTimeout(10000);
  report.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: devicePixelRatio }));
  page.on('pageerror', error => report.pageErrors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
    if (message.text().startsWith('MDLP_QA_TRACE ')) report.samples.push(JSON.parse(message.text().slice(14)));
  });
  await page.bringToFront();
  await trustSyntheticWorkspace();
  const vaultTab = page.getByRole('tab', { name: /Local Markdown Vault/ });
  if (await vaultTab.isVisible()) await vaultTab.click();
  else {
    await press('Control+Shift+p');
    await page.locator('.quick-input-widget:visible .quick-input-box input').fill('>Focus on Document Vault View');
    await page.locator('.quick-input-widget:visible .monaco-list-row').filter({ hasText: 'Focus on Document Vault View' }).first().click();
  }

  for (const item of paragraphCases) await check(`Callout paragraphs native ${item.name}`, async () => {
    await open(item.name); await find('TARGET');
    await externalClipboard(item.payload); await copied(item.payload);
    await press(item.quote.length > 2 ? 'Control+Shift+v' : 'Control+v'); await page.keyboard.type(' retained');
    const text = item.text.replace('TARGET', item.payload.replaceAll('\n', '\n' + item.quote) + ' retained');
    expected.set(current, text); await saved();
    await frame.locator('.cm-content').focus(); await press('Control+Home');
    const header = frame.getByRole('button', { name: 'Meeting callout', exact: true });
    await header.click(); assert.equal(await frame.locator('.cm-line', { hasText: 'Final paragraph.' }).count(), 0);
    await header.click(); await saved();
    await closeCurrentTab(); await open(item.name); await saved();
    await screenshot(`paragraph-paste-${item.payload.length}-${item.quote.length}`);
  });

  for (const item of calloutObjectCases) await check(`Callout objects native ${item.name}`, async () => {
    await open(item.name); await find('Final details.'); await press('ArrowRight'); await press('Shift+Enter');
    await page.keyboard.type('Decision retained xx'); await press('Backspace'); await press('Backspace');
    await page.keyboard.type('now');
    let text = item.text.replace('Final details.', 'Final details.\n> Decision retained now'); expected.set(current, text); await saved();
    await find('After the callout.'); await press('ArrowRight');
    await frame.locator('.mlp-checkbox').click(); text = text.replace('[ ] Review task', '[x] Review task'); expected.set(current, text); await saved();
    await frame.locator('.mlp-table td').first().click(); await press('Control+a');
    await page.keyboard.type('Reviewed'); text = text.replace('| Alpha |', '| Reviewed |'); expected.set(current, text);
    const header = frame.getByRole('button', { name: `${item.title} callout`, exact: true });
    await header.click(); await saved();
    assert.equal(await frame.locator('.mlp-table, .mlp-math, .mlp-drawio-wrap').count(), 0);
    await header.click();
    await wait(async () => await frame.locator('.mlp-drawio-wrap svg').count() === 1 && await frame.locator('.mlp-math-block math').count() === 1, 'expanded mixed objects');
    assert.equal(await frame.locator('.mlp-table td').first().innerText(), 'Reviewed');
    await frame.locator('.mlp-copy-code-btn').click();
    await copied('const first = 1;\nconst second = 2;\nconst third = 3;\nconst fourth = 4;\nconst fifth = 5;\nconst sixth = 6;\nconst seventh = 7;\nconsole.log(first, second, third);');
    await closeCurrentTab(); await open(item.name); await saved();
    await screenshot(`callout-objects-${item.title}`);
  });

  for (const item of listCases) await check(`Callout/list native ${JSON.stringify(item)}`, async () => {
    await open(item.name); await press('Control+End'); await press('Enter');
    const indent = item.indent === '\t' ? ' '.repeat(4 - item.quote.length % 4) : item.indent;
    const marker = item.marker === '- [x]' ? '- [ ]' : item.marker;
    let text = `${item.text}\n${item.quote}${indent}${marker} `;
    expected.set(current, text); await saved(); await aligned('empty sibling', 'First decision', '');
    await page.keyboard.type('Next decision', { delay: 35 }); text += 'Next decision';
    expected.set(current, text); await saved(); await aligned('typed sibling', 'First decision', 'Next decision');
    if (item.quote && process.env.MDLP_LINUX_QA_ASSERT_CALLOUT_TITLES === '1') {
      await frame.getByRole('button', { name: 'Meeting callout', exact: true }).waitFor({ state: 'visible' });
    }
    await press('Tab');
    const nested = text.slice(0, text.lastIndexOf('\n') + 1) + item.quote + '    ' + indent + marker + ' Next decision';
    expected.set(current, nested); await saved();
    await press('Shift+Tab'); expected.set(current, text); await saved();
    await aligned('outdented sibling', 'First decision', 'Next decision');
    // Navigate into the source prefix and back to the body without changing content.
    await press('Home'); await press('End'); await press('ArrowLeft'); await press('ArrowRight'); await unchanged('arrow navigation');
    await press('Enter'); await page.keyboard.type('Final action', { delay: 35 });
    const final = text + `\n${item.quote}${indent}${marker} Final action`;
    expected.set(current, final); await saved(); await aligned('third sibling', 'Next decision', 'Final action');
    await press('Shift+Home'); await press('Backspace'); await press('Backspace');
    expected.set(current, text); await saved();
    // Mouse placement and individual backspaces must keep the neighboring item intact.
    await frame.locator('.cm-line', { hasText: 'Next decision' }).click(); await press('End');
    for (let index = 0; index < 8; index++) await press('Backspace');
    await page.keyboard.type('revised', { delay: 35 });
    text = text.slice(0, -8) + 'revised'; expected.set(current, text); await saved();
    if (process.env.MDLP_LINUX_LIST_REPEAT_QA === '1') {
      // No save/geometry wait between Enter presses: catch cumulative drift.
      for (let index = 0; index < 8; index++) {
        await press('Enter'); await page.keyboard.type(`Repeated ${index}`);
        text += `\n${item.quote}${indent}${marker} Repeated ${index}`;
      }
      expected.set(current, text); await saved();
      await aligned('eighth repeated sibling', 'Repeated 0', 'Repeated 7');
    }
    await screenshot(item.name.replace('.md', ''));
  });
  for (const item of meetingCases) await check(`Callout/list meeting ${item.title}`, async () => {
    await open(item.name); await press('Control+End'); await press('Shift+Enter');
    let text = item.text + '\n' + item.quote;
    expected.set(current, text); await saved();
    await page.keyboard.type('- Review owners', { delay: 40 });
    text += '- Review owners'; expected.set(current, text); await saved();
    await press('Enter'); await page.keyboard.type('[ ] Confirm scope', { delay: 40 });
    text += `\n${item.quote}- [ ] Confirm scope`; expected.set(current, text); await saved();
    await press('Tab'); text = text.replace(`${item.quote}- [ ] Confirm scope`, `${item.quote}    - [ ] Confirm scope`);
    expected.set(current, text); await saved();
    await press('Shift+Tab'); text = text.replace(`${item.quote}    - [ ] Confirm scope`, `${item.quote}- [ ] Confirm scope`);
    expected.set(current, text); await saved();
    await press('Control+Home');
    const header = frame.getByRole('button', { name: `${item.title} callout`, exact: true });
    await header.click(); await wait(async () => await frame.getByRole('checkbox').count() === 0, 'folded callout task');
    await unchanged('folding'); await header.click();
    await frame.getByRole('checkbox').waitFor({ state: 'visible' });
    await frame.getByRole('checkbox').click(); text = text.replace('[ ] Confirm scope', '[x] Confirm scope');
    expected.set(current, text); await saved();
    await find('Confirm scope'); await press('ArrowRight');
    for (let index = 0; index < 5; index++) await press('Backspace');
    await page.keyboard.type('evidence', { delay: 40 }); text = text.replace('Confirm scope', 'Confirm evidence');
    expected.set(current, text); await saved();
    await screenshot(item.name.replace('.md', ''));
  });

  if (windowRestartQA) for (const item of pasteSaveCases.filter(item => item.kind !== 'list')) await check(`Window restart native ${item.name}`, async () => {
    await open(item.name);
    if (item.kind === 'table') {
      await find('End sentinel'); await press('ArrowRight');
      await frame.locator('.mlp-table td').first().click(); await press('Control+a');
    } else await find('PASTE_TARGET');
    await page.keyboard.type('Rapid meeting edit xx');
    await press('Backspace'); await press('Backspace');
    await page.keyboard.type('retained');
    expected.set(current, item.text.replace('PASTE_TARGET', 'Rapid meeting edit retained'));
    // Close the whole native window, with no pre-close save/source probe.
    await press('Control+Shift+w');
    await wait(async () => {
      if (page.isClosed()) return true;
      const save = page.getByRole('button', { name: 'Save', exact: true });
      if (await save.isVisible().catch(error => { if (page.isClosed()) return false; throw error; })) {
        report.windowSaveConfirmations = (report.windowSaveConfirmations ?? 0) + 1;
        await save.click();
      }
      return false;
    }, 'native window closed', 20000);
    frame = undefined;
    // Optional read-only forensic probe; disabled in zero-delay reopen qualification.
    if (process.env.MDLP_LINUX_QA_RESTART_FORENSICS === '1') {
    report.samples.push({ file: current, label: 'closed disk tail', text: (await disk()).slice(-220) });
    const probe = `import sqlite3,json,glob
def scan(x):
 if isinstance(x,dict):
  if 'baselineText' in x: print(json.dumps({k:(v[-220:] if isinstance(v,str) else v) for k,v in x.items()}))
  for v in x.values(): scan(v)
 elif isinstance(x,list):
  for v in x: scan(v)
 elif isinstance(x,str) and 'baselineText' in x:
  try: scan(json.loads(x))
  except: pass
for p in glob.glob(${JSON.stringify(`${remote}/profile/User/workspaceStorage/*/state.vscdb`)}):
 for k,v in sqlite3.connect(p).execute('select key,value from ItemTable'):
  if k == 'memento/workbench.parts.editor': scan(json.loads(v))`;
    report.samples.push({ file: current, label: 'closed recovery tails', text: await ssh(`python3 -c ${q(probe)}`) });
    }
    await ssh(`env DISPLAY=${q(display)} XAUTHORITY=${q(authority)} ${application} >>${q(`${remote}/code.log`)} 2>&1 < /dev/null &`);
    await wait(async () => {
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 2000 });
        page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().includes('workbench'));
        return Boolean(page);
      } catch { return false; }
    }, 'reopened native workbench', 40000);
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.pageErrors.push(String(error)));
    await page.bringToFront(); await trustSyntheticWorkspace();
    // A fresh workbench can restore Explorer rather than our contributed view.
    const vault = page.getByRole('tab', { name: /Local Markdown Vault/ });
    if (await vault.isVisible()) await vault.click();
    else {
      await press('Control+Shift+p');
      await page.locator('.quick-input-widget:visible .quick-input-box input').fill('>Focus on Document Vault View');
      await page.locator('.quick-input-widget:visible .monaco-list-row').filter({ hasText: 'Focus on Document Vault View' }).first().click();
    }
    await open(item.name); await saved(); await unchanged('window restart retains every edit');
    await screenshot(`window-restart-${item.kind}-${item.text.length}`);
  });

  for (const item of closeCases) await check(`Close race native ${item.name}`, async () => {
    await open(item.name); await find('Reviewed now'); await press('Control+c'); await copied('Reviewed now');
    await find('End sentinel'); await press('ArrowRight');
    await frame.locator('.mlp-table td').first().click(); await press('Control+a');
    await frame.evaluate(() => {
      document.addEventListener('keydown', event => {
        if (event.ctrlKey && event.key.toLowerCase() === 'w') {
          const view = document.querySelector('.cm-content').cmTile.root.view;
          console.log('MDLP_QA_TRACE ' + JSON.stringify({ label: 'close stress', source: view.state.doc.toString(), field: document.activeElement?.textContent }));
        }
      }, true);
    });
    await press('Control+v'); await page.keyboard.type(' CLOSED'); await closeCurrentTab();
    expected.set(current, item.text.replace('Reviewed now', 'Reviewed now CLOSED'));
    await open(item.name); await saved();
  });

  for (const [index, item] of rapidCases.entries()) await check(`Rapid mixed native ${item.marker}`, async () => {
    await open(item.name); await find(item.marker);
    const replacement = `Revised ${item.marker} Ω`;
    await page.keyboard.type(replacement + 'xx');
    await press('Backspace'); await press('Backspace');
    expected.set(current, expected.get(current).replace(item.marker, replacement));
    // Switch before any source/disk probe so navigation races remain observable.
    const other = rapidCases.find(candidate => candidate.name !== item.name);
    await open(other.name);
    await wait(async () => await disk(item.name) === expected.get(item.name), 'Rapid edit reaches the correct file after switch', 12000);
    await open(item.name); await saved(); await find(replacement);
    await press('Control+c'); await copied(replacement);
    await press('ArrowRight'); await press('End'); await press('Enter');
    await press('Control+v'); await page.keyboard.type(' copied');
    expected.set(current, expected.get(current).replace(replacement + '\n', replacement + '\n' + replacement + ' copied\n'));
    await open(other.name);
    const switchedAt = Date.now();
    await wait(async () => await disk(item.name) === expected.get(item.name), 'Native paste survives switching', 12000);
    report.samples.push({ file: item.name, label: 'remaining save latency after switch', elapsedMs: Date.now() - switchedAt });
    await open(item.name); await saved();
    if (index % 3 === 2) await screenshot(`rapid-mixed-${index}`);
  });

  for (const item of pasteSaveCases) await check(`Paste/save native ${item.name}`, async () => {
    await open('Clipboard save seed.md'); await press('Control+a'); await press('Control+c'); await copied(pasteSaveText);
    await open(item.name);
    if (item.kind === 'table') {
      await find('End sentinel'); await press('ArrowRight');
      await frame.locator('.mlp-table td').first().click(); await press('Control+a');
    } else await find('PASTE_TARGET');
    // Consecutive paste/typing goes straight to the focused editor or live cell.
    await press('Control+v'); await page.keyboard.type(' now');
    let text = item.text.replace('PASTE_TARGET', pasteSaveText + ' now'); expected.set(current, text);
    const started = Date.now(); await saved();
    report.samples.push({ file: current, label: 'paste/type save latency', elapsedMs: Date.now() - started });
    // Copy/cut must work in the same live cell/code/list context without a focus reset.
    if (item.kind === 'table') await press('Control+a');
    else await find(pasteSaveText + ' now');
    await press('Control+c'); await copied(pasteSaveText + ' now');
    await press('Control+x'); text = text.replace(pasteSaveText + ' now', ''); expected.set(current, text); await saved();
    await press('Control+v'); text = text.replace(item.kind === 'code' ? '""' : item.kind === 'table' ? '|  |' : 'Owner: ',
      item.kind === 'code' ? '"' + pasteSaveText + ' now"' : item.kind === 'table' ? '| ' + pasteSaveText + ' now |' : 'Owner: ' + pasteSaveText + ' now');
    expected.set(current, text); await saved();
    // Commit any table draft before testing the document's Undo/Redo history.
    if (item.kind === 'table') await press('Enter');
    await frame.locator('.cm-content').focus(); await press('Control+z');
    expected.set(current, item.text.replace('PASTE_TARGET', '')); await saved();
    await press('Control+y'); expected.set(current, text); await saved();
    if (item.kind === 'table') {
      await find('End sentinel'); await press('ArrowRight');
      await frame.locator('.mlp-table td').first().click(); await press('Control+a');
    } else await find(pasteSaveText + ' now');
    if (process.env.MDLP_LINUX_QA_TRACE_INPUT === '1') await frame.evaluate(() => {
      const trace = label => {
        const view = document.querySelector('.cm-content').cmTile.root.view;
        console.log('MDLP_QA_TRACE ' + JSON.stringify({ label, tail: view.state.doc.toString().slice(-240), active: document.activeElement?.className, field: document.activeElement?.textContent }));
      };
      document.addEventListener('input', () => queueMicrotask(() => trace('input')));
      document.addEventListener('keydown', event => { if (event.ctrlKey && event.key.toLowerCase() === 'w') trace('close'); }, true);
    });
    // Do not inspect the frame, source, or disk between paste and closing.
    await press('Control+v'); await page.keyboard.type(' CLOSED'); await closeCurrentTab();
    text = text.replace(pasteSaveText + ' now', pasteSaveText + ' now CLOSED'); expected.set(current, text);
    await open(item.name); await saved(); await unchanged('immediate-close paste has no delayed replay');
    await screenshot(item.name.replace('.md', ''));
  });

  for (const item of externalPasteCases) await check(`External paste/save native ${item.kind}`, async () => {
    const text = 'GTK external \u03a9 \ud83d\ude80';
    await externalClipboard(text); await copied(text); await open(item.name);
    if (item.kind === 'table') {
      await find('End sentinel'); await press('ArrowRight');
      await frame.locator('.mlp-table td').first().click(); await press('Control+a');
    } else await find('PASTE_TARGET');
    await press('Control+v'); await page.keyboard.type(' retained');
    expected.set(current, item.text.replace('PASTE_TARGET', text + ' retained')); await saved();
    if (item.kind === 'table') await press('Enter');
    await frame.locator('.cm-line', { hasText: /^End sentinel$/ }).click(); await press('End'); await press('Enter');
    await press('Control+Shift+V'); await page.keyboard.type(' plain'); await closeCurrentTab();
    expected.set(current, expected.get(current) + '\n' + text + ' plain');
    await open(item.name); await saved(); await unchanged('external clipboard close/reopen');
    await screenshot(item.name.replace('.md', ''));
  });

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
  await check('Nested table lists render and no-op F2 Enter returns to bullets without changing source', async () => {
    await open('Nested table lists.md');
    const cell = frame.locator('.mlp-table td').first();
    assert.equal(await cell.locator('ul.mlp-cell-list').count(), 2);
    assert.equal(await cell.locator('li.mlp-cell-list-item').count(), 4);
    assert.equal(await cell.locator('strong').innerText(), 'scope');
    assert.deepEqual(await cell.locator('ul').evaluateAll(lists => lists.map(list => getComputedStyle(list).listStyleType)), ['disc', 'circle']);
    await cell.focus(); await press('F2');
    assert.equal(await cell.innerText(), tableList);
    await press('Enter');
    await wait(async () => await cell.locator('li.mlp-cell-list-item').count() === 4
      && await cell.getAttribute('contenteditable') !== 'true', 'list cell returns to rendered bullets');
    await saved();
    await screenshot('nested-table-list-no-op');
  });
  await check('Editing a nested table list item preserves every other source byte and saves immediately', async () => {
    await open('Nested table lists.md');
    const cell = frame.locator('.mlp-table td').first();
    await cell.focus(); await press('F2');
    // Collapse the cell-wide selection and select one item's text using only keys.
    await press('ArrowLeft');
    const original = 'Review evidence.', replacement = 'Review verified evidence.';
    for (let index = 0; index < tableList.indexOf(original); index++) await press('ArrowRight');
    for (let index = 0; index < original.length; index++) await press('Shift+ArrowRight');
    assert.equal(await frame.evaluate(() => window.getSelection().toString()), original);
    await page.keyboard.type(replacement); await press('Enter');
    expected.set(current, tableListNote.replace(original, replacement));
    await saved();
    assert.equal(await cell.locator('li.mlp-cell-list-item').count(), 4);
    assert.equal(await cell.locator('ul ul > li').first().innerText(), replacement);
    assert.equal(await frame.locator('.mlp-table td').last().innerText(), 'Preserve neighbor');
    await screenshot('nested-table-list-edited');
  });
  await check('Vault UI creates, edits, renames and moves Unicode files and folders', async () => {
    const row = label => page.getByRole('treeitem', { name: label, exact: true });
    const menu = async (label, action) => {
      // Reveal virtualized root/folder rows through ordinary tree navigation.
      await press('Control+Shift+p');
      await page.locator('.quick-input-widget:visible .quick-input-box input').fill('>Focus on Document Vault View');
      await page.locator('.quick-input-widget:visible .monaco-list-row').filter({ hasText: 'Focus on Document Vault View' }).first().click();
      await press('Home');
      await row(label).click({ button: 'right' });
      await delay(250); // Let the menu-opening gesture finish before activating.
      const item = page.getByRole('menuitem').filter({ hasText: action });
      await item.click();
      if (await item.isVisible()) await press('Enter');
    };
    const input = async value => {
      const box = page.locator('.quick-input-widget:visible .quick-input-box input');
      await box.fill(value); await box.press('Enter');
      await page.locator('.quick-input-widget').waitFor({ state: 'hidden' });
    };
    const exists = async name => (await ssh(`[ -e ${q(`${remote}/Clipboard QA Vault/${name}`)} ] && printf 1 || printf 0`)) === '1';
    const expand = async label => {
      if (await row(label).getAttribute('aria-expanded') !== 'true') { await row(label).click(); await press('ArrowRight'); }
    };
    await menu('Folder: Vault operations', 'New Folder'); await input('Review drafts');
    await wait(() => exists('Vault operations/Review drafts'), 'new folder');
    await expand('Folder: Vault operations');
    await menu('Folder: Vault operations/Review drafts', 'New Note'); await input('Meeting');
    let name = 'Vault operations/Review drafts/Meeting.md';
    await wait(() => exists(name), 'new note');
    const original = await disk(name); initial.set(name, original); expected.set(name, original);
    await open(name, true); await press('Control+a');
    await page.keyboard.type('# Meeting review', { delay: 15 }); await press('Enter'); await press('Enter');
    await page.keyboard.type('> [!note]+ Notes', { delay: 15 }); await press('Shift+Enter');
    await page.keyboard.type('Confirm owner.', { delay: 15 });
    expected.set(name, '# Meeting review\n\n> [!note]+ Notes\n> Confirm owner.'); await saved();
    const rememberRename = next => {
      expected.set(next, expected.get(name)); initial.set(next, initial.get(name));
      expected.delete(name); initial.delete(name); name = next;
    };
    await expand('Folder: Vault operations/Review drafts');
    await menu(`File: ${name}`, 'Rename Vault Item'); await input('Meeting reviewed Ω.md');
    const renamed = 'Vault operations/Review drafts/Meeting reviewed Ω.md';
    await wait(() => exists(renamed), 'Unicode note rename'); assert.equal(await exists(name), false);
    rememberRename(renamed);
    await menu('Folder: Vault operations/Review drafts', 'Rename Vault Item'); await input('Archive');
    const archived = 'Vault operations/Archive/Meeting reviewed Ω.md';
    await wait(() => exists(archived), 'folder rename'); rememberRename(archived);
    await expand('Folder: Vault operations/Archive');
    await menu(`File: ${name}`, 'Move Vault Item');
    const picker = page.locator('.quick-input-widget:visible');
    await picker.locator('.quick-input-box input').fill('Vault operations');
    await picker.locator('.monaco-list-row').filter({ hasText: 'Vault operations' }).filter({ hasNotText: 'Archive' }).first().click();
    const moved = 'Vault operations/Meeting reviewed Ω.md';
    await wait(() => exists(moved), 'note move'); assert.equal(await exists(name), false);
    rememberRename(moved); await open(name); await saved();
  });
  assert.ok(report.checks.length > 0, 'No Linux QA cases completed successfully');
  for (const [name, text] of expected) {
    const actual = await disk(name);
    report.files.push({ name, initialSha256: hash(initial.get(name)), expectedSha256: hash(text), finalSha256: hash(actual), exactExpected: actual === text });
    await mkdir(dirname(join(artifacts, name)), { recursive: true });
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
  // Installed CLI launchers can detach. Close only this disposable profile.
  if (remote) await ssh(`python3 -c ${q(`import os,signal
target='--user-data-dir=${remote}/profile'
for item in os.listdir('/proc'):
 if not item.isdigit(): continue
 try:
  args=[part.decode() for part in open('/proc/'+item+'/cmdline','rb').read().split(bytes([0]))]
  if target in args or '${remote}/clipboard-owner' in args: os.kill(int(item),signal.SIGTERM)
 except (OSError,UnicodeError): pass`)} `).catch(() => {});
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
async function closeCurrentTab() {
  const tab = page.locator('.tabs-container .tab').filter({ hasText: basename(current) });
  assert.equal(await tab.count(), 1, `The exact native editor tab must exist before closing ${current}`);
  await press('Control+w'); // No pause or save probe before the tested close.
  // Do not open Quick Open while the previous Close command is still executing:
  // it can dismiss the picker and redirect its path text into another note.
  await wait(async () => {
    if (await tab.count() === 0) return true;
    const save = page.getByRole('button', { name: 'Save', exact: true });
    if (await save.isVisible()) {
      // A zero-delay Close can beat an in-flight automatic save. Preserve the
      // native safety prompt and choose Save, never Don't Save or Cancel.
      report.closeSaveConfirmations = (report.closeSaveConfirmations ?? 0) + 1;
      await save.click();
    }
    return false;
  }, `native tab closed: ${current}`, 15000);
}
async function state() { return frame.evaluate(() => document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()); }
async function disk(name = current) { return ssh(`cat ${q(`${remote}/Clipboard QA Vault/${name}`)}`); }
async function clipboard() {
  report.clipboardReads++;
  const script = 'import gi,json; gi.require_version("Gtk","3.0"); from gi.repository import Gtk,Gdk; Gtk.init([]); print(json.dumps(Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD).wait_for_text()))';
  // GTK prefers Wayland on Ubuntu even when DISPLAY names our private X server.
  // Force the same X11 backend as Electron so the probe never reads NOC's clipboard.
  return JSON.parse(await ssh(`env GDK_BACKEND=x11 DISPLAY=${q(display)} XAUTHORITY=${q(authority)} python3 -c ${q(script)}`));
}
async function externalClipboard(text) {
  assert.notEqual(process.env.MDLP_LINUX_QA_DISPLAY_MODE, 'desktop', 'External clipboard QA must not replace the NOC desktop clipboard');
  // A separate GTK process owns the X11 selection, like an external desktop app.
  // The unique argv token lets cleanup terminate only this QA clipboard owner.
  // Stage synthetic large payloads in our private directory, not shell argv.
  await writeFile(join(local, 'clipboard.txt'), text);
  await command('scp', [...sshOptions, join(local, 'clipboard.txt'), `${host}:${remote}/clipboard.txt`]);
  const script = 'import gi,pathlib; gi.require_version("Gtk","3.0"); from gi.repository import Gtk,Gdk; Gtk.init([]); c=Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD); c.set_text(pathlib.Path(' + JSON.stringify(`${remote}/clipboard.txt`) + ').read_text(),-1); Gtk.main()';
  await ssh(`env GDK_BACKEND=x11 DISPLAY=${q(display)} XAUTHORITY=${q(authority)} python3 -c ${q(script)} ${q(`${remote}/clipboard-owner`)} >${q(`${remote}/clipboard-owner.log`)} 2>&1 < /dev/null &`);
}
async function copied(text) { await wait(async () => await clipboard() === text, 'exact native clipboard'); }
async function saved() {
  await wait(async () => await state() === expected.get(current) && await disk() === expected.get(current), `exact saved source: ${current}`, 12000);
  report.samples.push({ file: current, expectedSha256: hash(expected.get(current)), diskSha256: hash(await disk()), sourceSha256: hash(await state()) });
}
async function unchanged(label) { await delay(250); assert.equal(await state(), expected.get(current), label); assert.equal(await disk(), expected.get(current), label); }
async function aligned(label, previousText, currentText) {
  await wait(async () => {
    const sample = await frame.evaluate(({ previousText, currentText }) => {
      const view = document.querySelector('.cm-content').cmTile.root.view;
      const doc = view.state.doc, last = doc.line(doc.lines), prior = doc.line(doc.lines - 1);
      const previous = view.coordsAtPos(prior.to - previousText.length);
      const next = view.coordsAtPos(last.to - currentText.length);
      const caret = view.coordsAtPos(view.state.selection.main.head);
      const bounds = view.scrollDOM.getBoundingClientRect();
      return { delta: previous && next ? Math.abs(previous.left - next.left) : Infinity,
        caretVisible: Boolean(caret && caret.top >= bounds.top - 1 && caret.bottom <= bounds.bottom + 1) };
    }, { previousText, currentText });
    report.samples.push({ file: current, label, ...sample });
    return sample.delta <= 1 && sample.caretVisible;
  }, `${label} alignment and visible caret`, 5000);
}
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
async function open(name, alreadyOpening = false) {
  current = name;
  frame = undefined; // Never treat a previous note's renderer as this file's draft.
  // Scroll virtualized native rows into view before opening the exact fixture.
  if (!alreadyOpening && process.env.MDLP_LINUX_PASTE_SAVE_QA === '1') {
    // Use the native Vault tree for this stress suite. Quick Open can lose focus
    // while VS Code completes a previous asynchronous close/preview operation.
    await page.getByRole('tree').first().focus(); await press('Home');
    const row = page.getByRole('treeitem', { name: `File: ${name}`, exact: true });
    let opened = false;
    for (let step = 0; step < 20; step++) {
      if (await row.count()) {
        try {
          await row.scrollIntoViewIfNeeded({ timeout: 1500 }); await row.click({ timeout: 1500 }); opened = true; break;
        } catch (error) {
          // A watcher refresh can recycle the virtualized row between lookup
          // and click. Retry navigation only, never an edit or save assertion.
          if (!/Timeout|detached|not attached/i.test(String(error))) throw error;
          report.treeRowRetries = (report.treeRowRetries ?? 0) + 1;
          await page.getByRole('tree').first().focus(); await press('Home');
          continue;
        }
      }
      const box = await page.getByRole('treeitem').first().boundingBox();
      assert.ok(box, 'Vault tree must be visible');
      await page.mouse.move(box.x + 80, Math.max(150, box.y + 40));
      await page.mouse.wheel(0, 250); await delay(100);
    }
    if (!opened) {
      // Metadata panes can shrink the virtualized tree during long matrices.
      // Fall back to native Quick Open, never typing the path into the editor.
      report.treeOpenFallbacks = (report.treeOpenFallbacks ?? 0) + 1;
      await press('Control+p');
      const input = page.locator('.quick-input-widget:visible .quick-input-box input');
      await input.waitFor({ state: 'visible' });
      await input.fill(`${remote}/Clipboard QA Vault/${name}`);
      await page.locator('.quick-input-widget:visible .monaco-list-row').filter({ hasText: basename(name) }).first().click();
    }
  } else if (!alreadyOpening) {
    await press('Escape'); await press('Control+p');
    const input = page.locator('.quick-input-widget:visible .quick-input-box input');
    // Closing a webview can briefly leave native focus on its detached frame.
    // The paste/close sequence above remains uninterrupted; retry only navigation.
    if (!await input.isVisible()) {
      await input.waitFor({ state: 'visible', timeout: 2000 }).catch(async () => {
        report.quickOpenRetries = (report.quickOpenRetries ?? 0) + 1;
        await page.bringToFront(); await press('Escape'); await press('Control+p');
      });
    }
    await input.fill(`${remote}/Clipboard QA Vault/${name}`);
    await page.locator('.quick-input-widget:visible .monaco-list-row').filter({ hasText: basename(name) }).first().click();
  }
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
  const manageTrust = page.getByText('Manage', { exact: true });
  await manageTrust.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  if (await manageTrust.isVisible()) {
    await manageTrust.click();
    if (!await page.getByText('You trust this folder', { exact: true }).isVisible()) await page.getByRole('button', { name: 'Trust', exact: true }).click();
    if (await trust.isVisible()) await trust.click();
    await page.getByText('You trust this folder', { exact: true }).waitFor({ state: 'visible' });
    await press('Control+w');
  }
  await press('Escape'); const modal = page.locator('.monaco-modal-editor-block');
  if (await modal.isVisible()) { await press('Control+w'); await modal.waitFor({ state: 'hidden' }); }
}
async function check(label, operation) {
  if (caseFilter && !caseFilter.test(label)) { report.skipped.push(label); return; }
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
