import { test, expect } from '@playwright/test';
import { mountEditor } from './harness';

const note = '# Everyday editing\n\nA **bold** sentence, *italic* text, ==highlight==, and `inline code`.\n\n## Checklist\n- [ ] Review the table\n- [x] Prepare test notes\n- Parent bullet\n  - Child bullet\n\n## Budget\n| Item | Cost |\n| --- | ---: |\n| Notebook | $12 |\n| Pens | $5 |\n\n> [!warning]+ Local test\n> Keep all changes in the disposable vault.\n> - [ ] Confirm autosave\n\nFinal paragraph.';

test('table cell editing preserves the next callout header', async ({ page }) => {
	await page.setViewportSize({ width: 680, height: 700 });
	await mountEditor(page, note);
	await page.locator('.mlp-checkbox').first().click();
	await page.locator('.mlp-table td').first().click();
	await page.keyboard.press('F2');
	await page.keyboard.type('Journal');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('button', { name: 'Local test callout', exact: true })).toBeVisible();
});

test('property edits preserve footnote navigation and callout controls', async ({ page }) => {
	await mountEditor(page, '---\nstatus: draft\n---\n\n# Research\n\nA reference[^one].\n\n> [!abstract]+ Summary\n> Details.\n\n[^one]: A local footnote.\n\nAfter');
	await page.getByRole('button', { name: 'Edit status', exact: true }).dblclick();
	await page.getByRole('textbox', { name: 'Edit status', exact: true }).fill('reviewed');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('button', { name: 'Summary callout', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Go to footnote one', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Go to footnote one', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Return to footnote reference one', exact: true })).toBeVisible();
});
