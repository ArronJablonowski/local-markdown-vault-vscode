import { expect, test } from '@playwright/test';
import { mountEditor, openSearch } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const original = 'needle first\n\n- [ ] Task\n\n> [!note] Agenda\n> Retain this\n\n| Owner | State |\n| --- | --- |\n| Alex | Keep |\n\n```js\nconst value = 1;\n```\n\nneedle last';

for (const editingMode of ['editing', 'locked'] as const) for (const control of ['.mlp-checkbox', '.mlp-callout-header', '.mlp-copy-code-btn', '.mlp-table-options-btn', '.mlp-table-toolbar button:not(:disabled)', '.mlp-table tbody td', '.mlp-table-wrap .mlp-code-mode-btn']) for (const key of ['F3', 'Shift+F3', `${mod}+g`, `${mod}+Shift+g`]) {
	test(`${editingMode} ${control} hands ${key} results to immediate typing`, async ({ page }) => {
		await mountEditor(page, original, { editingMode });
		await openSearch(page);
		await page.locator('.cm-search input[name="search"]').fill('needle');
		await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
		if (control.includes('.mlp-table-toolbar')) await page.locator('.mlp-table-options-btn').click();
		await page.locator(control).first().focus(); await page.keyboard.press(key);
		const range = await page.locator('.cm-content').evaluate((el: any) => {
			const { from, to } = el.cmTile.root.view.state.selection.main;
			return { from, to };
		});
		await page.keyboard.type('Revised');
		await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(editingMode === 'locked' ? original : original.slice(0, range.from) + 'Revised' + original.slice(range.to));
	});
}

for (const key of ['F3', `${mod}+g`]) test(`queryless ${key} opens a focused search field rather than typing into the note`, async ({ page }) => {
	await mountEditor(page, original);
	await page.locator('.mlp-callout-header').focus(); await page.keyboard.press(key);
	await expect(page.locator('.cm-search input[name="search"]')).toBeFocused();
	await page.keyboard.type('needle');
	await expect(page.locator('.cm-search input[name="search"]')).toHaveValue('needle');
	expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
});
