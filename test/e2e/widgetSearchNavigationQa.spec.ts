import { expect, test } from '@playwright/test';
import { mountEditor, openSearch } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const note = 'needle first\n\n- [ ] Task\n\n> [!note] Agenda\n> Details\n\n| Owner | State |\n| --- | --- |\n| Alex | Keep |\n\n```js\nconst value = 1;\n```\n\nneedle last';

for (const editingMode of ['editing', 'locked'] as const) for (const control of ['.mlp-checkbox', '.mlp-callout-header', '.mlp-copy-code-btn', '.mlp-table-options-btn', '.mlp-table-toolbar button:not(:disabled)', '.mlp-table tbody td', '.mlp-table-wrap .mlp-code-mode-btn']) for (const key of ['F3', `${mod}+g`, 'Shift+F3', `${mod}+Shift+g`]) {
	test(`${editingMode} ${control} continues note search with ${key}`, async ({ page }) => {
		await mountEditor(page, note, { editingMode });
		await openSearch(page);
		await page.locator('.cm-search input[name="search"]').fill('needle');
		await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
		const selection = () => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.selection.main.from);
		const before = await selection();
		if (control.includes('.mlp-table-toolbar')) await page.locator('.mlp-table-options-btn').click();
		await page.locator(control).first().focus();
		await page.keyboard.press(key);
		await expect.poll(selection).toBe(before === 0 ? note.lastIndexOf('needle') : 0);
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(note);
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	});
}
