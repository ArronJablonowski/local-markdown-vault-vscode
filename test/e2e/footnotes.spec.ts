import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

test('renders footnotes with keyboard navigation in both directions', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await mountEditor(page, 'Intro\n\nA claim[^1].\n\n[^1]: Local evidence only.\n');
	const reference = page.locator('.mlp-footnote-reference');
	const definition = page.locator('.mlp-footnote-definition-label');
	await expect(reference).toHaveText('1');
	await expect(definition).toContainText('1');
	await reference.focus();
	await page.keyboard.press('Enter');
	expect(errors).toEqual([]);
	await expect(definition).toBeVisible();
	await definition.focus();
	await page.keyboard.press('Enter');
	await expect(page.locator('.cm-content')).toBeFocused();
});
