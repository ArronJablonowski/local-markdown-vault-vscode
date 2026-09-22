import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

test.describe('Obsidian-style callouts', () => {
	test('keeps Abstract and Warning bodies joined to their colored headers', async ({ page }, testInfo) => {
		await mountEditor(page, 'Callout examples\n\n> [!abstract]\n> A concise summary with **important details**.\n\n> [!warning]\n> Review this warning before continuing.\n\n> [!abstract]\n\n> [!warning]\n\nAfter\n');
		for (const type of ['abstract', 'warning']) {
			const lines = page.locator(`.mlp-callout-${type}`);
			const backgrounds = await lines.evaluateAll(els => els.map(el => getComputedStyle(el).backgroundColor));
			expect(new Set(backgrounds).size).toBe(1);
			await expect(lines.nth(1)).toHaveCSS('border-bottom-left-radius', '6px');
		}
		await page.screenshot({ path: testInfo.outputPath('callout-panels.png') });
	});

	for (const type of ['abstract', 'warning', 'summary', 'caution']) {
		test(`${type} has a tinted rounded panel and a safe outline icon`, async ({ page }) => {
			await mountEditor(page, `Intro\n\n> [!${type}]\n\nAfter\n`);
			const panel = page.locator('.mlp-line-callout');
			await expect(panel).toHaveCount(1);
			await expect(panel).toHaveCSS('border-left-width', '0px');
			await expect(panel).toHaveCSS('border-top-left-radius', '6px');
			await expect(panel).toHaveCSS('border-bottom-left-radius', '6px');
			const expected = ['abstract', 'summary'].includes(type) ? 'Abstract' : 'Warning';
			await expect(panel.locator('.mlp-callout-title')).toHaveText(expected);
			await expect(panel.locator('.mlp-callout-icon svg')).toHaveCount(1);
			const colors = await panel.evaluate(el => ({ actual: getComputedStyle(el).backgroundColor,
				color: getComputedStyle(el).getPropertyValue('--mlp-callout-color') }));
			expect(colors.actual).not.toBe('rgba(127, 127, 127, 0.05)');
			expect(colors.color.trim()).toBe(expected === 'Abstract' ? '#00b8a9' : '#e9973f');
			await expect(panel.locator('script, foreignObject, image, use, [onclick]')).toHaveCount(0);
		});
	}

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
