import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

test.describe('Obsidian-style callouts', () => {
	test('renders a titled callout and preserves its content', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n> [!warning] Read this\n> Important local content.\n');
		await expect(page.locator('.mlp-callout-header')).toHaveText(/Read this/);
		await expect(page.locator('.mlp-line-callout')).toHaveCount(2);
		await expect(page.locator('.cm-content')).toContainText('Important local content.');
		await expect(page.locator('.cm-content')).not.toContainText('[!warning]');
	});

	test('supports keyboard-operable collapsed callouts', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n> [!note]- Details\n> Hidden until expanded.\n');
		const header = page.locator('.mlp-callout-header');
		await expect(header).toHaveAttribute('aria-expanded', 'false');
		await expect(page.getByText('Hidden until expanded.')).toBeHidden();
		await header.focus();
		await page.keyboard.press('Enter');
		await expect(header).toHaveAttribute('aria-expanded', 'true');
		await expect(page.getByText('Hidden until expanded.')).toBeVisible();
	});

	test('normalizes callout aliases and recognizes nested callouts at the correct depth', async ({ page }) => {
		await mountEditor(page, '> Outer quote\n> > [!faq] Nested question\n> > Answer.\n');
		await expect(page.locator('.mlp-callout-header')).toHaveCount(1);
		await expect(page.locator('.mlp-callout-header')).toContainText('Nested question');
		await expect(page.locator('.mlp-callout-header')).toHaveAttribute('aria-label', 'Nested question callout');
		await expect(page.locator('.mlp-callout-question')).toHaveCount(2);
	});

	test('uses distinct visual families for the documented callout types', async ({ page }) => {
		await mountEditor(page, [
			'> [!note] Note', '> Body', '',
			'> [!tip] Tip', '> Body', '',
			'> [!success] Success', '> Body', '',
			'> [!warning] Warning', '> Body', '',
			'> [!danger] Danger', '> Body', '',
			'> [!example] Example', '> Body', '',
			'> [!quote] Quote', '> Body',
		].join('\n'));
		const colors = await page.locator('.mlp-callout-header').evaluateAll((headers) =>
			headers.map((header) => getComputedStyle(header).color));
		expect(new Set(colors).size).toBeGreaterThanOrEqual(6);
		const icons = await page.locator('.mlp-callout-icon').allTextContents();
		expect(new Set(icons).size).toBe(icons.length);
	});
});
