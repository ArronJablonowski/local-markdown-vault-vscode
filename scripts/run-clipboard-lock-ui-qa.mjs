// Native clipboard gestures run serially in a disposable macOS VS Code profile.
// Preserve every existing pasteboard item/format in memory and restore on exit.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { pasteboard, restorePasteboard } from './macos-pasteboard.mjs';

assert.equal(process.platform, 'darwin', 'This runner preserves the macOS pasteboard; use the Linux runner on Spark.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'mdlp-clipboard-lock-'));
const workspace = join(temporary, 'Clipboard Lock QA');
const profile = join(temporary, 'profile');
const artifacts = join(root, '.vscode-test', process.env.MDLP_CLIPBOARD_ARTIFACTS ?? 'clipboard-lock-ui');
const version = process.env.MDLP_QA_VSCODE_VERSION ?? '1.139.1';
const report = { startedAt: new Date().toISOString(), version, checks: [], failures: [], pageErrors: [], editorErrors: [], completed: false, passed: false, keyPresses: 0, clipboardRestored: false, savedChecks: 0 };
const unicode = 'Caf\u00e9 \u{1F642} \u{1F469}\u200d\u{1F4BB} e\u0301 \u4e2d\u6587';
const png = (await readFile(join(root, 'test/fixtures/complex-qa/assets/local-icon.png'))).toString('base64');
const objects = '\n\n# Clipboard report\n\n**Strong**, *emphasis*, `code`, $x^2$ and :smile:.\n\n- First item\n  - Nested item\n- [ ] Pending task\n\n| Name | Value |\n| --- | --- |\n| Original | Keep |\n\n> [!warning]+ Review\n> Callout with **bold**.\n>\n> - Nested list\n\n```typescript\nconst retained = 42;\n```\n\n```mermaid\nflowchart LR\nA[Start] --> B[End]\n```\n\n```drawio\n<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>\n```\n\nEND_OBJECTS';
const longCode = Array.from({ length: 12 }, (_, n) => `const value${n} = ${n};`).join('\n');
const fixtures = {
  'Prose.md': 'Clipboard evidence stays intact.\n\n' + unicode + '\n\nA final paragraph.',
  'Objects.md': 'BEGIN_OBJECTS' + objects.replace('const retained = 42;', 'const retained = 42;\n\tconst tabbed = true;'),
  'Large.md': 'Large clipboard report\n\n' + objects.replace('const retained = 42;', '\tconst retained = 42;').repeat(600),
  'Code.md': '# Code copy\n\n```text\n' + unicode + '\n```\n\n```javascript\n' + longCode + '\n```\n\nEND_CODE',
  'Grid.md': 'Name\tQuantity\nApples\t3\nPears\t7',
  'Images.md': 'IMAGE_BEGIN\n\nIMAGE_END',
  'Lock.md': 'LOCK_BEGIN\n\n---\n\n- [ ] Pending task\n\n| Item | State |\n| --- | --- |\n| Original | Keep |\n\n```text\nLocked code remains copyable.\n```\n\nLOCK_END',
  'Sink.md': 'PASTE_TARGET',
};
let browser, child, page, frame, current, clipboardSnapshot;
try {
  clipboardSnapshot = pasteboard('read');
  await Promise.all([mkdir(workspace), mkdir(join(profile, 'User'), { recursive: true }), mkdir(artifacts, { recursive: true })]);
  await writeFile(join(profile, 'User/settings.json'), JSON.stringify({
    'workbench.startupEditor': 'none', 'update.mode': 'none', 'telemetry.telemetryLevel': 'off',
    'window.dialogStyle': 'custom', 'files.autoSave': 'off', 'git.openRepositoryInParentFolders': 'never',
    'security.workspace.trust.enabled': false, 'mdLivePreview.defaultEditor': 'livePreview',
    'workbench.editorAssociations': { '*.md': 'mdLivePreview.editor' },
    'mdLivePreview.defaultEditingMode': 'editing', 'mdLivePreview.vault.openBehavior': 'newTab',
  }, null, 2));
  for (const [name, text] of Object.entries(fixtures)) await writeFile(join(workspace, name), text);
  const port = await reservePort();
  child = spawn(await downloadAndUnzipVSCode(version), [workspace, '--new-window', '--disable-updates', '--disable-telemetry', '--skip-welcome', '--skip-release-notes',
    `--extensionDevelopmentPath=${root}`, `--user-data-dir=${profile}`, `--extensions-dir=${join(temporary, 'extensions')}`, `--remote-debugging-port=${port}`],
    { cwd: root, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
  await wait(async () => { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); return true; } catch { return false; } }, 'VS Code startup', 30000);
  await wait(() => browser.contexts().flatMap(context => context.pages()).length > 0, 'workbench');
  page = browser.contexts().flatMap(context => context.pages())[0];
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => report.pageErrors.push({ message: String(error), stack: error.stack, check: report.activeCheck }));
  page.on('console', message => {
    if (message.type() === 'error' && (message.location().url.includes('/dist/webview-editor.js') || message.text().includes('CodeMirror plugin crashed'))) {
      report.editorErrors.push({ message: message.text(), check: report.activeCheck });
    }
  });
  await page.bringToFront();
  await page.getByRole('tab', { name: /Local Markdown Vault/ }).click();
  await page.getByRole('treeitem', { name: 'File: Code.md', exact: true }).waitFor({ timeout: 30000 });

  await check('Mouse-selected prose copies exactly and paste saves without manual Save', async () => {
    await open('Prose.md'); await mousePrefix('Clipboard evidence'); await press('Meta+c');
    await pasteSink('Clipboard evidence');
  });
  await check('Cut, immediate paste, Undo, and Redo preserve and save the source', async () => {
    await open('Prose.md'); await find('Clipboard evidence'); await press('Meta+x');
    await saved(fixtures['Prose.md'].replace('Clipboard evidence', ''));
    await press('Meta+v'); await saved(fixtures['Prose.md']);
    await press('Meta+z'); await saved(fixtures['Prose.md'].replace('Clipboard evidence', ''));
    await press('Meta+Shift+z'); await saved(fixtures['Prose.md']);
  });
  await check('Unicode clipboard round trip preserves emoji, combining accents, and CJK', async () => {
    await open('Prose.md'); await find(unicode); await press('Meta+c'); await pasteSink(unicode);
  });
  await check('Paste Without Formatting followed immediately by typing has no late replay', async () => {
    await open('Prose.md'); await find('Clipboard evidence'); await press('Meta+c');
    await pasteSink('Clipboard evidenceTAIL', process.env.MDLP_CLIPBOARD_SHIFT_KEY ?? 'Meta+Shift+V', 'TAIL');
  });
  await check('Full mixed-object Markdown copy and paste retains exact source', async () => {
    await open('Objects.md'); await selectAll(); await press('Meta+c'); await pasteSink(fixtures['Objects.md']);
  });
  await check('Reverse keyboard selection across rendered objects copies exact Markdown', async () => {
    await open('Objects.md'); await find('END_OBJECTS'); await press('ArrowRight');
    for (let i = 0; i < 24; i++) await press('Shift+ArrowUp');
    const selected = await selection(); assert.ok(selected.text.length > 100);
    await press('Meta+c'); await pasteSink(selected.text);
  });
  await check('Large mixed-object document survives native Select All, copy, and paste', async () => {
    await open('Large.md'); await selectAll(); await press('Meta+c'); await pasteSink(fixtures['Large.md']);
    report.largeBytes = Buffer.byteLength(fixtures['Large.md']);
  });
  await check('Replacing a large pasted note preserves each subsequent typed character', async () => {
    await open('Sink.md'); await selectAll();
    await page.keyboard.type('Replacement stays intact', { delay: 3 });
    await saved('Replacement stays intact');
  });
  await check('Single-line code copy button copies only code, including Unicode', async () => {
    await open('Code.md'); await copyCode(0); await pasteSink(unicode);
  });
  await check('Collapsed long code copy button includes all hidden code lines', async () => {
    await open('Code.md'); await copyCode(1); await pasteSink(longCode);
  });
  await check('Spreadsheet TSV copied through the native clipboard creates a saved table', async () => {
    await open('Grid.md'); await selectAll(); await press('Meta+c');
    await pasteSink('| Name | Quantity |\n| --- | --- |\n| Apples | 3 |\n| Pears | 7 |\n\n');
  });
  await check('Pending table-cell edit survives clicking Lock and reaches disk', async () => {
    await open('Lock.md'); const cell = frame.locator('.mlp-table td').first(); await cell.click();
    await press('Meta+a'); await page.keyboard.type('Revised cell', { delay: 5 });
    await toggle().click(); await locked(true);
    await saved(fixtures['Lock.md'].replace('Original', 'Revised cell'));
  });
  await check('Lock blocks typing, Backspace, Delete, paste, cut, Undo, and Redo', async () => {
    await open('Lock.md'); await locked(true); const before = await source();
    await find('LOCK_BEGIN');
    for (const key of ['q', 'Enter', 'Backspace', 'Delete', 'Meta+v', 'Meta+Shift+v', 'Meta+x', 'Meta+z', 'Meta+Shift+z']) {
      await press(key); await delay(70); assert.equal(await source(), before, `Locked mutation from ${key}`);
    }
    await saved(before);
  });
  await check('Locked rendered checkbox and table cannot mutate document', async () => {
    await open('Lock.md'); await locked(true); const before = await source();
    const checkbox = frame.locator('.mlp-checkbox').first();
    if (await checkbox.isEnabled() && await checkbox.getAttribute('aria-disabled') !== 'true') await checkbox.click();
    await frame.locator('.mlp-table td').first().dblclick();
    await page.keyboard.type('BLOCKED', { delay: 3 }); await press('Enter'); await saved(before);
    await page.screenshot({ path: join(artifacts, 'locked-controls.png') });
  });
  await check('Locked source selections remain copyable', async () => {
    await open('Lock.md'); await find('LOCK_BEGIN'); await press('Meta+c'); await pasteSink('LOCK_BEGIN');
  });
  await check('Locked code copy button remains usable', async () => {
    await open('Lock.md'); await copyCode(0); await pasteSink('Locked code remains copyable.');
  });
  await check('Native PNG clipboard paste creates a local attachment and saves its link', async () => {
    await open('Images.md'); await find('IMAGE_END'); await press('ArrowLeft');
    await traceClipboard();
    pasteboard('write', JSON.stringify([[['public.png', png]]]));
    report.imageSeedFormats = JSON.parse(pasteboard('read')).map(item => item.map(([type, data]) => ({ type, bytes: Buffer.from(data, 'base64').length })));
    await press('Meta+v');
    await delay(150); report.imageClipboardEvents = await frame.evaluate(() => window.__clipboardQaEvents);
    await wait(async () => /!\[\]\(assets\/[^)]+\.png\)/.test(await source()), 'pasted image link');
    const text = await source(); await saved(text);
    assert.ok(text.startsWith('IMAGE_BEGIN\n\n![](') && text.endsWith('IMAGE_END'));
    const file = text.match(/!\[\]\((assets\/[^)]+\.png)\)/)[1];
    const written = await readFile(join(workspace, file)), original = Buffer.from(png, 'base64');
    // macOS/Chromium may re-encode PNG data while retaining the image itself.
    assert.deepEqual(written.subarray(0, 8), original.subarray(0, 8));
    assert.equal(written.readUInt32BE(16), original.readUInt32BE(16));
    assert.equal(written.readUInt32BE(20), original.readUInt32BE(20));
  });
  await check('Locked native image paste creates neither an edit nor an attachment', async () => {
    await open('Images.md'); await toggle().click(); await locked(true);
    const before = await source(), files = await readdir(join(workspace, 'assets')).catch(() => []);
    await frame.locator('.cm-content').focus(); await press('Meta+v'); await delay(500);
    await saved(before); assert.deepEqual(await readdir(join(workspace, 'assets')).catch(() => []), files);
  });
  await check('Keyboard Space and Enter toggle lock and restore saved editing', async () => {
    await open('Lock.md'); await toggle().focus(); await press('Space'); await locked(false);
    await find('LOCK_END'); await press('ArrowRight'); await page.keyboard.type(' unlocked', { delay: 4 });
    const expected = fixtures['Lock.md'].replace('Original', 'Revised cell') + ' unlocked'; await saved(expected);
    await toggle().focus(); await press('Enter'); await locked(true); await saved(expected);
    await toggle().click(); await locked(false); await saved(expected);
    await page.screenshot({ path: join(artifacts, 'unlocked-controls.png') });
  });
  report.completed = true; report.passed = !report.failures.length && !report.pageErrors.length && !report.editorErrors.length;
} catch (error) { report.failures.push({ error: String(error), stack: error.stack }); console.error(error); }
finally {
  await browser?.close().catch(() => {});
  if (child && child.exitCode === null) { child.kill(); await Promise.race([new Promise(done => child.once('exit', done)), delay(5000)]); }
  if (clipboardSnapshot !== undefined) { try {
    restorePasteboard(clipboardSnapshot);
    report.clipboardRestored = true;
  } catch (error) { report.failures.push({ error: `Clipboard restore failed: ${error}` }); report.passed = false; } }
  report.finishedAt = new Date().toISOString();
  await mkdir(artifacts, { recursive: true }); await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  if (!report.passed) process.exitCode = 1;
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failures: report.failures.length, artifacts }));
}

