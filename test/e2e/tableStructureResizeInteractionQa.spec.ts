import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

const values = [
	'**Decision**<br>Follow up with [owner](Notes.md)',
	'<ul><li>First decision<ul><li>Nested `code`</li></ul></li></ul>',
	'***Important*** ~~old~~ and <strong>current</strong><br>Second line',
	'`escaped \\| pipe` and &amp; reference<br>Retained text',
];
for (const nested of [false, true]) for (const value of values) for (const action of ['Add a column', 'Delete selected column', 'Move selected column left', 'Move selected column right']) {
	test(`${action} retains rich content and resize geometry, nested=${nested}, value=${value.slice(0, 16)}`, async ({ page }) => {
		const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
		const table = `| Notes | Status | Owner |\n| --- | --- | --- |\n| ${value} | Pending | Alex |\n| Retained | Complete | Team |`;
		const source = '# Meeting\n\n- [ ] Review #work\n\n' + (nested ? '> [!warning] Agenda\n>\n> ' + table.split('\n').join('\n> ') : table) + '\n\n```js\nconst retained = true;\n```\n\nAfter';
		await mountEditor(page, source, { stickyTableHeaders: true });
		await page.getByRole('separator', { name: 'Resize column 1', exact: true }).focus();
		await page.keyboard.press('Shift+ArrowRight');
		await page.locator('.mlp-table tbody tr').first().locator('td').nth(1).focus();
		await page.getByRole('button', { name: 'Table options', exact: true }).click();
		await page.getByRole('button', { name: action, exact: true }).click();
		const count = action === 'Add a column' ? 4 : action === 'Delete selected column' ? 2 : 3;
		await expect(page.locator('.mlp-table thead th')).toHaveCount(count);
		await expect(page.getByRole('separator', { name: /^Resize column/ })).toHaveCount(count);
		const current = await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString());
		expect(current).toContain(value); expect(current).toContain('const retained = true;'); expect(current).toMatch(/\n\nAfter$/);
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
		await handle.focus();
		const before = await handle.evaluate(handle => handle.closest('th')!.getBoundingClientRect().width);
		await page.keyboard.press('Shift+ArrowRight');
		await expect.poll(() => handle.evaluate((handle, before) => Math.round(handle.closest('th')!.getBoundingClientRect().width - before), before)).toBe(40);
		await expect.poll(() => page.locator('.mlp-table').evaluate(table => {
			const heads = Array.from(table.querySelectorAll('thead th'));
			return Math.max(...Array.from(table.querySelectorAll('tbody tr')).flatMap(row => Array.from(row.querySelectorAll('td')).map((cell, i) => {
				const a = cell.getBoundingClientRect(), b = heads[i].getBoundingClientRect();
				return Math.max(Math.abs(a.left - b.left), Math.abs(a.width - b.width), Math.max(0, cell.scrollWidth - cell.clientWidth));
			})));
		})).toBeLessThan(3);
		expect(errors).toEqual([]);
	});
}

for (const editingMode of ['editing', 'locked'] as const) for (const nested of [false, true]) for (const interruption of ['pointercancel', 'lostcapture']) {
	test(`${editingMode}: ${interruption} stops resizing without stale movement, nested=${nested}`, async ({ page }) => {
		const table = '| Notes | Owner |\n| --- | --- |\n| **Decision**<br>Second line | Team |\n| <ul><li>Follow up</li></ul> | Alex |';
		const source = 'Before\n\n' + (nested ? '> [!note] Agenda\n>\n> ' + table.split('\n').join('\n> ') : table) + '\n\n- [ ] Retained task\n\nAfter';
		await mountEditor(page, source, { editingMode });
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
		await handle.evaluate(handle => handle.addEventListener('pointerdown', event => { (handle as any).__qaPointerId = (event as PointerEvent).pointerId; }, { once: true }));
		const box = await handle.boundingBox();
		const x = box!.x + box!.width / 2, y = box!.y + box!.height / 2;
		await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 50, y, { steps: 8 });
		const width = await handle.evaluate(handle => handle.closest('th')!.getBoundingClientRect().width);
		await handle.evaluate((handle, interruption) => {
			const pointerId = (handle as any).__qaPointerId;
			if (interruption === 'lostcapture') handle.releasePointerCapture(pointerId);
			else handle.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId }));
		}, interruption);
		await page.mouse.move(x + 130, y, { steps: 8 }); await page.mouse.up();
		await expect.poll(() => handle.evaluate((handle, width) => Math.abs(handle.closest('th')!.getBoundingClientRect().width - width), width)).toBeLessThan(2);
		await handle.focus(); await page.keyboard.press('Shift+ArrowRight');
		await expect.poll(() => handle.evaluate((handle, width) => Math.round(handle.closest('th')!.getBoundingClientRect().width - width), width)).toBe(40);
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(source);
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	});
}
