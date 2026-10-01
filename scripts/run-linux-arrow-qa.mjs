// Drives installed Linux ARM64 VS Code over an SSH-forwarded loopback CDP port.
// Synthetic notes and an isolated profile are disposable. Editor probes only read.
// Required: MDLP_LINUX_QA_HOST, MDLP_LINUX_QA_KEY, MDLP_LINUX_QA_EXTENSION.
// Optional: MDLP_LINUX_QA_ARTIFACTS, MDLP_LINUX_QA_SIZES (comma-separated bytes),
// MDLP_LINUX_QA_DIRECTIONS (down,up,right,left), MDLP_LINUX_QA_KINDS (object names),
// MDLP_LINUX_QA_VSIX (remote archive path), MDLP_LINUX_QA_KEEP_REMOTE=1,
// MDLP_LINUX_QA_DOM_FIRST=1 (passive frame/DOM probes before CodeMirror geometry).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = required('MDLP_LINUX_QA_HOST');
const sshOptions = ['-i', required('MDLP_LINUX_QA_KEY'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2'];
const installed = required('MDLP_LINUX_QA_EXTENSION');
assert.match(host, /^[A-Za-z0-9][A-Za-z0-9_.@:-]+$/);
assert.ok(installed.startsWith('/') && installed !== '/', 'Extension path must name an absolute extension directory');
const sizes = (process.env.MDLP_LINUX_QA_SIZES ?? '120000,300000,490000').split(',').map(Number);
assert.ok(sizes.length > 0 && sizes.every(size => Number.isSafeInteger(size) && size > 10000 && size <= 2000000), 'Invalid synthetic note sizes');
const directions = (process.env.MDLP_LINUX_QA_DIRECTIONS ?? 'down,up,right,left').split(',');
assert.ok(directions.length > 0 && directions.every(direction => ['down', 'up', 'right', 'left'].includes(direction)), 'Invalid arrow directions');
const artifacts = resolve(root, '.vscode-test', process.env.MDLP_LINUX_QA_ARTIFACTS ?? 'linux-arrow-ui');
const local = await mkdtemp(join(tmpdir(), 'mdlp-linux-arrow-'));
const report = { startedAt: new Date().toISOString(), platform: 'linux-arm64', completed: false, passed: false, checks: [], failures: [], files: [], samples: [], caretSamples: [], consoleErrors: [], pageErrors: [], keyPresses: 0, arrowPresses: 0 };
const kinds = ['TABLE', 'CODE', 'INDENTED', 'ER', 'FLOW', 'DRAWIO', 'CALLOUT', 'MATH', 'LIST', 'QUOTE', 'IMAGE'];
const testedKinds = process.env.MDLP_LINUX_QA_KINDS?.split(',') ?? kinds;
assert.ok(testedKinds.every(kind => kinds.includes(kind)), 'Invalid object kind');
let remote, processGroup, tunnel, browser, page, frame, source, file;
await mkdir(artifacts, { recursive: true });

try {
  report.environment = (await ssh('uname -a; /usr/bin/code --version')).trim();
  remote = (await ssh('mktemp -d /tmp/mdlp-linux-arrow-XXXXXX')).trim();
  assert.match(remote, /^\/tmp\/mdlp-linux-arrow-[A-Za-z0-9]+$/);
  report.remoteTemporary = remote;
  await mkdir(join(local, 'profile/User'), { recursive: true });
  await mkdir(join(local, 'Arrow QA Vault'), { recursive: true });
  await writeFile(join(local, 'profile/User/settings.json'), JSON.stringify({
    'workbench.startupEditor': 'none', 'update.mode': 'none', 'telemetry.telemetryLevel': 'off',
    'window.dialogStyle': 'custom', 'window.menuStyle': 'custom', 'files.autoSave': 'off',
    'git.openRepositoryInParentFolders': 'never', 'mdLivePreview.defaultEditor': 'livePreview',
    'mdLivePreview.defaultEditingMode': 'editing', 'mdLivePreview.vault.openBehavior': 'newTab',
    'mdLivePreview.showWhitespace': 'off', 'mdLivePreview.stickyTableHeaders': false,
  }, null, 2));
  for (const [i, size] of sizes.entries()) {
    const text = makeNote(i + 1, size), name = `Linux arrow report ${i + 1}.md`;
    await writeFile(join(local, 'Arrow QA Vault', name), text);
    report.files.push({ name, bytes: Buffer.byteLength(text), lines: text.split('\n').length, initialSha256: hash(text) });
  }
  await writeFile(join(local, 'Arrow QA Vault/pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
  await command('scp', [...sshOptions, '-r', join(local, 'profile'), join(local, 'Arrow QA Vault'), `${host}:${remote}/`]);
  await ssh(`mkdir ${quote(`${remote}/extensions`)} && cp -a ${quote(installed)} ${quote(`${remote}/extensions/`)}`);
  report.extensionSha256 = (await ssh(`sha256sum ${quote(`${installed}/dist/extension.js`)}`)).trim();
  report.webviewSha256 = (await ssh(`sha256sum ${quote(`${installed}/dist/webview-editor.js`)}`)).trim();
  if (process.env.MDLP_LINUX_QA_VSIX) report.vsixSha256 = (await ssh(`sha256sum ${quote(process.env.MDLP_LINUX_QA_VSIX)}`)).trim();
  const remotePort = Number((await ssh("python3 -c 'import socket; s=socket.socket(); s.bind((\"127.0.0.1\",0)); print(s.getsockname()[1]); s.close()'")).trim());
  assert.ok(remotePort > 1024 && remotePort < 65536);
  const args = [join(remote, 'Arrow QA Vault'), '--new-window', '--disable-updates', '--disable-telemetry', '--skip-welcome', '--skip-release-notes', `--user-data-dir=${remote}/profile`, `--extensions-dir=${remote}/extensions`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${remotePort}`];
  processGroup = Number((await ssh(`setsid xvfb-run -a -s '-screen 0 1600x1000x24' dbus-run-session /usr/share/code/code ${args.map(quote).join(' ')} >${quote(`${remote}/code.log`)} 2>&1 < /dev/null & printf '%s' "$!"`)).trim());
  assert.ok(Number.isSafeInteger(processGroup) && processGroup > 1);
  const port = await reservePort();
  tunnel = spawn('ssh', [...sshOptions, '-N', '-o', 'ExitOnForwardFailure=yes', '-L', `127.0.0.1:${port}:127.0.0.1:${remotePort}`, host], { stdio: 'ignore' });
  await wait(async () => {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 2000 }); return true; }
    catch { return false; }
  }, 'sandboxed Linux VS Code debug endpoint', 40000);
  await wait(() => browser.contexts().flatMap(c => c.pages()).length > 0, 'workbench page');
  page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('workbench')) ?? browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => report.pageErrors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ text: message.text(), location: message.location() }); });
  await page.bringToFront();
  const trust = page.getByRole('button', { name: /Yes, I trust the authors/ });
  await trust.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await trust.isVisible()) await trust.click();
  if (await page.getByText('Restricted Mode', { exact: true }).count()) {
    await press('Control+Shift+p');
    const palette = page.locator('.quick-input-widget:visible .quick-input-box input');
    await palette.fill('>Workspaces: Manage Workspace Trust');
    await page.locator('.quick-input-widget:visible .monaco-list-row').filter({ hasText: 'Manage Workspace Trust' }).first().click();
    await page.getByRole('button', { name: 'Trust', exact: true }).click();
    if (await trust.isVisible()) await trust.click();
    await page.getByText('You trust this folder', { exact: true }).waitFor({ state: 'visible' });
    await wait(async () => !await page.getByText('Restricted Mode', { exact: true }).count(), 'trust only the synthetic workspace');
  }
  report.syntheticWorkspaceTrusted = true;
  await press('Escape');
  const modal = page.locator('.monaco-modal-editor-block');
  if (await modal.isVisible()) {
    await press('Control+w');
    await modal.waitFor({ state: 'hidden' });
  }
  await page.getByRole('tab', { name: /Local Markdown Vault/ }).click();
  for (const [index, current] of report.files.entries()) {
    file = current;
    source = await readFile(join(local, 'Arrow QA Vault', file.name), 'utf8');
    await page.getByRole('treeitem', { name: `File: ${file.name}`, exact: true }).dblclick();
    frame = await editorFrame(`Linux arrow report ${index + 1}`);
    file.opened = true;
    await frame.locator('.cm-line').first().click();
    await unchanged('opening note');
    for (const kind of testedKinds) {
      const before = `BEFORE_${kind}_${index + 1}`, after = `AFTER_${kind}_${index + 1}`;
      for (const direction of directions) {
        await check(`${file.name}: ${kind} ${direction}`, async () => {
          const forward = ['down', 'right'].includes(direction);
          const marker = forward ? before : after;
          await find(marker);
          await press(forward ? 'ArrowRight' : 'ArrowLeft');
          if (forward && ['ER', 'FLOW', 'DRAWIO'].includes(kind)) {
            await wait(async () => await frame.locator('.mlp-mermaid-wrap svg').count() > 0, `rendered ${kind}`, 20000);
          }
          const start = await selection();
          const target = source.indexOf(forward ? after : before) + (forward ? 0 : before.length);
          const key = { down: 'ArrowDown', up: 'ArrowUp', right: 'ArrowRight', left: 'ArrowLeft' }[direction];
          const limit = ['up', 'down'].includes(direction) ? 100 : Math.abs(target - start.head) + 40;
          let currentHead = start.head, stationary = 0, steps = 0;
          while (forward ? currentHead < target : currentHead > target) {
            assert.ok(steps++ < limit, `${key} did not cross ${kind} within ${limit} keys`);
            await press(key);
            if (['up', 'down'].includes(direction)) await caretVisible(`${kind} ${direction} step ${steps}`);
            const next = await selection();
            assert.equal(next.from, next.to, `${key} unexpectedly selected text`);
            stationary = next.head === currentHead ? stationary + 1 : 0;
            assert.ok(stationary < 5, `${key} trapped at offset ${next.head}: ${next.lineText}`);
            assert.ok(forward ? next.head >= currentHead : next.head <= currentHead, `${key} reversed direction at ${currentHead} -> ${next.head}`);
            currentHead = next.head;
          }
          report.samples.push({ file: file.name, kind, direction, steps, start: start.head, end: currentHead, target });
          await caretVisible(`${kind} ${direction} complete`);
          await unchanged(`${kind} ${direction}`);
        });
      }
      if (['TABLE', 'ER', 'DRAWIO', 'IMAGE'].includes(kind)) await screenshot(`${index + 1}-${kind}`);
    }
    await check(`${file.name}: document edges, selection, and page navigation`, async () => {
      await find(`BEFORE_TABLE_${index + 1}`); await press('ArrowRight');
      await press('Control+Home'); await caretVisible('document start'); assert.equal((await selection()).head, 0);
      for (const key of ['ArrowLeft', 'ArrowUp']) { await press(key); assert.equal((await selection()).head, 0); }
      await press('Control+End'); await caretVisible('document end'); assert.equal((await selection()).head, source.length);
      for (const key of ['ArrowRight', 'ArrowDown']) { await press(key); assert.equal((await selection()).head, source.length); }
      await press('Control+Home');
      await press('PageDown'); await caretVisible('page down'); const moved = await selection(); assert.ok(moved.head > 0);
      await press('PageUp'); await caretVisible('page up'); assert.ok((await selection()).head < moved.head);
      await find(`BEFORE_CALLOUT_${index + 1}`); await press('ArrowRight');
      for (const key of ['Control+ArrowLeft', 'Control+ArrowRight']) {
        for (let n = 0; n < 4; n++) {
          const previous = (await selection()).head;
          await press(key); await caretVisible(`${key} ${n}`);
          assert.ok(key.endsWith('Left') ? (await selection()).head < previous : (await selection()).head > previous, `${key} did not advance`);
        }
      }
      const anchor = (await selection()).head;
      for (let n = 0; n < 16; n++) { await press('Shift+ArrowDown'); await caretVisible(`selection down ${n}`); }
      const selected = await selection(); assert.equal(selected.anchor, anchor); assert.ok(selected.to > selected.from);
      await press('ArrowLeft'); assert.equal((await selection()).from, (await selection()).to);
      await unchanged('document and selection navigation');
    });
    await screenshot(`final-${index + 1}`);
    file.finalSha256 = (await ssh(`sha256sum ${quote(`${remote}/Arrow QA Vault/${file.name}`)}`)).trim().split(/\s+/)[0];
    assert.equal(file.finalSha256, file.initialSha256, 'Navigation changed on-disk source');
  }
  report.completed = true;
  report.passed = report.failures.length === 0 && report.pageErrors.length === 0;
} catch (error) {
  report.failures.push({ stage: 'session', error: String(error), stack: error.stack });
  await screenshot('session-failure').catch(() => {});
  if (page) await writeFile(join(artifacts, 'session-failure-dom.txt'), await page.locator('body').innerText().catch(error => String(error)));
  console.error(error);
} finally {
  if (remote) {
    await writeFile(join(artifacts, 'linux-code.log'), await ssh(`cat ${quote(`${remote}/code.log`)}`).catch(error => String(error)));
    if (processGroup) await ssh(`kill -TERM -- -${processGroup}`).catch(() => {});
  }
  await browser?.close().catch(() => {});
  tunnel?.kill();
  if (report.passed && remote && process.env.MDLP_LINUX_QA_KEEP_REMOTE !== '1') {
    assert.match(remote, /^\/tmp\/mdlp-linux-arrow-[A-Za-z0-9]+$/);
    try { await ssh(`rm -r -- ${quote(remote)}`); report.remoteTemporaryRemoved = true; }
    catch (error) { report.cleanupError = String(error); }
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  await rm(local, { recursive: true, force: true });
  console.log(JSON.stringify({ completed: report.completed, passed: report.passed, checks: report.checks.length, failures: report.failures.length, arrowPresses: report.arrowPresses, artifacts, remoteTemporary: remote }));
  if (!report.passed) process.exitCode = 1;
}

function quote(value) { return `'${String(value).replaceAll("'", "'\\''")}'`; }
function required(name) { const value = process.env[name]; assert.ok(value, `Set ${name} explicitly for the authorized Linux QA host`); return value; }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
async function ssh(script) { return command('ssh', [...sshOptions, host, script]); }
async function command(binary, args) {
  const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [], errors = [];
  child.stdout.on('data', value => output.push(value)); child.stderr.on('data', value => errors.push(value));
  await new Promise((done, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? done() : reject(new Error(`${binary} exited ${code}: ${Buffer.concat(errors)}`))); });
  return Buffer.concat(output).toString();
}
async function press(key) { report.keyPresses++; if (key.includes('Arrow')) report.arrowPresses++; await page.keyboard.press(key); }
async function selection() {
  return frame.evaluate(() => {
    const view = document.querySelector('.cm-content').cmTile.root.view;
    const range = view.state.selection.main;
    return { anchor: range.anchor, head: range.head, from: range.from, to: range.to, text: view.state.sliceDoc(range.from, range.to), lineText: view.state.doc.lineAt(range.head).text };
  });
}
async function find(text) {
  await frame.locator('.cm-line').first().click();
  await press('Control+f');
  const input = frame.locator('.cm-search input[name="search"]');
  await input.fill(text); await press('Enter'); await press('Escape');
  assert.equal((await selection()).text, text, `Find did not select ${text}`);
}
async function unchanged(label) {
  const actual = await frame.evaluate(() => document.querySelector('.cm-content').cmTile.root.view.state.doc.toString());
  assert.equal(hash(actual), file.initialSha256, `${label}: editor source changed`);
}
async function caretVisible(label, { delayMs = 150, observeOnly = false } = {}) {
  await delay(delayMs);
  const value = await frame.evaluate(async ({ domFirst }) => {
    const completedFrame = () => new Promise(done => requestAnimationFrame(() => setTimeout(done, 0)));
    const passive = () => {
      const content = document.querySelector('.cm-content'), view = content.cmTile.root.view;
      const scroller = document.querySelector('.cm-scroller');
      const rect = element => { const box = element.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, height: box.height }; };
      const native = document.getSelection(), focus = native?.focusNode;
      const element = focus instanceof Element ? focus : focus?.parentElement;
      let nativeFocus;
      if (focus) { const range = document.createRange(); range.setStart(focus, native.focusOffset); range.collapse(true); nativeFocus = rect(range); }
      const guard = view.plugins.map(plugin => plugin.value).find(value => typeof value?.remaining === 'number' && typeof value?.deadline === 'number');
      return { sampledAt: performance.now(), head: view.state.selection.main.head,
        viewport: rect(scroller), scrollTop: scroller.scrollTop,
        cursors: [...document.querySelectorAll('.cm-cursor')].map(rect).filter(box => box.height > 0),
        nativeFocus, focusLine: element?.closest('.cm-line') && rect(element.closest('.cm-line')),
        collapsed: native?.isCollapsed, focused: document.activeElement === content,
        measureScheduled: view.measureScheduled, measureRequests: view.measureRequests.length,
        guard: guard && { remaining: guard.remaining, pending: guard.pending, millisecondsLeft: guard.deadline - Date.now() },
      };
    };
    const passiveBeforeMeasurement = [];
    if (domFirst) {
      await completedFrame(); passiveBeforeMeasurement.push({ label: 'completed frame', ...passive() });
      await new Promise(done => setTimeout(done, 200)); await completedFrame(); passiveBeforeMeasurement.push({ label: 'after 200ms', ...passive() });
      await new Promise(done => setTimeout(done, 300)); await completedFrame(); passiveBeforeMeasurement.push({ label: 'after 500ms', ...passive() });
    }
    const sample = () => {
      const view = document.querySelector('.cm-content').cmTile.root.view;
      const main = view.state.selection.main, head = main.head;
      // Match CodeMirror's inward endpoint affinity for a nonempty selection.
      // The opposite side can describe the next widget rather than the DOM focus.
      const measuredSide = main.empty ? main.assoc || 1 : main.head > main.anchor ? -1 : 1;
      const caret = view.coordsAtPos(head, measuredSide);
      const scroller = view.scrollDOM.getBoundingClientRect();
      const guard = view.plugins.map(plugin => plugin.value).find(value => typeof value?.remaining === 'number' && typeof value?.deadline === 'number');
      const native = document.getSelection();
      let nativeFocus;
      if (native?.focusNode) {
        const range = document.createRange();
        range.setStart(native.focusNode, native.focusOffset); range.collapse(true);
        const box = range.getBoundingClientRect();
        nativeFocus = { node: native.focusNode.nodeName, offset: native.focusOffset, text: native.focusNode.textContent?.slice(0, 100),
          geometry: { top: box.top, bottom: box.bottom, left: box.left, right: box.right, height: box.height },
        };
      }
      return { head, caret, defaultCaret: view.coordsAtPos(head), measuredSide, sampledAt: performance.now(),
        caretBySide: [-1, 0, 1].map(side => ({ side, coords: view.coordsAtPos(head, side) })), association: main.assoc,
        viewport: { top: scroller.top, bottom: scroller.bottom, left: scroller.left, right: scroller.right },
        focused: view.hasFocus, contentFocused: view.root.activeElement === view.contentDOM,
        activeElement: view.root.activeElement?.className, clientHeight: view.scrollDOM.clientHeight,
        clientWidth: view.scrollDOM.clientWidth, visibilityState: document.visibilityState, hidden: document.hidden,
        scrollTop: view.scrollDOM.scrollTop, nativeFocus, guard: guard && { remaining: guard.remaining, pending: guard.pending, millisecondsLeft: guard.deadline - Date.now(), destroyed: guard.destroyed },
      };
    };
    const rawBeforeFrame = sample();
    // Let queued measurement microtasks complete, without dispatching a scroll
    // or any selection change from this probe. Keep the raw timed sample too.
    await completedFrame();
    const settled = sample();
    return { ...settled, rawBeforeFrame, passiveBeforeMeasurement, frameSettlementMs: settled.sampledAt - rawBeforeFrame.sampledAt };
  }, { domFirst: process.env.MDLP_LINUX_QA_DOM_FIRST === '1' });
  report.caretSamples.push({ file: file.name, label, ...value });
  if (observeOnly) return value;
  assert.ok(value.focused, `${label}: editor lost keyboard focus`);
  assert.ok(value.caret, `${label}: caret position has no geometry`);
  const { caret, viewport } = value;
  for (const passive of value.passiveBeforeMeasurement) {
    const boxes = passive.collapsed ? passive.cursors : passive.nativeFocus?.height > 0 ? [passive.nativeFocus] : [];
    if (passive.collapsed) assert.ok(boxes.length > 0, `${label}: no painted DOM cursor at ${passive.label}`);
    for (const box of boxes) assert.ok(box.top >= passive.viewport.top - 2 && box.bottom <= passive.viewport.bottom + 2 && box.left >= passive.viewport.left - 2 && box.right <= passive.viewport.right + 2,
      `${label}: passive DOM caret outside viewport at ${passive.label}: ${JSON.stringify(passive)}`);
  }
  assert.ok(caret.top >= viewport.top - 2 && caret.bottom <= viewport.bottom + 2 && caret.left >= viewport.left - 2 && caret.right <= viewport.right + 2,
    `${label}: caret outside viewport after 150ms and a completed frame: ${JSON.stringify(value)}`);
}
async function screenshot(name) { if (page) await page.screenshot({ path: join(artifacts, `${name}.png`) }); }
async function check(label, operation) {
  try { await operation(); report.checks.push(label); console.log(`PASS ${label}`); }
  catch (error) {
    report.failures.push({ label, error: String(error), stack: error.stack, selection: await selection().catch(() => undefined) });
    await screenshot(`failure-${report.failures.length}`).catch(() => {});
    if (String(error).includes('caret outside viewport')) {
      await caretVisible(`${label}: passive recovery after 200ms`, { delayMs: 200, observeOnly: true }).catch(() => {});
      await caretVisible(`${label}: passive recovery after 500ms`, { delayMs: 300, observeOnly: true }).catch(() => {});
    }
    console.error(`FAIL ${label}: ${error}`);
    await press('Escape');
  }
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
}
async function editorFrame(title) {
  let result;
  await wait(async () => {
    for (const candidate of page.frames()) {
      if (candidate.isDetached() || !await candidate.locator('.cm-content').count()) continue;
      if (!await candidate.evaluate(() => document.visibilityState === 'visible')) continue;
      if (!(await candidate.locator('.cm-content').innerText()).includes(title)) continue;
      result = candidate; return true;
    }
    return false;
  }, 'visible editor frame', 25000);
  return result;
}
async function wait(condition, label, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await condition()) return; await delay(150); }
  throw new Error(`Timed out: ${label}`);
}
async function reservePort() {
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port; await new Promise(done => server.close(done)); return port;
}
function object(kind) {
  if (kind === 'TABLE') return '| Item | State |\n| --- | --- |\n| **First** | Checked |\n| Second | $n^2$ |\n| Third | ==Retain== |';
  if (kind === 'CODE') return '```typescript\nconst retain = true;\nfunction review(value: string) {\n  return value.trim();\n}\n```';
  if (kind === 'INDENTED') return '    const nested = true;\n    // Preserve indentation\n    review("local");';
  if (kind === 'ER') return '```mermaid\nerDiagram\n  NOTE ||--o{ REVISION : tracks\n  NOTE {\n    string id PK\n  }\n  REVISION {\n    int number\n  }\n```';
  if (kind === 'FLOW') return '```mermaid\nflowchart LR\nA[Capture] --> B{Review}\nB --> C[Retain]\nB --> A\n```';
  if (kind === 'DRAWIO') return '```drawio\n<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Local note" vertex="1" parent="1"><mxGeometry x="0" y="0" width="180" height="70" as="geometry"/></mxCell></root></mxGraphModel>\n```';
  if (kind === 'CALLOUT') return '> [!warning]+ Boundary review\n> Keep the full warning distinct.\n>\n> - Review\n>   - Retain\n> - [ ] Verify';
  if (kind === 'MATH') return '$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$';
  if (kind === 'LIST') return '- Parent with **emphasis**\n  - Child\n    - Deeper child\n- [ ] Task\n1. Numbered\n2. Second';
  if (kind === 'QUOTE') return '> A quotation across lines\n> with **formatted** text.\n>\n> Second quoted paragraph.';
  return '![Small local image](pixel.png)';
}
function makeNote(id, bytes) {
  let text = `---\ntitle: Linux arrow report ${id}\ntags: [qa, local]\n---\n\n# Linux arrow report ${id}\n\nSynthetic navigation-only QA.\n`;
  let sequence = 0;
  const filler = () => `\n## Supporting context ${sequence++}\n\nA wrapped paragraph retains **bold**, *emphasis*, ==highlighting==, Unicode caf\u00e9 \u6771\u4eac \ud83d\ude80, inline $x^2$, and [a local link](#linux-arrow-report-${id}). This text supplies realistic navigation context in a long note, without changing any saved document bytes.\n\n- First context item\n  - Nested context\n- [ ] Follow up\n\n> [!note] Context\n> Preserve local evidence.\n\n| Context | Status |\n| --- | --- |\n| Local | Retained |\n\n\`\`\`json\n{"retained":true}\n\`\`\`\n`;
  for (const [i, kind] of kinds.entries()) {
    while (Buffer.byteLength(text) < bytes * (i + 0.5) / kinds.length) text += filler();
    text += `\n## Object ${kind}\n\nBEFORE_${kind}_${id}\n\n${object(kind)}\n\nAFTER_${kind}_${id}\n\nA stable paragraph after the object.\n`;
  }
  while (Buffer.byteLength(text) < bytes) text += filler();
  return text + '\nFinal unchanged paragraph.';
}
