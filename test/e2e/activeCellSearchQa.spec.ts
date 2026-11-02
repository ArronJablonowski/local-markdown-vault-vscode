import { expect, test } from '@playwright/test';
import { mountEditor, openSearch } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const note = 'Before\n\n| Owner | State |\n| --- | --- |\n| Original | Retain |\n\nAfter sentinel';

for (const prefix of ['', '> [!note] Agenda\n>\n']) for (const key of [`${mod}+f`, `${mod}+Alt+f`]) test(`active cell ${key} opens note search without losing edits, callout=${!!prefix}`, async ({ page }) => {
	const original = prefix ? prefix + note.split('\n').map(line => '> ' + line).join('\n') : note;
	await mountEditor(page, original);
	await page.locator('.mlp-table td').first().click();
	await page.keyboard.press(`${mod}+a`); await page.keyboard.type('Revised owner');
	await page.keyboard.press(key);
	await expect(page.locator('.cm-search input[name="search"]')).toBeFocused();
	await page.keyboard.type('sentinel');
	await expect(page.locator('.cm-search input[name="search"]')).toHaveValue('sentinel');
	expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.replace('Original', 'Revised owner'));
});

for (const nested of [false, true]) for (const value of ['Revised owner', 'Revised | owner 😀']) for (const key of ['F3', 'Shift+F3', `${mod}+g`, `${mod}+Shift+g`]) test(`active cell search traversal ${key} preserves ${value} and hands typing to the result, nested=${nested}`, async ({ page }) => {
	const body = 'needle first\n\n' + note + '\n\nneedle last';
	const original = nested ? '> [!note] Agenda\n>\n' + body.split('\n').map(line => '> ' + line).join('\n') : body;
	await mountEditor(page, original);
	await openSearch(page); await page.locator('.cm-search input[name="search"]').fill('needle');
	await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
	await page.locator('.mlp-table td').first().click();
	await page.keyboard.press(`${mod}+a`); await page.keyboard.insertText(value);
	await page.keyboard.press(key);
	const range = await page.locator('.cm-content').evaluate((el: any) => {
		const state = el.cmTile.root.view.state;
		return { from: state.selection.main.from, to: state.selection.main.to, text: state.sliceDoc(state.selection.main.from, state.selection.main.to) };
	});
	expect(range.text).toBe('needle');
	await page.keyboard.type('Updated');
	const revised = original.replace('Original', value.replaceAll('|', '\\|'));
	await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(revised.slice(0, range.from) + 'Updated' + revised.slice(range.to));
});

for (const key of ['F3', `${mod}+g`]) test(`active cell without an existing query opens Find on ${key}`, async ({ page }) => {
	await mountEditor(page, note);
	await page.locator('.mlp-table td').first().click();
	await page.keyboard.press(`${mod}+a`); await page.keyboard.type('Saved owner');
	await page.keyboard.press(key);
	await expect(page.locator('.cm-search input[name="search"]')).toBeFocused();
	await page.keyboard.type('sentinel');
	await expect(page.locator('.cm-search input[name="search"]')).toHaveValue('sentinel');
	expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(note.replace('Original', 'Saved owner'));
});
