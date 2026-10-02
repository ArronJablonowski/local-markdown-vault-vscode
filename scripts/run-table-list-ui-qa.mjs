// Exercise table-list rendering and source preservation through native VS Code gestures.
// The disposable profile never touches personal notes; all clipboard formats are restored.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { pasteboard, restorePasteboard } from './macos-pasteboard.mjs';

assert.equal(process.platform, 'darwin', 'This native runner requires the macOS pasteboard.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'mdlp-table-lists-'));
const workspace = join(temporary, 'Table List QA'), profile = join(temporary, 'profile');
const artifacts = join(root, '.vscode-test', process.env.MDLP_TABLE_LIST_ARTIFACTS ?? 'table-list-native-ui');
const version = process.env.MDLP_QA_VSCODE_VERSION ?? '1.139.1';
const firstList = '<ul><li>Confirm client-context and credential follow-ups.</li><li>Resolve coverage gaps.</li></ul>';
const main = '# Review tracker\n\n| Status | Next step / check-in |\n| --- | --- |\n'
  + `| In progress | ${firstList} |\n`
  + '| Planning | <ul><li>Assign hunt lead.</li><li>Confirm scope and authorization.</li></ul> |\n'
  + '| Planning | <ul><li>Confirm authorization and timebox.</li><li>Verify tenant and asset.</li></ul> |\n\nClosing paragraph.';
const nested = '<ul><li>Parent<ul><li>Child A</li><li>Child B</li></ul></li><li>Sibling</li></ul>';
const fixtures = {
  'Lists.md': main,
  'Nested.md': '# Nested review\n\n| Category | Actions |\n| --- | --- |\n| Review | ' + nested + ' |\n\nAfter table.',
  'Source.md': main,
  'Literal.md': '# Literal markup\n\n| Code | List |\n| --- | --- |\n'
    + '| `<ul><li>Inline literal</li></ul>` | <ul><li>Rendered sibling</li></ul> |\n\n'
    + '```html\n<ul><li>Fenced literal</li></ul>\n```\n\nAfter code.',
  'Locked.md': main.replace('# Review tracker', '# Locked tracker'),
  'Sink.md': 'COPY_DESTINATION',
};
const report = { startedAt: new Date().toISOString(), version, checks: [], failures: [], pageErrors: [], editorErrors: [], savedChecks: 0, keyPresses: 0, clipboardRestored: false, completed: false, passed: false };
let browser, child, page, frame, current, snapshot, editedMain = main;
try {
  snapshot = pasteboard('read');
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
  page.on('pageerror', error => report.pageErrors.push({ error: String(error), check: report.activeCheck }));
  page.on('console', message => {
    if (message.type() === 'error' && (message.location().url.includes('/dist/webview-editor.js') || message.text().includes('CodeMirror plugin crashed'))) {
      report.editorErrors.push({ error: message.text(), check: report.activeCheck });
    }
  });
  await page.bringToFront();
  await page.getByRole('tab', { name: /Local Markdown Vault/ }).click();
  await page.getByRole('treeitem', { name: 'File: Lists.md', exact: true }).waitFor({ timeout: 30000 });

  await check('Screenshot-style three-row status table renders six real bullet items', async () => {
    await open('Lists.md');
    assert.equal(await frame.locator('.mlp-table tbody tr').count(), 3);
    assert.equal(await frame.locator('.mlp-table td ul').count(), 3);
    assert.equal(await frame.locator('.mlp-table td li').count(), 6);
    assert.equal(await frame.locator('.mlp-table td').nth(1).innerText(), 'Confirm client-context and credential follow-ups.\nResolve coverage gaps.');
    const geometry = await frame.locator('.mlp-table td').nth(1).evaluate(cell => {
      const items = [...cell.querySelectorAll('li')].map(li => ({ style: getComputedStyle(li).listStyleType, rect: li.getBoundingClientRect().toJSON() }));
      return { cell: cell.getBoundingClientRect().toJSON(), items };
    });
    assert.equal(geometry.items[0].style, 'disc');
    assert.ok(geometry.items[1].rect.top > geometry.items[0].rect.top);
    assert.ok(geometry.items.every(item => item.rect.left >= geometry.cell.left && item.rect.right <= geometry.cell.right + 1));
    await saved(main); await page.screenshot({ path: join(artifacts, 'rendered-status-table.png') });
  });
  await check('F2 and Enter expose original list source without rewriting the note', async () => {
    await open('Lists.md'); await editCell(1);
    assert.equal(await cell(1).textContent(), firstList);
    await press('Enter'); await saved(editedMain);
    await wait(async () => await cell(1).locator('li').count() === 2, 'unchanged cell leaves source editing');
  });
  await check('Escape discards a changed list-cell draft and restores bullets', async () => {
    await editCell(1); await page.keyboard.type('Discard this draft', { delay: 3 });
    await press('Escape'); await saved(editedMain); assert.equal(await cell(1).locator('li').count(), 2);
  });
  const added = '<li>Schedule the next check-in.</li>';
  await check('Typing a new list item in cell source commits and saves the extra bullet', async () => {
    await editCell(1); await press('ArrowRight');
    for (let i = 0; i < '</ul>'.length; i++) await press('ArrowLeft');
    await page.keyboard.type(added, { delay: 3 }); await press('Enter');
    editedMain = main.replace(firstList, firstList.replace('</ul>', added + '</ul>'));
    await saved(editedMain); assert.equal(await cell(1).locator('li').count(), 3);
  });
  await check('Backspacing the added list item removes only that item and saves', async () => {
    await editCell(1); await press('ArrowRight');
    for (let i = 0; i < '</ul>'.length; i++) await press('ArrowLeft');
    for (let i = 0; i < added.length; i++) await press('Backspace');
    await press('Enter'); editedMain = main;
    await saved(editedMain); assert.equal(await cell(1).locator('li').count(), 2);
  });
  await check('Editing a neighboring status cell preserves every list tag and bullet', async () => {
    await editCell(0); await page.keyboard.type('Completed', { delay: 3 }); await press('Enter');
    editedMain = main.replace('| In progress |', '| Completed |');
    await saved(editedMain); assert.equal(await frame.locator('.mlp-table td li').count(), 6);
  });
  await check('Nested lists display two indentation levels and survive edit cancellation', async () => {
    await open('Nested.md'); assert.equal(await cell(1).locator('ul').count(), 2);
    assert.equal(await cell(1).locator('li').count(), 4);
    const positions = await cell(1).evaluate(el => [...el.querySelectorAll('li')].map(li => ({ left: li.getBoundingClientRect().left, style: getComputedStyle(li).listStyleType })));
    assert.ok(positions[1].left > positions[0].left); assert.equal(positions[0].style, 'disc'); assert.equal(positions[1].style, 'circle');
    await editCell(1); assert.equal(await cell(1).textContent(), nested); await press('Escape');
    await saved(fixtures['Nested.md']); await page.screenshot({ path: join(artifacts, 'nested-table-list.png') });
  });
  await check('Table source button keeps raw tags visible and leaves source unchanged', async () => {
    await open('Source.md'); await frame.getByRole('button', { name: 'Show Markdown source', exact: true }).click();
    assert.ok((await frame.locator('.cm-content').innerText()).includes(firstList));
    assert.equal(await frame.locator('.mlp-table').count(), 0); await saved(fixtures['Source.md']);
    await page.screenshot({ path: join(artifacts, 'table-list-source.png') });
  });
  await check('Inline and fenced code retain literal list tags beside rendered lists', async () => {
    await open('Literal.md'); assert.equal(await cell(0).locator('code').textContent(), '<ul><li>Inline literal</li></ul>');
    assert.equal(await cell(0).locator('ul').count(), 0); assert.equal(await cell(1).locator('li').count(), 1);
    assert.ok((await frame.locator('.cm-content').innerText()).includes('<ul><li>Fenced literal</li></ul>'));
    await saved(fixtures['Literal.md']);
  });
  await check('Locked lists stay rendered and reject keyboard mutation', async () => {
    await open('Locked.md'); await frame.locator('.mlp-editing-mode-toggle').click();
    await wait(async () => await frame.locator('.mlp-editing-mode-toggle').getAttribute('aria-pressed') === 'true', 'locked');
    await cell(1).click(); await press('F2'); await page.keyboard.type('Blocked', { delay: 3 });
    await press('Backspace'); await press('Enter');
    assert.equal(await frame.locator('.mlp-table li').count(), 6); await saved(fixtures['Locked.md']);
  });
  await check('Copying a locked list table and native paste preserve the entire Markdown source', async () => {
    await frame.locator('.cm-content').focus(); await press('Meta+a'); await press('Meta+c');
    await open('Sink.md'); await frame.locator('.cm-content').focus(); await press('Meta+a'); await press('Meta+v');
    await saved(fixtures['Locked.md']);
    // Move the caret outside the selected pasted table before inspecting its rendered form.
    await press('Meta+ArrowUp'); await wait(async () => await frame.locator('.mlp-table li').count() === 6, 'pasted list rendering');
    await page.screenshot({ path: join(artifacts, 'copied-table-lists.png') });
  });
  report.completed = true;
  report.passed = !report.failures.length && !report.pageErrors.length && !report.editorErrors.length;
} catch (error) { report.failures.push({ error: String(error), stack: error.stack }); console.error(error); }
finally {
  await browser?.close().catch(() => {});
  if (child && child.exitCode === null) { child.kill(); await Promise.race([new Promise(done => child.once('exit', done)), delay(5000)]); }
  if (snapshot !== undefined) {
    try { restorePasteboard(snapshot); report.clipboardRestored = true; }
    catch (error) { report.failures.push({ error: `Clipboard restore failed: ${error}` }); report.passed = false; }
  }
  report.finishedAt = new Date().toISOString();
  await mkdir(artifacts, { recursive: true }); await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  if (!report.passed) process.exitCode = 1;
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failures: report.failures.length, artifacts }));
}

