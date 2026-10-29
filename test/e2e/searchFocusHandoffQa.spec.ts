import { expect, test } from '@playwright/test';
import { mountEditor, openSearch } from './harness';

const source = (page: import('@playwright/test').Page) => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString());

for (const editingMode of ['editing', 'locked'] as const) for (const activation of ['mouse', 'Enter', 'Space'] as const) test(`${editingMode}: expanding Replace with ${activation} routes subsequent typing into the replacement field`, async ({ page }) => {
	const text = '# Meeting\n\nOriginal decision.\n\nRetained evidence.';
	await mountEditor(page, text, { editingMode });
	await openSearch(page);
	await page.locator('.cm-search input[name="search"]').fill('Original');
	await page.locator('.cm-search input[name="search"]').press('Enter');
	const toggle = page.getByRole('button', { name: 'Toggle Replace' });
	if (activation === 'mouse') await toggle.click();
	else {
		await page.keyboard.press('Shift+Tab');
		await expect(toggle).toBeFocused();
		await page.keyboard.press(activation);
	}
	await page.keyboard.type('Revised', { delay: 10 });
	await expect(page.locator('.cm-search input[name="replace"]')).toHaveValue('Revised');
	expect(await source(page)).toBe(text);
	await toggle.click();
	await expect(page.locator('.cm-search input[name="search"]')).toBeFocused();
	await page.keyboard.type(' query');
	expect(await source(page)).toBe(text);
});
