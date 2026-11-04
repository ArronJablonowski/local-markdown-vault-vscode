import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

for (const nested of [false, true]) for (const marker of ['-', '*', '+']) test(`${marker} bullets retain continuation and tab depth after table resizing, callout=${nested}`, async ({ page }) => {
	const prefix = nested ? '> ' : '';
	const table = '| Owner | State |\n| --- | --- |\n| Alex | Retained |\n\n';
	const original = 'Before\n\n' + table + (nested ? '> [!note] Meeting\n' : '## Meeting\n') + prefix + marker + ' Parent';
	await mountEditor(page, original);
	await page.getByRole('separator', { name: 'Resize column 1', exact: true }).focus();
	await page.keyboard.press('Shift+ArrowRight');
	await page.locator('.cm-line', { hasText: 'Parent' }).click(); await page.keyboard.press('End');
	await page.keyboard.press('Enter'); await page.keyboard.type('Sibling');
	const source = () => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString());
	await expect.poll(source).toBe(original + `\n${prefix}${marker} Sibling`);
	await page.keyboard.press('Tab');
	await expect.poll(source).toBe(original + `\n${prefix}    ${marker} Sibling`);
	await page.keyboard.press('Enter'); await page.keyboard.type('Child');
	await expect.poll(source).toBe(original + `\n${prefix}    ${marker} Sibling\n${prefix}    ${marker} Child`);
	await page.keyboard.press('Shift+Tab'); await page.keyboard.press('End');
	await page.keyboard.press('Enter'); await page.keyboard.type('Next');
	await expect.poll(source).toBe(original + `\n${prefix}    ${marker} Sibling\n${prefix}${marker} Child\n${prefix}${marker} Next`);
});
