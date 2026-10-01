// Exercise native Command+V against external clipboard representations, not
// injected webview paste events. The parent runner preserves the real clipboard.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { pasteboard } from './macos-pasteboard.mjs';

const encoded = (type, text, encoding = 'utf8') => [type, Buffer.from(text, encoding).toString('base64')];
const plain = text => encoded('public.utf8-plain-text', text);
const html = text => encoded('public.html', text);
const normalize = text => text.replace(/\r\n?/g, '\n');

export async function runExternalPasteCases(api) {
  const { page, frame, open, press, source, selectAll, saved, check, traceClipboard, workspace, report, png } = api;
  const seed = entries => pasteboard('write', JSON.stringify(entries.length ? [entries] : []));
  async function prepare() {
    report.activeStage = 'prepare destination';
    await open('Sink.md');
    const toggle = frame().locator('.mlp-editing-mode-toggle');
    if (await toggle.getAttribute('aria-pressed') === 'true') await toggle.click();
    await traceClipboard(); await selectAll(); await page.keyboard.type('External selection to replace');
    await saved('External selection to replace'); await selectAll(); await traceClipboard();
  }
  async function observedPaste(tail = '') {
    report.activeStage = 'native external paste';
    await press('Meta+v');
    if (tail) await page.keyboard.type(tail, { delay: 2 });
    await delay(100);
    (report.externalEvents ??= []).push({ check: report.activeCheck,
      events: await frame().evaluate(() => window.__clipboardQaEvents),
      active: await frame().evaluate(() => ({ tag: document.activeElement?.tagName, className: document.activeElement?.className })),
      warnings: await frame().locator('[role="alert"]:visible').allTextContents() });
  }
  const fixtures = [
    ['UTF8 plain prose and Unicode', [plain('External caf\u00e9 e\u0301 \ud83d\ude80 \u4e2d\u6587\nSecond line.')], 'External caf\u00e9 e\u0301 \ud83d\ude80 \u4e2d\u6587\nSecond line.'],
    ['Windows CRLF text', [plain('First\r\nSecond\r\nThird')], 'First\nSecond\nThird'],
    ['plain text preserves whitespace', [plain('  leading and trailing  \n\nfinal  ')], '  leading and trailing  \n\nfinal  '],
    ['browser HTML plus plain text', [plain('External bold text\nSecond paragraph'), html('<p>External <b>bold</b> text</p><p>Second paragraph</p>')], 'External bold text\nSecond paragraph'],
    ['RTF plus plain text', [plain('External styled text'), encoded('public.rtf', '{\\rtf1\\ansi External \\b styled\\b0 text}')], 'External styled text'],
    ['UTF16-only native plain text', [encoded('public.utf16-plain-text', '\ufeffUTF16 caf\u00e9 \ud83d\ude80', 'utf16le')], 'UTF16 caf\u00e9 \ud83d\ude80'],
    ['spreadsheet TSV', [plain('Name\tCount\nApples\t3\nPears\t7'), html('<table><tr><td>Name</td><td>Count</td></tr><tr><td>Apples</td><td>3</td></tr></table>')], '| Name | Count |\n| --- | --- |\n| Apples | 3 |\n| Pears | 7 |\n\n'],
    ['mixed text and raster representation prefers text', [plain('Copied external text, not a screenshot'), ['public.png', png]], 'Copied external text, not a screenshot'],
    ['HTML text and raster representation prefers text', [plain('Web selection with an image'), html('<p>Web selection with an image</p>'), ['public.png', png]], 'Web selection with an image'],
    ['text with malformed raster fallback', [plain('Retain valid plain text'), encoded('public.png', 'invalid image bytes')], 'Retain valid plain text'],
    ['code copied with indentation is not a spreadsheet', [plain('function example() {\n\treturn "hello";\n}\n')], 'function example() {\n\treturn "hello";\n}\n'],
    ['HTML stays inert when plain source includes tags', [plain('<script>doNotExecute()</script>\n<img src="https://external-paste.invalid/tracker">'), html('<script>doNotExecute()</script><img src="https://external-paste.invalid/tracker">')], '<script>doNotExecute()</script>\n<img src="https://external-paste.invalid/tracker">'],
  ];
  for (const [label, entries, expected] of fixtures) await check(`External: ${label}`, async () => {
    await prepare(); seed(entries); await observedPaste(); await saved(expected, 3000);
  });
  for (const [label, entries] of [
    ['HTML-only paste preserves the selection and explains rejection', [html('<b>HTML without plain text</b>')]],
    ['empty clipboard preserves the selection and explains rejection', []],
  ]) await check(`External: ${label}`, async () => {
    await prepare(); seed(entries); await observedPaste(); await saved('External selection to replace');
    assert.ok((await frame().locator('[role="alert"]:visible').allTextContents()).length > 0, 'Missing paste rejection message');
  });
  await check('External: repeated paste followed immediately by typing stays in order', async () => {
    await prepare(); seed([plain('EXTERNAL')]); await observedPaste(' tail');
    for (let index = 0; index < 4; index++) { await press('Meta+v'); await page.keyboard.type(` ${index}`); }
    const expected = 'EXTERNAL tail' + Array.from({ length: 4 }, (_, i) => `EXTERNAL ${i}`).join('');
    await saved(expected); await delay(1000); await saved(expected);
  });
  await check('External: Command+V immediately after mouse unlock reaches the document', async () => {
    await prepare(); seed([plain('Pasted immediately after unlock')]);
    const toggle = frame().locator('.mlp-editing-mode-toggle');
    await toggle.click(); await toggle.click(); await observedPaste(); await saved('Pasted immediately after unlock', 3000);
  });
  await check('External: consecutive plain-text table-cell pastes keep the insertion target', async () => {
    await open('TablePaste.md');
    const cell = frame().locator('.mlp-table td').first();
    await cell.click(); await press('Meta+a'); await traceClipboard();
    seed([plain('First')]); await observedPaste();
    const first = (await source()).replace('Original', 'First');
    assert.ok(first.includes('| First | Keep |')); await saved(first);
    seed([plain('Second')]); await observedPaste();
    await saved(first.replace('| First | Keep |', '| FirstSecond | Keep |'), 3000);
  });
  await check('External: Tab then typing and paste in the next table cell preserves the draft', async () => {
    await open('TabPaste.md'); await traceClipboard(); await frame().locator('.mlp-table td').first().click(); await press('Meta+a');
    await page.keyboard.type('Left'); await press('Tab'); await page.keyboard.type('Typed');
    seed([plain('External')]); await observedPaste();
    const actual = await source();
    assert.ok(actual.includes('| Left | TypedExternal |'), 'Tab then paste lost the typed table draft');
    await saved(actual);
  });
  await check('External: large plain text with tabs pastes exactly and saves', async () => {
    const expected = '# External report\n\n' + 'Paragraph content from another application.\n\n```text\n\tindented\n```\n\n'.repeat(4300);
    await prepare(); seed([plain(expected)]); await observedPaste(); await saved(expected, 30000);
  });
  await check('External: raster-only native paste still creates one local attachment', async () => {
    await open('Images.md'); await frame().locator('.cm-content').focus(); await press('Meta+ArrowDown');
    const before = await source(), files = await readdir(join(workspace, 'assets')).catch(() => []);
    seed([['public.png', png]]); await observedPaste();
    for (let i = 0; i < 100 && await source() === before; i++) await delay(50);
    const after = await source(); assert.notEqual(after, before); await saved(after);
    const current = await readdir(join(workspace, 'assets'));
    assert.equal(current.length, files.length + 1);
    const bytes = await readFile(join(workspace, 'assets', current.find(name => !files.includes(name))));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  });

  // A separate visible browser supplies actual browser-generated clipboard HTML
  // and text. Selection and copy happen through keys; no clipboard API is used.
  const external = await chromium.launch({ headless: false, chromiumSandbox: true });
  try {
    const browserPage = await external.newPage();
    await browserPage.route('**/*', route => route.abort());
    const sources = [
      ['real browser multiline selection', '<div contenteditable="true">External browser text<br>Second line caf\u00e9 \ud83d\ude80</div>', 'External browser text\nSecond line caf\u00e9 \ud83d\ude80'],
      ['real browser rich-text selection', '<div contenteditable="true"><p>External <strong>bold</strong> and <em>italic</em>.</p><p>Second paragraph.</p></div>', 'External bold and italic.\n\nSecond paragraph.'],
      ['real browser table selection', '<div contenteditable="true"><table><tr><td>Item</td><td>Count</td></tr><tr><td>Apple</td><td>4</td></tr></table></div>', '| Item | Count |\n| --- | --- |\n| Apple | 4 |\n\n'],
      ['real browser code selection', '<div contenteditable="true"><pre>const external = 42;\n\tconsole.log(external);</pre></div>', 'const external = 42;\n\tconsole.log(external);'],
    ];
    for (const [label, markup, expected] of sources) await check(`External: ${label}`, async () => {
      await page.bringToFront(); await prepare();
      await browserPage.setContent(markup); await browserPage.bringToFront();
      await browserPage.locator('[contenteditable]').click(); await browserPage.keyboard.press('Meta+a'); await browserPage.keyboard.press('Meta+c');
      // Inspect only these synthetic selections after copying, never personal
      // clipboard contents, to separate source-app delivery from editor failures.
      (report.externalSourceCopies ??= []).push({ check: report.activeCheck,
        selection: await browserPage.evaluate(() => window.getSelection()?.toString()),
        clipboard: JSON.parse(pasteboard('read')).map(item => item.map(([type, value]) => ({ type,
          bytes: Buffer.from(value, 'base64').length,
          text: type === 'public.utf8-plain-text' ? Buffer.from(value, 'base64').toString() : undefined }))) });
      // Returning to the app must retain the destination, without an extra click.
      await page.bringToFront(); await observedPaste(); await saved(normalize(expected), 5000);
    });
    await check('External: typed table cell retains its paste target after copying in another app', async () => {
      await page.bringToFront(); await open('AppPaste.md');
      const original = await source();
      await frame().locator('.mlp-table td').first().click(); await press('Meta+a');
      await page.keyboard.type('Typed', { delay: 6 }); await traceClipboard();
      assert.equal(await frame().locator('.mlp-table td').first().textContent(), 'Typed');
      await browserPage.setContent('<div contenteditable="true">External</div>'); await browserPage.bringToFront();
      await browserPage.locator('[contenteditable]').click(); await browserPage.keyboard.press('Meta+a'); await browserPage.keyboard.press('Meta+c');
      await page.bringToFront(); await observedPaste();
      await saved(original.replace(/\| [^\n|]* \| Keep \|/, '| TypedExternal | Keep |'), 3000);
    });
  } finally { await external.close(); await page.bringToFront(); }
}
