import { test, expect } from '@playwright/test';
import { mountEditor, openSearch } from './harness';

const DOC = '# Heading\n\nSome text with a needle in it.\n\n![alt](assets/pic.png)\n';

test.describe('find panel', () => {
	test.beforeEach(async ({ page }) => {
		await mountEditor(page, DOC);
	});

	test('Ctrl+F opens it', async ({ page }) => {
		await openSearch(page);
		await expect(page.locator('.cm-search')).toBeVisible();
		await expect(page.locator('.cm-search input[name="search"]')).toBeFocused();
	});

	test('replace is hidden until the chevron is clicked', async ({ page }) => {
		await openSearch(page);
		const replaceField = page.locator('.cm-search input[name="replace"]');
		await expect(replaceField).toBeHidden();
		await page.locator('.mlp-search-toggle').click();
		await expect(replaceField).toBeVisible();
	});

	test('opening replace does not change the panel width', async ({ page }) => {
		await openSearch(page);
		const panel = page.locator('.cm-search');
		const before = (await panel.boundingBox())!.width;
		await page.locator('.mlp-search-toggle').click();
		await expect(page.locator('.cm-search input[name="replace"]')).toBeVisible();
		const after = (await panel.boundingBox())!.width;
		expect(after).toBeCloseTo(before, 0);
	});

	test('replace always starts on its own line', async ({ page }) => {
		await openSearch(page);
		await page.locator('.mlp-search-toggle').click();
		const find = (await page.locator('.mlp-search-row-find').boundingBox())!;
		const replace = (await page.locator('.mlp-search-row-replace').boundingBox())!;
		// The replace row begins below every part of the find row, however the
		// find row itself has wrapped.
		expect(replace.y).toBeGreaterThanOrEqual(find.y + find.height - 1);
	});

	test('rows survive a narrow panel', async ({ page }) => {
		await page.setViewportSize({ width: 420, height: 600 });
		await openSearch(page);
		await page.locator('.mlp-search-toggle').click();
		const panel = (await page.locator('.cm-search').boundingBox())!;
		for (const name of ['search', 'replace']) {
			const field = (await page.locator(`.cm-search input[name="${name}"]`).boundingBox())!;
			// Nothing may hang outside the widget, which is what happened when a row
			// was not allowed to wrap.
			expect(field.x).toBeGreaterThanOrEqual(panel.x - 1);
			expect(field.x + field.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
		}
	});

	test('the toggles are readable, not collapsed glyphs', async ({ page }) => {
		await openSearch(page);
		for (const label of ['Aa', '.*']) {
			const glyph = page.locator('.mlp-search-glyph', { hasText: label }).first();
			await expect(glyph).toBeVisible();
			const box = (await glyph.boundingBox())!;
			expect(box.width).toBeGreaterThan(4);
			expect(box.height).toBeGreaterThan(6);
		}
	});

	test('the close button sits on the panel, vertically centered', async ({ page }) => {
		await openSearch(page);
		await page.locator('.mlp-search-toggle').click();
		const panel = (await page.locator('.cm-search').boundingBox())!;
		const close = (await page.locator('.cm-search button[name="close"]').boundingBox())!;
		const panelMiddle = panel.y + panel.height / 2;
		const closeMiddle = close.y + close.height / 2;
		expect(Math.abs(closeMiddle - panelMiddle)).toBeLessThanOrEqual(2);
	});

	test('the close button renders its glyph, not a mangled escape', async ({ page }) => {
		await openSearch(page);
		const text = await page.locator('.cm-search button[name="close"]').evaluate((el) => {
			const before = getComputedStyle(el, '::before').content;
			return before;
		});
		expect(text).toContain('×');
		expect(text).not.toContain('d7');
	});

	test('Escape closes it', async ({ page }) => {
		await openSearch(page);
		await page.keyboard.press('Escape');
		await expect(page.locator('.cm-search')).toHaveCount(0);
	});

	test('pasted find and replacement text are committed before the first Enter', async ({ page }) => {
		await openSearch(page);
		await page.locator('.cm-search input[name="search"]').fill('needle');
		await page.keyboard.press('Enter');
		expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('needle');
		await page.locator('.mlp-search-toggle').click();
		await page.locator('.cm-search input[name="replace"]').fill('replacement');
		await page.keyboard.press('Enter');
		await expect(page.locator('.cm-content')).toContainText('replacement');
	});
});
