import { test, expect } from '@playwright/test';
import { mountEditor } from './harness';

test('the harness mounts the editor', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text());
	});
	await mountEditor(page, '# Hi\n');
	expect(errors).toEqual([]);
	await expect(page.locator('.cm-content')).toBeVisible();
});