function cell(index) { return frame.locator('.mlp-table tbody td').nth(index); }
async function editCell(index) { await cell(index).focus(); await press('F2'); assert.equal(await cell(index).getAttribute('contenteditable'), 'true'); }
async function press(key) { report.keyPresses++; await page.keyboard.press(key); }
async function source() { return frame.evaluate(() => document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()); }
async function saved(expected) {
  await wait(async () => await source() === expected && await readFile(join(workspace, current), 'utf8') === expected, `source and disk for ${current}`);
  report.savedChecks++;
  (report.savedEvidence ??= []).push({ file: current, check: report.activeCheck, bytes: Buffer.byteLength(expected), sha256: createHash('sha256').update(expected).digest('hex') });
}
async function open(name) {
  current = name;
  if (frame && !frame.isDetached()) await frame.locator('.cm-content').focus();
  await press('Meta+p');
  await page.locator('.quick-input-widget:visible .quick-input-box input').fill(join(workspace, name));
  await page.locator('.quick-input-widget:visible .monaco-list-row').filter({ hasText: name }).first().click();
  await page.locator('.quick-input-widget').waitFor({ state: 'hidden' });
  const expected = await readFile(join(workspace, name), 'utf8');
  await wait(async () => {
    for (const candidate of page.frames()) if (!candidate.isDetached() && await candidate.locator('.cm-content').count()
      && await (await candidate.frameElement()).isVisible()
      && await candidate.evaluate(text => document.visibilityState === 'visible' && document.querySelector('.cm-content').cmTile.root.view.state.doc.toString() === text, expected).catch(() => false)) { frame = candidate; return true; }
    return false;
  }, 'active Markdown webview');
  await delay(150);
}
async function check(label, operation) {
  report.activeCheck = label;
  try { await operation(); report.checks.push(label); console.log(`PASS ${label}`); }
  catch (error) {
    report.failures.push({ label, error: String(error), source: await source().catch(() => undefined) });
    await page.screenshot({ path: join(artifacts, `failure-${report.failures.length}.png`) }).catch(() => {});
    console.error(`FAIL ${label}: ${error}`); await press('Escape');
  }
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
}
async function wait(condition, label, timeout = 10000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await condition()) return; await delay(80); } throw new Error(`Timed out: ${label}`); }
async function reservePort() { const server = createServer(); await new Promise(done => server.listen(0, '127.0.0.1', done)); const port = server.address().port; await new Promise(done => server.close(done)); return port; }
