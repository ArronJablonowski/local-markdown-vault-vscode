import { expect, test } from '@playwright/test';
import { mountEditor, openSearch } from './harness';

const note = 'Before TOKEN\n\n```text\nTOKEN\n```\n\n| Owner | State |\n| --- | --- |\n| TOKEN | Keep |\n\nAfter';
const grid = 'Name\tValue\nCafé\t😀';
for (const editingMode of ['editing', 'locked'] as const) for (const format of ['plain', 'grid-only', 'grid-and-plain', 'html-only']) test(`${editingMode}: ${format} paste preserves multiple selections across prose, code, and table source`, async ({ page }) => {
	await mountEditor(page, note, { editingMode });
	await openSearch(page); await page.locator('.cm-search input[name="search"]').fill('TOKEN');
	await page.locator('.cm-search button[name="select"]').click();
	await page.keyboard.press('Escape');
	expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.selection.ranges.length)).toBe(3);
	await page.locator('.cm-content').evaluate((element, options) => {
		const data = new DataTransfer();
		if (options.format.includes('grid')) data.setData('text/tab-separated-values', options.grid);
		if (options.format === 'plain' || options.format === 'grid-and-plain') data.setData('text/plain', options.grid);
		if (options.format === 'html-only') data.setData('text/html', '<table><tr><td>Retain source</td></tr></table>');
		element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
	}, { format, grid });
	const expected = editingMode === 'editing' && ['plain', 'grid-and-plain'].includes(format) ? note.replaceAll('TOKEN', grid) : note;
	await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(expected);
	await expect.poll(() => page.evaluate(initial => {
		let result = initial;
		for (const message of (window as any).__posted) if (message.type === 'edit') {
			for (const change of [...message.changes].reverse()) result = result.slice(0, change.from) + change.insert + result.slice(change.to);
		}
		return result;
	}, note)).toBe(expected);
});

for (const editingMode of ['editing', 'locked'] as const) for (const action of ['copy', 'cut']) test(`${editingMode}: ${action} includes every selected source range`, async ({ page }) => {
	await mountEditor(page, note, { editingMode });
	await openSearch(page); await page.locator('.cm-search input[name="search"]').fill('TOKEN');
	await page.locator('.cm-search button[name="select"]').click(); await page.keyboard.press('Escape');
	const copied = await page.locator('.cm-content').evaluate((element, type) => {
		const data = new DataTransfer();
		element.dispatchEvent(new ClipboardEvent(type, { clipboardData: data, bubbles: true, cancelable: true }));
		return data.getData('text/plain');
	}, action);
	expect(copied).toBe('TOKEN\nTOKEN\nTOKEN');
	const expected = editingMode === 'editing' && action === 'cut' ? note.replaceAll('TOKEN', '') : note;
	await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(expected);
});
