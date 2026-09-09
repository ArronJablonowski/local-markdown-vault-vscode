import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

/**
 * The rendering the extension exists for: a block of text becoming a table, a
 * diagram, or colored code, and going back to its source when the caret
 * arrives. All of it was verified by hand before — steps 4, 5, 12, 13 and 14 of
 * the README's manual checklist.
 */
test.describe('block rendering', () => {
	test('a table renders as a real table', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter\n');
		await expect(page.locator('.mlp-table')).toHaveCount(1);
		await expect(page.locator('.mlp-table td')).toHaveCount(2);
	});

	test('a blank cell keeps its column', async ({ page }) => {
		// The reported failure was later columns sliding left into the gap.
		await mountEditor(page, 'Intro\n\n| a | b | c |\n| --- | --- | --- |\n| 1 |  | 3 |\n');
		const cells = page.locator('.mlp-table td');
		await expect(cells).toHaveCount(3);
		await expect(cells.nth(0)).toHaveText('1');
		await expect(cells.nth(1)).toHaveText('');
		await expect(cells.nth(2)).toHaveText('3');
	});

	test('a table directly under a bullet still renders', async ({ page }) => {
		// No blank line between the list item and the table; stock GFM would treat
		// the pipes as paragraph text.
		await mountEditor(page, '- item\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |\n\nAfter\n');
		await expect(page.locator('.mlp-table')).toHaveCount(1);
	});

	test('headings shrink from h4 through h6', async ({ page }) => {
		await mountEditor(page, 'Top\n\n#### Four\n\n##### Five\n\n###### Six\n');
		const sizeOf = async (text: string) =>
			parseFloat(
				await page
					.locator('.cm-line', { hasText: text })
					.first()
					.evaluate((el) => getComputedStyle(el).fontSize),
			);
		const four = await sizeOf('Four');
		const five = await sizeOf('Five');
		const six = await sizeOf('Six');
		expect(four).toBeGreaterThan(five);
		expect(five).toBeGreaterThan(six);
	});

	test('a task list renders checkboxes', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n- [ ] todo\n- [x] done\n');
		await expect(page.locator('.mlp-checkbox')).toHaveCount(2);
		await expect(page.locator('.mlp-checkbox-checked')).toHaveCount(1);
	});

	test('a fenced code block is colorized from the host tokens', async ({ page }) => {
		// Highlighting is computed on the host (Shiki) and arrives as offsets into
		// the document, so what this drives is the webview's half of it.
		const doc = 'Intro\n\n```python\nx = 1\n```\n';
		await mountEditor(page, doc);
		const codeStart = doc.indexOf('x = 1');
		await postToWebview(page, {
			type: 'codeTokens',
			blocks: [
				{
					from: doc.indexOf('```python'),
					to: doc.length,
					tokens: [{ from: codeStart, to: codeStart + 5, style: 'color:#569cd6' }],
				},
			],
		});
		const colored = page.locator('.cm-content [style*="569cd6"], .cm-content [style*="86, 156, 214"]');
		await expect(colored.first()).toBeVisible({ timeout: 5000 });
	});

	test('a CSS theme sent by the host reaches the document', async ({ page }) => {
		await mountEditor(page, '# Themed\n\nBody\n');
		await postToWebview(page, { type: 'applyCss', css: 'h1 { color: rgb(1, 2, 3); }' });
		const style = page.locator('#mlp-user-css');
		await expect(style).toHaveCount(1);
		const css = await style.evaluate((el) => el.textContent ?? '');
		expect(css).toContain('rgb(1, 2, 3)');
	});

	test('an external edit from the host is applied', async ({ page }) => {
		await mountEditor(page, '# One\n');
		await postToWebview(page, {
			type: 'externalUpdate',
			version: 1,
			changes: [{ from: 2, to: 5, insert: 'Two' }],
		});
		await expect(page.locator('.cm-content')).toContainText('Two');
	});
});
