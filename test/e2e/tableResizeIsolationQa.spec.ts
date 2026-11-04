import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const table = '| Owner | State |\n| --- | --- |\n| Value | Retained |';
for (const editingMode of ['editing', 'locked'] as const) for (const reverse of [false, true]) test(`${editingMode}: deleting an identical neighboring table preserves surviving widths, reverse=${reverse}`, async ({ page }) => {
	const original = 'Before\n\n' + table + '\n\n' + table + '\n\nAfter';
	await mountEditor(page, original, { editingMode });
	for (const index of reverse ? [1, 0] : [0, 1]) {
		await page.locator('.mlp-table').nth(index).getByRole('separator', { name: 'Resize column 1', exact: true }).focus();
		for (let step = 0; step <= index; step++) await page.keyboard.press('Shift+ArrowRight');
	}
	const surviving = await page.locator('.mlp-table').nth(1).locator('th').first().evaluate(cell => cell.getBoundingClientRect().width);
	await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: 8, to: 8 + table.length + 2, insert: '' }] });
	await expect(page.locator('.mlp-table')).toHaveCount(1);
	await expect.poll(() => page.locator('.mlp-table th').first().evaluate((cell, expected) => Math.abs(cell.getBoundingClientRect().width - expected), surviving)).toBeLessThan(2);
	expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe('Before\n\n' + table + '\n\nAfter');
	expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
});

for (const editingMode of ['editing', 'locked'] as const) test(`${editingMode}: an unresized neighbor does not inherit deleted column widths`, async ({ page }) => {
	await mountEditor(page, 'Before\n\n' + table + '\n\n' + table + '\n\nAfter', { editingMode });
	await page.locator('.mlp-table').first().getByRole('separator', { name: 'Resize column 1', exact: true }).focus(); await page.keyboard.press('Shift+ArrowRight');
	await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: 8, to: 8 + table.length + 2, insert: '' }] });
	await expect(page.locator('.mlp-table')).toHaveCount(1);
	await expect(page.locator('.mlp-table')).not.toHaveClass(/mlp-table-resized/);
});
