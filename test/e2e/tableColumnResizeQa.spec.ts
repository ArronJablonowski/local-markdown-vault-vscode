import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const original = 'Before\n\n| Owner | Status |\n| --- | --- |\n| Original | Retained |\n\nAfter';
for (const editingMode of ['editing', 'locked'] as const) for (const method of ['mouse', 'keyboard']) test(`${editingMode}: ${method} column resize preserves source, neighbors, and supports reset`, async ({ page }) => {
	await mountEditor(page, original, { editingMode });
	const headers = page.locator('.mlp-table thead th');
	const widths = () => headers.evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width));
	const before = await widths();
	const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
	if (method === 'keyboard') { await handle.focus(); await page.keyboard.press('Shift+ArrowRight'); }
	else {
		const box = await handle.boundingBox();
		await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
		await page.mouse.down(); await page.mouse.move(box!.x + box!.width / 2 + 40, box!.y + box!.height / 2, { steps: 8 }); await page.mouse.up();
		await page.mouse.move(box!.x + box!.width / 2 + 80, box!.y + box!.height / 2);
	}
	await expect.poll(async () => Math.round((await widths())[0] - before[0])).toBe(40);
	expect(Math.abs((await widths())[1] - before[1])).toBeLessThan(2);
	expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
	expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	await handle.dblclick();
	await expect(page.locator('.mlp-table')).not.toHaveClass(/mlp-table-resized/);
});

test('keyboard resizing enforces bounded widths without editing the note', async ({ page }) => {
	await mountEditor(page, original);
	const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
	await handle.focus();
	for (let step = 0; step < 55; step++) await page.keyboard.press('Shift+ArrowRight');
	await expect(handle).toHaveAttribute('aria-valuenow', '2000');
	for (let step = 0; step < 55; step++) await page.keyboard.press('Shift+ArrowLeft');
	await expect(handle).toHaveAttribute('aria-valuenow', '64');
	expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
});

test('resized tracks survive cell typing, header editing, and an inserted paragraph before the table', async ({ page }) => {
	await mountEditor(page, original);
	await page.getByRole('separator', { name: 'Resize column 1', exact: true }).focus();
	await page.keyboard.press('Shift+ArrowRight');
	const width = () => page.locator('.mlp-table thead th').first().evaluate(cell => cell.getBoundingClientRect().width);
	const resized = await width();
	await page.locator('.mlp-table td').first().click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a'); await page.keyboard.type('Updated'); await page.keyboard.press('Enter');
	expect(Math.abs(await width() - resized)).toBeLessThan(2);
	await page.locator('.mlp-table th').first().click(); await page.keyboard.press('Enter');
	await expect(page.getByRole('separator', { name: 'Resize column 1', exact: true })).toBeVisible();
	await postToWebview(page, { type: 'externalUpdate', version: 20, changes: [{ from: 0, to: 0, insert: 'New paragraph\n\n' }] });
	await expect.poll(async () => Math.abs(await width() - resized)).toBeLessThan(2);
});

test('resized wide tables retain sticky header alignment during horizontal scrolling', async ({ page }) => {
	const text = 'Before\n\n| Owner | Status |\n| --- | --- |\n' + '| A long description | Retain this value |\n'.repeat(70) + '\nAfter\n' + 'Trailing paragraph\n\n'.repeat(30);
	await mountEditor(page, text, { stickyTableHeaders: true });
	const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
	await handle.focus();
	for (let step = 0; step < 25; step++) await page.keyboard.press('Shift+ArrowRight');
	await page.locator('.mlp-table-wrap').evaluate(wrap => {
		const scroll = document.querySelector('.cm-scroller')!;
		scroll.scrollTop += wrap.getBoundingClientRect().top - scroll.getBoundingClientRect().top + 200;
		wrap.querySelector('.mlp-table-viewport')!.scrollLeft = 150;
	});
	await expect(page.locator('.mlp-table-sticky-header')).not.toHaveAttribute('hidden');
	await expect(page.locator('.mlp-sticky-table')).toBeVisible();
	await expect.poll(() => page.locator('.mlp-table-wrap').evaluate(wrap => {
		const real = wrap.querySelector('.mlp-table th')!.getBoundingClientRect();
		const sticky = wrap.querySelector('.mlp-sticky-table th')!.getBoundingClientRect();
		return Math.max(Math.abs(real.width - sticky.width), Math.abs(real.left - sticky.left));
	})).toBeLessThan(2);
	await expect(page.locator('.mlp-sticky-table .mlp-column-resize')).toHaveCount(0);
});
