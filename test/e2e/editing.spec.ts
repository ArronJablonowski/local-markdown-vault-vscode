import { test, expect } from '@playwright/test';
import { mountEditor } from './harness';

const DOC = '# Heading\n\nBefore ![alt](assets/pic.png) after.\n\nPlain paragraph.\n';

test.describe('live preview editing', () => {
	test.beforeEach(async ({ page }) => {
		await mountEditor(page, DOC);
	});

	test('the caret is drawn in the theme color, not black', async ({ page }) => {
		await page.locator('.cm-content').click();
		const color = await page.locator('.cm-cursor').first().evaluate(
			(el) => getComputedStyle(el).borderLeftColor,
		);
		// The library default is a hardcoded black, invisible on a dark theme.
		expect(color).not.toBe('rgb(0, 0, 0)');
		expect(color).toBe('rgb(174, 175, 173)'); // --vscode-editorCursor-foreground
	});

	test('an image renders in place of its markup', async ({ page }) => {
		await expect(page.locator('img.mlp-image')).toHaveCount(1);
		await expect(page.locator('.cm-content')).not.toContainText('assets/pic.png');
	});

	test('clicking an image reveals the markup behind it', async ({ page }) => {
		// The reported bug: a widget ignores events by default, so the click placed
		// no caret and the `![alt](url)` could never be reached by mouse.
		await page.locator('img.mlp-image').click();
		await expect(page.locator('.cm-content')).toContainText('assets/pic.png');
	});

	test('the markup hides again once the caret leaves', async ({ page }) => {
		await page.locator('img.mlp-image').click();
		await expect(page.locator('.cm-content')).toContainText('assets/pic.png');
		// Click a line well away from the image.
		await page.locator('.cm-line').last().click();
		await expect(page.locator('img.mlp-image')).toHaveCount(1);
	});

	test('a heading hides its hash once the caret leaves the line', async ({ page }) => {
		// A fresh document starts with the caret at position 0, i.e. on the
		// heading, so it legitimately shows its source until the caret moves.
		const first = page.locator('.cm-line').first();
		await expect(first).toContainText('#');
		await page.locator('.cm-line').last().click();
		await expect(page.locator('.cm-line').first()).not.toContainText('#');
	});

	test('a heading shows its hash again when the caret returns', async ({ page }) => {
		await page.locator('.cm-line').last().click();
		const first = page.locator('.cm-line').first();
		await expect(first).not.toContainText('#');
		await first.click();
		await expect(page.locator('.cm-line').first()).toContainText('#');
	});
});
