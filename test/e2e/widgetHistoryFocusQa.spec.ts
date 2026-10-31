import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const note = '# Before\n\n- [ ] Task\n\n> [!note] Agenda\n> Retained evidence\n\n| Owner | State |\n| --- | --- |\n| Alex | Keep |\n\n```js\n' + 'const value = 1;\n'.repeat(9) + '```\n\nAfter sentinel';
const controls = ['.mlp-checkbox', '.mlp-callout-header', '.mlp-table-options-btn', '.mlp-table-toolbar button:not(:disabled)', '.mlp-table tbody td', '.mlp-table-wrap .mlp-code-mode-btn', '.mlp-copy-code-btn', '.mlp-collapse-code-btn'];

for (const mode of ['editing', 'locked'] as const) for (const control of controls) {
	for (const key of ['a', 'f', 'Alt+f']) test(`${control} owns note command ${key} in ${mode}`, async ({ page }) => {
		await mountEditor(page, note, { editingMode: mode });
		await page.evaluate(() => {
			(window as any).__forwardedNoteKeys = [];
			window.addEventListener('keydown', event => {
				if ((event.metaKey || event.ctrlKey) && ['a', 'f'].includes(event.key.toLowerCase())) (window as any).__forwardedNoteKeys.push(event.key);
			});
		});
		if (control.includes('.mlp-table-toolbar')) await page.locator('.mlp-table-options-btn').click();
		await page.locator(control).first().focus();
		await page.keyboard.press(`${mod}+${key}`);
		if (key === 'a') {
			expect(await page.locator('.cm-content').evaluate((el: any) => {
				const range = el.cmTile.root.view.state.selection.main;
				return { from: range.from, to: range.to };
			})).toEqual({ from: 0, to: note.length });
			await page.keyboard.type('Replacement note');
			await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(mode === 'editing' ? 'Replacement note' : note);
		} else {
			await expect(page.locator('.cm-search input[name="search"]')).toBeFocused();
			expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(note);
		}
		expect(await page.evaluate(() => (window as any).__forwardedNoteKeys)).toEqual([]);
	});
	for (const [key, action] of [['z', 'undo'], ['Shift+z', 'redo'], ['y', 'redo']]) {
		test(`${control} owns ${key} exactly once in ${mode}`, async ({ page }) => {
			await mountEditor(page, note, { editingMode: mode });
			await page.evaluate(() => {
				(window as any).__forwardedHistory = [];
				window.addEventListener('keydown', event => {
					if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) (window as any).__forwardedHistory.push(event.key);
				});
			});
			if (control.includes('.mlp-table-toolbar')) await page.locator('.mlp-table-options-btn').click();
			const button = page.locator(control).first();
			await button.focus();
			await expect(button).toBeFocused();
			await page.keyboard.press(`${mod}+${key}`);
			await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((message: any) => ['undo', 'redo'].includes(message.type)).map((message: any) => message.type))).toEqual(mode === 'editing' ? [action] : []);
			expect(await page.evaluate(() => (window as any).__forwardedHistory)).toEqual([]);
			expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(note);
		});
	}
}
