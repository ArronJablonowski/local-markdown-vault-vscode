import { test, expect } from '@playwright/test';
import { mountEditor } from './harness';

test('fence language labels remain visible when collapsed and do not alter code', async ({ page }) => {
	const body = Array.from({ length: 8 }, (_, i) => `print(${i})`).join('\n');
	await mountEditor(page, `Intro\n\n\`\`\`python\n${body}\n\`\`\`\n\n\`\`\`C++ title=example\nint x;\n\`\`\`\n\n\`\`\`\nplain\n\`\`\`\n\nAfter`);
	await expect(page.locator('.mlp-code-language')).toHaveText(['python', 'C++']);
	await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
	await expect(page.locator('.mlp-code-language').first()).toBeVisible();
	await page.getByRole('button', { name: 'Expand code block', exact: true }).click();
	await expect(page.locator('.cm-content')).toContainText('print(7)');
	const positions = await page.locator('.mlp-code-language').first().evaluate(label => ({
		labelBottom: label.getBoundingClientRect().bottom,
		lineTop: label.closest('.cm-line')!.getBoundingClientRect().top,
		padding: parseFloat(getComputedStyle(label.closest('.cm-line')!).paddingTop),
	}));
	expect(positions.labelBottom).toBeLessThanOrEqual(positions.lineTop + positions.padding);
});

test('language changes update the label and hostile info strings remain text', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n```python\nx\n```\n\nAfter');
	await page.locator('.mlp-copy-code-host .mlp-code-mode-btn').click();
	await page.keyboard.press('Home');
	await page.keyboard.press('Shift+End');
	await page.keyboard.insertText('```<img/onerror=alert(1)>');
	await page.locator('.cm-line', { hasText: 'After' }).click();
	await expect(page.locator('.mlp-code-language')).toHaveText('<img/onerror=alert(1)>');
	await expect(page.locator('.mlp-code-language img')).toHaveCount(0);
});
