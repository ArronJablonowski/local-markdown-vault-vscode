import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

for (const multiline of [false, true]) for (const key of ['Enter', 'Escape']) for (const legacy of [false, true]) test(`property IME ${key} preserves its draft, multiline=${multiline}, legacy=${legacy}`, async ({ page }) => {
	await mountEditor(page, `---\ntitle: ${multiline ? '|\n  Original\n  Second line' : 'Original'}\n---\n\nAfter`);
	const row = page.locator('.mlp-frontmatter tr', { hasText: 'title' });
	await row.locator('td').focus(); await page.keyboard.press('Enter');
	const input = row.locator('input, textarea');
	await input.fill('\u4f1a\u8b70\u306e\u8a18\u9332');
	await input.evaluate((element, options) => {
		element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: options.key, isComposing: !options.legacy, keyCode: options.legacy ? 229 : 0 }));
	}, { key, legacy });
	await expect(input).toBeVisible();
	await expect(input).toBeFocused();
	await expect(input).toHaveValue('\u4f1a\u8b70\u306e\u8a18\u9332');
	await input.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '\u4f1a\u8b70\u306e\u8a18\u9332' })));
	await input.press('Enter');
	await expect(row.locator('input, textarea')).toHaveCount(0);
	await expect(row).toContainText('\u4f1a\u8b70\u306e\u8a18\u9332');
});
