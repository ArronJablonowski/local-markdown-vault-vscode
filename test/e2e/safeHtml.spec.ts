import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

const source = (page: import('@playwright/test').Page) => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString());
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

test('double-click selects HTML text instead of unexpectedly opening source', async ({ page }) => {
	await mountEditor(page, '# Start\n\n<div><p>Evidence</p></div>\n\nAfter');
	await page.locator('.mlp-safe-html p').dblclick({ position: { x: 25, y: 8 } });
	await expect(page.locator('.mlp-safe-html')).toHaveCount(1);
	expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('Evidence');
});

for (const width of [420, 1_440]) test(`wide HTML tables scroll without widening the editor at ${width}px`, async ({ page }) => {
	await page.setViewportSize({ width, height: 800 });
	const row = '<tr>' + Array.from({ length: 20 }, (_, i) => `<td>Column_${i}_${'wide'.repeat(12)}</td>`).join('') + '</tr>';
	await mountEditor(page, '# Start\n\n<div><table>' + row.repeat(25) + '</table></div>\n\nAfter sentinel');
	const dimensions = await page.locator('.mlp-safe-html').evaluate(el => {
		el.scrollLeft = 500;
		return { client: el.clientWidth, scroll: el.scrollWidth, left: el.scrollLeft, body: document.body.scrollWidth, viewport: innerWidth };
	});
	expect(dimensions.scroll).toBeGreaterThan(dimensions.client);
	expect(dimensions.left).toBeGreaterThan(0);
	expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
});

test('locked HTML interaction cannot modify the document', async ({ page }) => {
	const text = '# Start\n\n<div><details><summary>Details</summary><p>Protected text</p></details></div>\n\nAfter';
	await mountEditor(page, text, { editingMode: 'locked' });
	await page.locator('.mlp-safe-html summary').click();
	await page.getByRole('button', { name: 'Switch to code mode' }).click();
	await page.keyboard.type('Should not appear'); await page.keyboard.press('Backspace');
	expect(await source(page)).toBe(text);
});

test('HTML inside fenced code, inline prose, and callouts retains source boundaries', async ({ page }) => {
	const text = '# Start\n\n```html\n<div>Literal code</div>\n```\n\nInline <strong>literal prose</strong>.\n\n> [!note] Callout\n> <div>Literal quote</div>\n\n<div><p>Rendered HTML</p></div>\n\nAfter';
	await mountEditor(page, text);
	await expect(page.locator('.mlp-safe-html')).toHaveCount(1);
	await expect(page.locator('.mlp-safe-html p')).toHaveText('Rendered HTML');
	expect(await source(page)).toBe(text);
});

test('mouse selection across HTML preserves the preview and source button still works', async ({ page }) => {
	const text = '# Start\n\nBefore sentinel\n\n<div><p>HTML selection target</p></div>\n\nAfter sentinel';
	await mountEditor(page, text);
	const before = await page.locator('.cm-line').filter({ hasText: 'Before sentinel' }).boundingBox();
	const target = await page.locator('.mlp-safe-html p').boundingBox();
	await page.mouse.move(before!.x + 4, before!.y + before!.height / 2);
	await page.mouse.down();
	await page.mouse.move(target!.x + 120, target!.y + target!.height / 2, { steps: 15 });
	await page.mouse.up();
	await expect(page.locator('.mlp-safe-html')).toHaveCount(1);
	expect(await source(page)).toBe(text);
	await page.locator('.mlp-code-mode-host').filter({ has: page.locator('.mlp-safe-html') }).getByRole('button', { name: 'Switch to code mode' }).click();
	await expect(page.locator('.mlp-safe-html')).toHaveCount(0);
	await expect(page.locator('.cm-content')).toContainText('<div><p>HTML selection target</p></div>');
});

test('deep malformed HTML and active attributes remain bounded next to Markdown', async ({ page }) => {
	const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
	await mountEditor(page, '# Start\n\n<div>' + '<div>'.repeat(3_000) + 'Deep' + '</div>'.repeat(3_000) + '</div>\n\n## After\n\n- Item');
	await expect(page.locator('.mlp-safe-html')).toHaveCount(1);
	await page.locator('.cm-content').focus(); await page.keyboard.press(`${mod}+End`);
	await expect(page.locator('.cm-content')).toContainText('After');
	expect(errors).toEqual([]);
});

