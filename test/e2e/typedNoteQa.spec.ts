import { test, expect } from '@playwright/test';
import { mountEditor } from './harness';

test('type YAML properties and a note from an empty editor without losing keyboard focus', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await mountEditor(page, '');
	await page.locator('.cm-content').click();
	for (const line of ['---', 'status: draft', 'priority: 2', 'approved: false', '---', '', '# Research notebook', '', 'End of research.']) {
		await page.keyboard.type(line, { delay: 5 });
		await page.keyboard.press('Enter');
		expect(errors, `after typing ${line}`).toEqual([]);
	}
	await expect(page.locator('.cm-content')).toContainText('End of research.');
	await expect(page.locator('.mlp-frontmatter')).toContainText('draft');
});
