import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const table = '| Owner | State |\n| --- | --- |\n| Zebra | Keep |\n| Alpha | Retain |';
const actions = ['Add a row', 'Insert row below selected row', 'Delete selected row', 'Sort rows ascending by selected column', 'Cycle selected column alignment'];
for (const nested of [false, true]) for (const action of actions) test(`resized columns survive ${action}, callout=${nested}`, async ({ page }) => {
	const original = 'Before\n\n' + (nested ? '> [!note] Meeting\n>\n' + table.split('\n').map(line => '> ' + line).join('\n') : table) + '\n\nAfter';
	await mountEditor(page, original);
	await page.getByRole('separator', { name: 'Resize column 1', exact: true }).focus();
	await page.keyboard.press('Shift+ArrowRight');
	const widths = () => page.locator('.mlp-table thead th').evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width));
	const resized = await widths();
	await page.locator('.mlp-table td').first().click(); await page.keyboard.press('Enter');
	if (action !== 'Add a row') await page.getByRole('button', { name: 'Table options', exact: true }).click();
	await page.getByRole('button', { name: action, exact: true }).click();
	await expect(page.locator('.mlp-table')).toHaveClass(/mlp-table-resized/);
	const after = await widths();
	for (let column = 0; column < after.length; column++) expect(Math.abs(after[column] - resized[column])).toBeLessThan(2);
	const source = await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString());
	expect(source).toMatch(/^Before\n\n/); expect(source).toMatch(/\n\nAfter$/);
});

test('widths follow insertion exactly at the table start and a row replacement back to original source', async ({ page }) => {
	const original = 'Before\n\n' + table + '\n\nAfter';
	await mountEditor(page, original);
	await page.getByRole('separator', { name: 'Resize column 1', exact: true }).focus(); await page.keyboard.press('Shift+ArrowRight');
	const width = () => page.locator('.mlp-table th').first().evaluate(cell => cell.getBoundingClientRect().width);
	const resized = await width();
	const insertion = 'Inserted paragraph\n\n';
	await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: 8, to: 8, insert: insertion }] });
	await expect.poll(async () => Math.abs(await width() - resized)).toBeLessThan(2);
	await page.getByRole('button', { name: 'Add a row', exact: true }).click();
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit').length)).toBeGreaterThan(0);
	await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery)).toBeUndefined();
	const source = await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString());
	const from = source.indexOf('| Owner'); const to = source.indexOf('\n\nAfter');
	await postToWebview(page, { type: 'externalUpdate', version: 20, changes: [{ from, to, insert: table }] });
	await expect.poll(async () => Math.abs(await width() - resized)).toBeLessThan(2);
	expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe('Before\n\n' + insertion + table + '\n\nAfter');
});
