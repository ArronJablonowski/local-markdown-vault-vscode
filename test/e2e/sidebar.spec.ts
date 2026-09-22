import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mountStyleSidebar } from './harness';

const STYLES = [
	{ id: 'default', name: 'Default', enabled: true, css: 'h1 { color: #fff; }' },
	{ id: 'paper', name: 'Paper', enabled: false, css: 'body { color: #222; background: #fff; }' },
];

test.describe('CSS theme sidebar accessibility', () => {
	test('offers every Markdown viewing mode and a default Locked or Editing mode', async ({ page }) => {
		await mountStyleSidebar(page, STYLES);
		const whitespace = page.getByLabel('Show spaces and line breaks (Live Preview)');
		await expect(whitespace).toHaveValue('off');
		await whitespace.selectOption('on');
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: unknown[] }).__posted.at(-1),
		)).toEqual({ type: 'setSetting', key: 'showWhitespace', value: 'on' });
		const defaultEditor = page.getByLabel('Default viewing mode');
		await expect(defaultEditor.locator('option')).toHaveText([
			'VS Code default',
			'Text Editor',
			'Markdown Preview',
			'VS Code Markdown Editor',
			'Markdown Editor',
			'Markdown Live Preview',
		]);
		await expect(defaultEditor).toHaveValue('markdownEditor');
		const vaultTabs = page.getByLabel('Vault file tabs');
		await expect(vaultTabs.locator('option')).toHaveText([
			'Reuse one preview tab',
			'Open each file in a new tab',
		]);
		await expect(vaultTabs).toHaveValue('reuseTab');
		await vaultTabs.selectOption('newTab');
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; key?: string; value?: string }> }).__posted.at(-1),
		)).toEqual({ type: 'setSetting', key: 'vaultOpenBehavior', value: 'newTab' });
		const defaultMode = page.getByLabel('Default Live Preview mode');
		await expect(defaultMode.locator('option')).toHaveText(['Editing', 'Locked']);
		await defaultMode.selectOption('locked');
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; key?: string; value?: string }> }).__posted.at(-1),
		)).toEqual({ type: 'setSetting', key: 'defaultEditingMode', value: 'locked' });
	});

	test('selects a theme with native radio keyboard behavior', async ({ page }) => {
		await mountStyleSidebar(page, STYLES);
		const radios = page.getByRole('radio');
		await expect(radios).toHaveCount(2);
		await expect(radios.nth(0)).toHaveAccessibleName('Apply CSS theme Default');
		await expect(radios.nth(0)).toBeChecked();
		await radios.nth(0).focus();
		await expect(radios.nth(0)).toHaveCSS('outline-style', 'solid');
		await page.keyboard.press('ArrowDown');
		await expect(radios.nth(1)).toBeFocused();
		await expect(radios.nth(1)).toBeChecked();
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; id?: string; enabled?: boolean }> }).__posted.at(-1),
		)).toEqual({ type: 'toggle', id: 'paper', enabled: true });
	});

	test('exposes named actions and no critical accessibility violations', async ({ page }) => {
		await mountStyleSidebar(page, STYLES);
		for (const name of ['Edit CSS', 'Duplicate', 'Rename', 'Delete']) {
			await expect(page.getByRole('button', { name }).first()).toBeVisible();
		}
		const results = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
			.analyze();
		expect(results.violations.filter((violation) => violation.impact === 'critical')).toEqual([]);
	});
});
