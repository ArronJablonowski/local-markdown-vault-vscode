import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

for (const nested of [false, true]) for (const direction of ['ArrowRight', 'ArrowLeft'] as const) {
	test(`natural oversized column does not jump while resizing ${direction}, callout=${nested}`, async ({ page }) => {
		const table = '| Notes | State |\n| --- | --- |\n| `' + 'Identifier'.repeat(100) + '` | Retained |';
		const text = '# Width limits\n\n' + (nested ? '> [!warning]+ Review\n>\n' + table.split('\n').map(line => '> ' + line).join('\n') : table) + '\n\nAfter';
		await mountEditor(page, text);
		const header = page.locator('.mlp-table th').first();
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
		const width = await header.evaluate(cell => cell.getBoundingClientRect().width);
		expect(width).toBeGreaterThan(2000);
		await handle.focus(); await page.keyboard.press(direction);
		const after = await header.evaluate(cell => cell.getBoundingClientRect().width);
		if (direction === 'ArrowRight') expect(after).toBeGreaterThanOrEqual(width - 1);
		else {
			expect(Math.abs(after - (width - 10))).toBeLessThan(2);
			await page.keyboard.press('ArrowRight');
			expect(Math.abs(await header.evaluate(cell => cell.getBoundingClientRect().width) - width)).toBeLessThan(2);
			await expect(handle).toHaveAttribute('aria-valuemax', String(Math.round(width)));
		}
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(text);
	});
}

for (const direction of ['ArrowRight', 'ArrowLeft'] as const) {
	test(`tiny theme columns do not snap in the wrong direction on ${direction}`, async ({ page }) => {
		const row = '| ' + Array.from({ length: 30 }, () => 'a').join(' | ') + ' |';
		const separator = '| ' + Array.from({ length: 30 }, () => '---').join(' | ') + ' |';
		const text = '# Narrow columns\n\n' + row + '\n' + separator + '\n' + row + '\n\nAfter';
		await mountEditor(page, text, { css: 'table th, table td { font-size: 2px; padding: 0; min-width: 0; }' });
		const header = page.locator('.mlp-table th').first();
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
		const width = await header.evaluate(cell => cell.getBoundingClientRect().width);
		expect(width).toBeLessThan(64);
		await handle.focus(); await page.keyboard.press(direction);
		const after = await header.evaluate(cell => cell.getBoundingClientRect().width);
		if (direction === 'ArrowLeft') expect(after).toBeLessThanOrEqual(width + 1);
		else {
			expect(Math.abs(after - (width + 10))).toBeLessThan(2);
			await page.keyboard.press('ArrowLeft');
			expect(Math.abs(await header.evaluate(cell => cell.getBoundingClientRect().width) - width)).toBeLessThan(2);
			await expect(handle).toHaveAttribute('aria-valuemin', String(Math.round(width)));
		}
	});
}

for (const delta of [-30, 0, 30]) {
	test(`mouse resize of an oversized column keeps its starting width legal, delta=${delta}`, async ({ page }) => {
		const text = '# Mouse resize\n\n| Notes | State |\n| --- | --- |\n| `' + 'Identifier'.repeat(100) + '` | Retained |\n\nAfter';
		await mountEditor(page, text);
		const header = page.locator('.mlp-table th').first();
		const width = await header.evaluate(cell => cell.getBoundingClientRect().width);
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
		await handle.scrollIntoViewIfNeeded();
		const box = await handle.boundingBox(); expect(box).not.toBeNull();
		const x = box!.x + box!.width / 2, y = box!.y + box!.height / 2;
		await page.mouse.move(x, y); await page.mouse.down();
		await page.mouse.move(x + delta, y, { steps: 5 }); await page.mouse.up();
		const after = await header.evaluate(cell => cell.getBoundingClientRect().width);
		expect(Math.abs(after - (width + Math.min(0, delta)))).toBeLessThan(2);
	});
}
