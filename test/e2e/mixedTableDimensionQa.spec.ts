import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

const cases = [
	['math', '$\\frac{a+b+c+d+e+f+g+h+i+j+k+l+m+n}{1+x^2+y^2}$'],
	['linked formatting', '[**Owner** and *review* ~~old~~](Notes.md) with ==priority== #work/active :smile: '.repeat(3)],
	['safe HTML', '<ul><li><strong>Decision</strong><ul><li><code>identifier</code> and <em>follow up</em></li></ul></li></ul>'],
	['multiline', '**First**<br>Second with `code`<br>Third [reference](Notes.md)<br>Fourth 🙂'],
	['Unicode', '\u{4f1a}\u{8b70}\u{306e}\u{8b70}\u{4e8b}\u{9332} caf\u{e9} \u{1f468}\u{200d}\u{1f469}\u{200d}\u{1f467}\u{200d}\u{1f466} \u{627}\u{644}\u{639}\u{631}\u{628}\u{64a}\u{629} \u{5e2}\u{5d1}\u{5e8}\u{5d9}\u{5ea} '.repeat(8)],
	['wikilinks', '[[Notes\\|**A very long alias for the referenced meeting record**]] and ![[missing.png]]'],
];
for (const editingMode of ['editing', 'locked'] as const) for (const nested of [false, true]) for (const [name, content] of cases) {
	test(`${editingMode}: ${name} resized table contains its content and adapts height, nested=${nested}`, async ({ page }) => {
		const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
		const table = `| Mixed notes | Status |\n| --- | --- |\n| ${content} | Retained |\n` + '| Plain text | Other |\n'.repeat(8);
		const original = '# Meeting\n\n' + (nested ? '> [!warning] Decisions\n>\n> ' + table.trimEnd().split('\n').join('\n> ') : table.trimEnd()) + '\n\n- [ ] Follow up\n\n```js\nconst result = 1;\n```\n\nAfter';
		await mountEditor(page, original, { editingMode, stickyTableHeaders: true });
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
		await handle.focus();
		for (let n = 0; n < 55; n++) await page.keyboard.press('Shift+ArrowLeft');
		await expect(handle).toHaveAttribute('aria-valuenow', '64');
		const cell = page.locator('.mlp-table tbody td').first();
		const narrow = await cell.evaluate(cell => ({ height: cell.getBoundingClientRect().height, overflow: cell.scrollWidth - cell.clientWidth }));
		expect(narrow.overflow).toBeLessThan(3);
		for (let n = 0; n < 14; n++) await page.keyboard.press('Shift+ArrowRight');
		await expect.poll(() => cell.evaluate(cell => cell.getBoundingClientRect().height)).toBeLessThanOrEqual(narrow.height + 1);
		await page.getByRole('button', { name: 'Collapse table', exact: true }).click();
		await expect(page.locator('.mlp-table tbody tr:visible')).toHaveCount(5);
		await page.getByRole('button', { name: 'Expand table', exact: true }).click();
		await expect(page.locator('.mlp-table tbody tr:visible')).toHaveCount(9);
		await expect(handle).toHaveAttribute('aria-valuenow', '624');
		await handle.dblclick();
		await expect(page.locator('.mlp-table')).not.toHaveClass(/mlp-table-resized/);
		await expect.poll(() => handle.evaluate(handle => Math.abs(Number(handle.getAttribute('aria-valuenow')) - Math.round(handle.closest('th')!.getBoundingClientRect().width)))).toBeLessThanOrEqual(1);
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
		expect(errors).toEqual([]);
	});
}

for (const nested of [false, true]) for (const header of [false, true]) for (const method of ['mouse', 'keyboard']) {
	test(`pending ${header ? 'header' : 'body'} edit survives ${method} resize, nested=${nested}`, async ({ page }) => {
		const table = '| Owner | Status |\n| --- | --- |\n| Original | Retained |';
		const original = 'Before\n\n' + (nested ? '> [!note] Meeting\n>\n> ' + table.split('\n').join('\n> ') : table) + '\n\nAfter';
		await mountEditor(page, original);
		const cell = page.locator(header ? '.mlp-table th' : '.mlp-table td').first();
		await cell.click(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
		await page.keyboard.type('Edited **priority** notes', { delay: 20 });
		const handle = page.getByRole('separator', { name: 'Resize column 2', exact: true });
		let before = await page.locator('.mlp-table th').nth(1).evaluate(cell => cell.getBoundingClientRect().width);
		if (method === 'keyboard') {
			await handle.focus(); await expect(handle).toBeFocused();
			// Leaving a cell commits rich text and releases temporary editing widths.
			before = await page.locator('.mlp-table th').nth(1).evaluate(cell => cell.getBoundingClientRect().width);
			await page.keyboard.press('Shift+ArrowRight');
		}
		else {
			const box = await handle.boundingBox();
			await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.down();
			await page.mouse.move(box!.x + box!.width / 2 + 80, box!.y + box!.height / 2, { steps: 10 }); await page.mouse.up();
		}
		await page.locator('.cm-line', { hasText: /^After$/ }).click();
		await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.replace(header ? 'Owner' : 'Original', 'Edited **priority** notes'));
		await expect.poll(() => page.locator('.mlp-table th').nth(1).evaluate((cell, before) => Math.round(cell.getBoundingClientRect().width - before), before)).toBe(method === 'mouse' ? 80 : 40);
		await expect(page.locator('.mlp-table td').last()).toHaveText('Retained');
	});
}
