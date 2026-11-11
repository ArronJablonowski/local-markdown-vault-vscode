import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const errors = new WeakMap<object, string[]>();
test.beforeEach(({ page }) => {
	const found: string[] = []; errors.set(page, found);
	page.on('pageerror', error => found.push(error.message));
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

for (const editingMode of ['editing', 'locked'] as const) for (const nested of [false, true]) for (const change of ['font', 'padding', 'spacing']) {
	test(`${editingMode}: ${change} theme change updates natural resize values, nested=${nested}`, async ({ page }) => {
		const table = '| Review agenda | Owner |\n| --- | --- |\n| **Decisions** with *follow up* | Alex |\n| <ul><li>First</li><li>Second</li></ul> | Team |';
		const original = '# Meeting\n\n' + (nested ? '> [!abstract] Summary\n>\n> ' + table.split('\n').join('\n> ') : table) + '\n\n- [ ] Follow up #work\n\n```js\nconst result = 1;\n```\n\nAfter';
		await mountEditor(page, original, { editingMode });
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
		const width = () => handle.evaluate(handle => handle.closest('th')!.getBoundingClientRect().width);
		const before = await width();
		const css = change === 'font' ? 'font-size: 28px !important' : change === 'padding' ? 'padding-left: 45px !important; padding-right: 45px !important' : 'letter-spacing: 5px !important';
		await page.addStyleTag({ content: `.mlp-table :is(th,td) { ${css}; }` });
		await expect.poll(async () => Math.abs(await width() - before)).toBeGreaterThan(5);
		await expect.poll(() => handle.evaluate(handle => Math.abs(Number(handle.getAttribute('aria-valuenow')) - Math.round(handle.closest('th')!.getBoundingClientRect().width)))).toBeLessThanOrEqual(1);
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
	});
}

for (const nested of [false, true]) for (const value of ['**Detailed**<br>Second line<br>Third line', '<ul><li>First decision<ul><li>Nested decision with long explanation</li></ul></li></ul>', '`identifier` and [follow up](Notes.md) '.repeat(12)]) {
	test(`fixed widths retain tracks and adapt row height after external rich-text changes, nested=${nested}, value=${value.slice(0, 20)}`, async ({ page }) => {
		const table = '| Review | Owner |\n| --- | --- |\n| Seed | Team |';
		const original = 'Before\n\n' + (nested ? '> [!tip] Meeting\n>\n> ' + table.split('\n').join('\n> ') : table) + '\n\nAfter';
		await mountEditor(page, original);
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
		await handle.focus();
		for (let n = 0; n < 55; n++) await page.keyboard.press('Shift+ArrowLeft');
		const cell = page.locator('.mlp-table td').first();
		const height = await cell.evaluate(cell => cell.getBoundingClientRect().height);
		const from = original.indexOf('Seed');
		await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from, to: from + 4, insert: value }] });
		await expect(handle).toHaveAttribute('aria-valuenow', '64');
		await expect.poll(() => cell.evaluate(cell => cell.getBoundingClientRect().height)).toBeGreaterThan(height);
		await postToWebview(page, { type: 'externalUpdate', version: 2, changes: [{ from, to: from + value.length, insert: 'Seed' }] });
		await expect.poll(() => cell.evaluate((cell, height) => Math.abs(cell.getBoundingClientRect().height - height), height)).toBeLessThan(2);
		await expect(handle).toHaveAttribute('aria-valuenow', '64');
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
	});
}
