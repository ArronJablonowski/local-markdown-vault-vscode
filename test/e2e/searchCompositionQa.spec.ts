import { expect, test } from '@playwright/test';
import { mountEditor, openSearch } from './harness';

const original = 'alpha first\n\n> [!note] Agenda\n> alpha retained\n\nalpha last';
for (const editingMode of ['editing', 'locked'] as const) for (const field of ['search', 'replace']) for (const key of ['Enter', 'Escape']) for (const legacy of [false, true]) test(`${editingMode}: composing ${key} stays inside ${field}, legacy=${legacy}`, async ({ page }) => {
	await mountEditor(page, original, { editingMode });
	await openSearch(page);
	await page.locator('.cm-search input[name="search"]').fill('alpha');
	await page.keyboard.press('Enter');
	await page.getByRole('button', { name: 'Toggle Replace', exact: true }).click();
	await page.locator('.cm-search input[name="replace"]').fill('Revised');
	const input = page.locator(`.cm-search input[name="${field}"]`);
	await input.focus();
	const selection = () => page.locator('.cm-content').evaluate((el: any) => {
		const { from, to } = el.cmTile.root.view.state.selection.main;
		return { from, to };
	});
	const before = await selection();
	const prevented = await input.evaluate((element, options) => {
		element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: options.key, keyCode: options.legacy ? 229 : options.key === 'Enter' ? 13 : 27, isComposing: !options.legacy });
		element.dispatchEvent(event);
		return event.defaultPrevented;
	}, { key, legacy });
	expect(prevented).toBe(false); // Native input-method handling remains available.
	await expect(input).toBeFocused();
	expect(await selection()).toEqual(before);
	expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
	await input.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
	await input.press('Escape');
	await expect(page.locator('.cm-search')).toHaveCount(0);
});