for (const neighbor of [
	'## Markdown heading\n\n**Bold** and *italic* with `inline code`.',
	'- First\n    - Nested\n- [ ] Task',
	'> [!warning] Meeting\n> Body\n> - Action',
	'| Owner | Status |\n| --- | --- |\n| Alex | Ready |',
	'```javascript\nconst value = "<div>literal</div>";\n```',
	'```mermaid\ngraph TD\nA --> B\n```',
]) test(`HTML stays separate from adjacent ${neighbor.slice(0, 25)}`, async ({ page }) => {
	const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
	const text = `# Start\n\n${neighbor}\n\n<div><p><strong>HTML sentinel</strong></p></div>\n\n${neighbor}\n\nEnd sentinel`;
	await mountEditor(page, text);
	await expect(page.locator('.mlp-safe-html strong')).toHaveText('HTML sentinel');
	await expect(page.locator('.cm-content')).toContainText('End sentinel');
	expect(await source(page)).toBe(text);
	await page.locator('.mlp-code-mode-host').filter({ has: page.locator('.mlp-safe-html') }).getByRole('button', { name: 'Switch to code mode' }).click();
	await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp');
	expect(await source(page)).toBe(text);
	expect(errors).toEqual([]);
});

test('editing HTML source and neighboring paragraphs preserves exact Markdown and requests host undo', async ({ page }) => {
	const text = '# Start\n\n<div><p>HTML sentinel</p></div>\n\nAfter sentinel';
	await mountEditor(page, text);
	await page.getByRole('button', { name: 'Switch to code mode' }).click();
	await page.keyboard.press('Home'); await page.keyboard.type('X');
	await expect.poll(() => source(page)).toBe(text.replace('<div>', 'X<div>'));
	await page.keyboard.press(`${mod}+z`);
	await expect.poll(() => page.evaluate(() => (window as any).__posted.some((message: any) => message.type === 'undo'))).toBe(true);
	// The browser harness has no host undo stack. Delete the typed character.
	await page.keyboard.press('Backspace');
	await expect.poll(() => source(page)).toBe(text);
	await page.keyboard.press(`${mod}+End`); await page.keyboard.press('Enter'); await page.keyboard.type('New paragraph');
	await expect.poll(() => source(page)).toBe(text + '\nNew paragraph');
});

test('expanded HTML details do not overlap the following Markdown', async ({ page }) => {
	await mountEditor(page, '# Start\n\n<div><details><summary>Expand</summary>' + '<p>Long content</p>'.repeat(60) + '</details></div>\n\nAfter sentinel');
	await page.locator('.mlp-safe-html summary').click();
	await expect(page.locator('.mlp-safe-html details')).toHaveAttribute('open', '');
	const after = page.locator('.cm-line').filter({ hasText: 'After sentinel' });
	await after.scrollIntoViewIfNeeded();
	const html = await page.locator('.mlp-safe-html').boundingBox();
	const next = await after.boundingBox();
	expect(next!.y).toBeGreaterThanOrEqual(html!.y + html!.height - 1);
});

for (const html of ['<div>' + '<span>x</span>'.repeat(2_001) + '</div>', '<div>' + 'x'.repeat(100_001) + '</div>'])
	test(`over-limit HTML stays literal (${html.length})`, async ({ page }) => {
		await mountEditor(page, '# Start\n\n' + html + '\n\nEnd');
		await expect(page.locator('.mlp-safe-html')).toHaveText(html);
		await expect(page.locator('.mlp-safe-html span')).toHaveCount(0);
	});

test('renders formatting HTML and reveals editable original source', async ({ page }) => {
	const html = '<div><h2>Meeting</h2><p><strong>Important</strong> <mark>decision</mark></p><ul><li>Action</li></ul><table><tr><th>Owner</th></tr><tr><td>Alex</td></tr></table><details><summary>More</summary>Evidence</details></div>';
	await mountEditor(page, '# Notes\n\n' + html + '\n\nEnd');
	const preview = page.locator('.mlp-safe-html');
	await expect(preview.locator('h2')).toHaveText('Meeting');
	await expect(preview.locator('li')).toHaveText('Action');
	await expect(preview.locator('td')).toHaveText('Alex');
	await preview.locator('summary').click();
	await expect(preview.locator('details')).toHaveAttribute('open', '');
	await page.getByRole('button', { name: 'Switch to code mode' }).click();
	await expect(page.locator('.cm-content')).toContainText(html);
});

test('HTML cannot introduce executable markup, URLs, attributes, or network loads', async ({ page }) => {
	const requests: string[] = [];
	page.on('request', request => { if (request.url().includes('attacker.invalid')) requests.push(request.url()); });
	await mountEditor(page, '# Notes\n\n<div style="position:fixed" onclick="alert(1)" id="controls"><b>Safe</b><img src="https://attacker.invalid/pixel"><a href="javascript:alert(1)">Link</a><script>alert(1)</script><iframe src="https://attacker.invalid/"></iframe><svg onload="alert(1)"></svg><form><input></form><template shadowrootmode="open">Hidden</template></div>\n\nEnd');
	const preview = page.locator('.mlp-safe-html');
	await expect(preview.locator('b')).toHaveText('Safe');
	await expect(preview.locator('script, img, a, iframe, svg, form, input, template, [style], [id], [onclick], [href], [src]')).toHaveCount(0);
	await page.waitForTimeout(200);
	expect(requests).toEqual([]);
});