async function open(name) {
  current = name;
  // Quick Open reaches files outside the virtualized tree's visible rows.
  if (frame && !frame.isDetached()) await frame.locator('.cm-content').focus();
  await press('Meta+p');
  const input = page.locator('.quick-input-widget:visible .quick-input-box input');
  await input.fill(join(workspace, name));
  await page.locator('.quick-input-widget:visible .monaco-list-row').filter({ hasText: name }).first().click();
  await page.locator('.quick-input-widget').waitFor({ state: 'hidden' });
  const expected = await readFile(join(workspace, name), 'utf8');
  await wait(async () => {
    for (const candidate of page.frames()) if (!candidate.isDetached() && await candidate.locator('.cm-content').count()
      && await (await candidate.frameElement()).isVisible()
      && await candidate.evaluate(text => document.visibilityState === 'visible'
        && document.querySelector('.cm-content').cmTile.root.view.state.doc.toString() === text, expected).catch(() => false)) { frame = candidate; return true; }
    return false;
  }, 'active Markdown webview');
  await delay(150);
}
async function press(key) { report.keyPresses++; await page.keyboard.press(key); }
async function copyCode(index) {
  const button = frame.getByRole('button', { name: 'Copy code block', exact: true }).nth(index);
  await button.click();
  await wait(async () => (await button.getAttribute('class')).includes('mlp-copy-code-btn-done'), 'confirmed code copy');
}
async function source() { return frame.evaluate(() => document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()); }
async function selection() { return frame.evaluate(() => { const view = document.querySelector('.cm-content').cmTile.root.view, range = view.state.selection.main; return { text: view.state.sliceDoc(range.from, range.to), from: range.from, to: range.to }; }); }
async function selectAll() { await frame.locator('.cm-content').focus(); await press('Meta+a'); assert.equal((await selection()).text, await source()); }
async function find(text) {
  await frame.locator('.cm-content').focus(); await press('Meta+f'); const input = frame.locator('.cm-search input[name="search"]');
  await input.click(); await press('Meta+a'); await page.keyboard.insertText(text); await press('Enter'); await press('Escape');
  assert.equal((await selection()).text, text);
}
async function pasteSink(expected, key = 'Meta+v', tail = '') {
  await open('Sink.md'); await selectAll();
  // A unique scaffold distinguishes this retained tab from identical copied notes.
  await page.keyboard.type('SINK_UNIQUE'); await press('Enter'); await press('Enter');
  await traceClipboard(); await press(key);
  if (tail) await page.keyboard.type(tail, { delay: 2 });
  await delay(100); (report.clipboardEvents ??= []).push({ key, events: await frame.evaluate(() => window.__clipboardQaEvents) });
  await saved('SINK_UNIQUE\n\n' + expected, 30000);
}
async function traceClipboard() {
  await frame.evaluate(execPaste => {
    window.__clipboardQaEvents = [];
    if (window.__clipboardQaListener) return;
    window.__clipboardQaListener = true;
    for (const type of ['keydown', 'paste', 'copy', 'cut']) document.addEventListener(type, event => {
      window.__clipboardQaEvents.push({ type, key: event.key, code: event.code, shift: event.shiftKey, meta: event.metaKey,
        types: event.clipboardData && [...event.clipboardData.types], files: event.clipboardData && [...event.clipboardData.files].map(file => ({ type: file.type, size: file.size })) });
    }, true);
    if (execPaste) document.addEventListener('keydown', event => {
      if (event.metaKey && event.shiftKey && event.key.toLowerCase() === 'v') {
        const result = document.execCommand('paste');
        window.__clipboardQaEvents.push({ type: 'execPaste', result, trusted: event.isTrusted });
        event.preventDefault(); event.stopPropagation();
      }
    }, true);
  }, process.env.MDLP_CLIPBOARD_EXEC_PASTE === '1');
}
async function saved(expected, timeout = 10000) {
  await wait(async () => (await source()) === expected && (await readFile(join(workspace, current), 'utf8')) === expected, `source and saved file ${current}`, timeout);
  report.savedChecks++;
  report.lastSaved = { file: current, bytes: Buffer.byteLength(expected), sha256: createHash('sha256').update(expected).digest('hex') };
}
function toggle() { return frame.locator('.mlp-editing-mode-toggle'); }
async function locked(value) {
  await wait(async () => await toggle().getAttribute('aria-pressed') === String(value), `locked=${value}`);
  assert.equal(await frame.locator('.cm-content').getAttribute('contenteditable'), String(!value));
}
async function mousePrefix(prefix) {
  const point = await frame.locator('.cm-line').filter({ hasText: prefix }).first().evaluate((line, size) => {
    const text = document.createTreeWalker(line, NodeFilter.SHOW_TEXT).nextNode(); const range = document.createRange();
    range.setStart(text, 0); range.setEnd(text, size); const box = range.getBoundingClientRect();
    return { x: box.left, right: box.right, y: box.top + box.height / 2 };
  }, prefix.length);
  // Locator bounds include iframe placement; DOM range coordinates do not.
  const contentBox = await frame.locator('.cm-content').boundingBox();
  const contentRect = await frame.locator('.cm-content').evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });
  const dx = contentBox.x - contentRect.x, dy = contentBox.y - contentRect.y;
  await page.mouse.move(point.x + dx + 0.25, point.y + dy); await page.mouse.down();
  await page.mouse.move(point.right + dx, point.y + dy, { steps: 12 }); await page.mouse.up();
  assert.equal((await selection()).text, prefix);
}
async function check(label, operation) {
  if (process.env.MDLP_CLIPBOARD_CHECKS && !new RegExp(process.env.MDLP_CLIPBOARD_CHECKS).test(label)) return;
  report.activeCheck = label;
  try { await operation(); report.checks.push(label); console.log(`PASS ${label}`); }
  catch (error) {
    report.failures.push({ label, error: String(error), source: await source().then(text => text.slice(0, 1500)).catch(() => undefined) });
    await page.screenshot({ path: join(artifacts, `failure-${report.failures.length}.png`) }).catch(() => {});
    console.error(`FAIL ${label}: ${error}`); await press('Escape');
  }
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
}
async function wait(condition, label, timeout = 10000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await condition()) return; await delay(80); } throw new Error(`Timed out: ${label}`); }
async function reservePort() { const server = createServer(); await new Promise(done => server.listen(0, '127.0.0.1', done)); const port = server.address().port; await new Promise(done => server.close(done)); return port; }
