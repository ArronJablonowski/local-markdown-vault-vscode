import { expect, test } from '@playwright/test';
import { mountEditor, openSearch } from './harness';

for (const html of [
	'<ul><li onclick="alert(1)">Safe<li><img src="https://attacker.invalid/pixel"></ul>',
	'<table><tr><td style="position:fixed">Safe<td><img src="https://attacker.invalid/pixel" onerror="alert(1)"></table>',
	'<div><p>Safe<p><script>alert(1)</script><a href="javascript:alert(1)">Label</a></div>',
]) test(`optional end tags do not bypass sanitization: ${html.slice(0, 25)}`, async ({ page }) => {
	const requests: string[] = []; page.on('request', request => { if (request.url().includes('attacker.invalid')) requests.push(request.url()); });
	await mountEditor(page, '# Notes\n\n' + html + '\n\nAfter', { remoteMedia: 'https' });
	await expect(page.locator('.mlp-safe-html')).toContainText('Safe');
	await expect(page.locator('.mlp-safe-html script, .mlp-safe-html img, .mlp-safe-html [style], .mlp-safe-html [onclick], .mlp-safe-html [href]')).toHaveCount(0);
	await page.waitForTimeout(100); expect(requests).toEqual([]);
});

test('individual-key HTML entry does not insert untyped closing tags', async ({ page }) => {
	await mountEditor(page, '# Notes\n\n');
	await page.locator('.cm-content').focus();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
	const html = '<ul><li>First<li>Second</ul>';
	for (const character of html) await page.keyboard.type(character, { delay: 3 });
	await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe('# Notes\n\n' + html);
});

for (const [name, html, selector, texts] of [
	['list', '<ul><li>First<li>Second<li>Third</ul>', 'li', ['First', 'Second', 'Third']],
	['table', '<table><tr><th>Owner<th>Status<tr><td>Alex<td>Ready</table>', 'tr', ['OwnerStatus', 'AlexReady']],
	['paragraph', '<div><p>First paragraph<p>Second paragraph</div>', 'p', ['First paragraph', 'Second paragraph']],
] as const) test(`valid HTML with omitted ${name} end tags renders beside Markdown`, async ({ page }) => {
	await mountEditor(page, `# Notes\n\n${html}\n\n## Following Markdown\n\n- Action`);
	await expect(page.locator('.mlp-safe-html').locator(selector)).toHaveText([...texts]);
	await expect(page.locator('.cm-content')).toContainText('Following Markdown');
});

test('regex Find reveals a target inside nested collapsed HTML without changing source', async ({ page }) => {
	const text = '# Notes\n\n<div><details><summary>Meeting</summary><details><summary>Evidence</summary><p>asset-418</p></details></details></div>\n\nAfter';
	await mountEditor(page, text);
	await openSearch(page);
	await page.locator('.cm-search input[name="search"]').fill('asset-\\d+');
	await page.locator('.cm-search label').filter({ has: page.locator('input[name="re"]') }).click();
	await page.locator('.cm-search input[name="search"]').press('Enter');
	await page.locator('.cm-search input[name="search"]').press('Escape');
	await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('asset-418');
	await expect(page.locator('.cm-content')).toContainText('<p>asset-418</p>');
	expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(text);
});
