import { expect, test } from '@playwright/test';
import { mountEditor, openSearch } from './harness';

const source = (page: import('@playwright/test').Page) => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString());

test('repeated replacement crosses callouts, tasks, tables and code without altering surrounding syntax', async ({ page }) => {
	const text = '# Review\n\n> [!note] Agenda\n> alpha item\n> - [ ] alpha task\n\n| Topic |\n| --- |\n| alpha cell |\n\n```txt\nalpha code\n```\n\nalpha conclusion';
	await mountEditor(page, text);
	await openSearch(page);
	await page.locator('input[name="search"]').pressSequentially('alpha');
	await page.getByRole('button', { name: 'Toggle Replace' }).click();
	await page.keyboard.type('beta');
	// Replace Next may first select a match; repeat until every object is visited.
	for (let attempt = 0; attempt < 10 && (await source(page)).includes('alpha'); attempt++) {
		await page.locator('button[name="replace"]').click();
	}
	expect(await source(page)).toBe(text.replaceAll('alpha', 'beta'));
	await page.locator('input[name="search"]').fill('beta');
	await page.locator('input[name="replace"]').fill('gamma');
	await page.locator('button[name="replaceAll"]').click();
	expect(await source(page)).toBe(text.replaceAll('alpha', 'gamma'));
	await page.locator('input[name="search"]').press('Escape');
	await expect(page.locator('.cm-search')).toHaveCount(0);
	expect(await source(page)).toBe(text.replaceAll('alpha', 'gamma'));
});

test('open replacement controls follow lock transitions and replace all after unlocking', async ({ page }) => {
	const text = '# Meeting\n\nDecision alpha. Decision alpha.\n';
	await mountEditor(page, text);
	await openSearch(page);
	await page.locator('input[name="search"]').fill('alpha');
	await page.getByRole('button', { name: 'Toggle Replace' }).click();
	await page.locator('input[name="replace"]').fill('beta');
	const replace = page.locator('button[name="replace"]');
	const all = page.locator('button[name="replaceAll"]');
	await expect(all).toBeEnabled();
	await page.locator('.mlp-editing-mode-toggle').click();
	await expect(all).toBeDisabled();
	await expect(replace).toBeDisabled();
	expect(await source(page)).toBe(text);
	await page.locator('.mlp-editing-mode-toggle').click();
	await expect(all).toBeEnabled();
	await expect(replace).toBeEnabled();
	await all.click();
	expect(await source(page)).toBe(text.replaceAll('alpha', 'beta'));
});

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
