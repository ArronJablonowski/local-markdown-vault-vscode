import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const neighbors = [
	['math', '$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$'],
	['diagram', '```mermaid\nflowchart LR\n A[Meeting] --> B{Review}\n B --> C[Follow up]\n```'],
	['HTML', '<details><summary>Meeting evidence</summary><p><strong>Retained</strong> text and <em>review</em>.</p></details>'],
	['lists and footnotes', '- [x] Completed **review**\n    - Nested *decision*\n- [ ] Follow up[^review]\n\n[^review]: Retained evidence.'],
	['callout', '> [!warning]+ Follow up\n> **Owner** and ==priority==\n>\n> - [ ] Review\n>     - Nested detail'],
	['code', '```python\n' + Array.from({ length: 12 }, (_, n) => `value_${n} = ${n}`).join('\n') + '\n```'],
];
for (const editingMode of ['editing', 'locked'] as const) for (const nested of [false, true]) for (const [name, neighbor] of neighbors) {
	test(`${editingMode}: resized table survives rich row redrafts beside ${name}, nested=${nested}`, async ({ page }) => {
		const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
		const table = '| Review | Owner |\n| --- | --- |\n| Seed | Team |\n' + '| Retained | Alex |\n'.repeat(7);
		const source = '# Meeting\n\n' + neighbor + '\n\n' + (nested ? '> [!note] Table agenda\n>\n> ' + table.trimEnd().split('\n').join('\n> ') : table.trimEnd()) + '\n\nAfter table\n\n' + neighbor;
		await mountEditor(page, source, { editingMode, stickyTableHeaders: true });
		const tableLocator = page.locator('.mlp-table');
		await expect(tableLocator).toHaveCount(1);
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
		await handle.focus();
		for (let n = 0; n < 55; n++) await page.keyboard.press('Shift+ArrowLeft');
		const cell = tableLocator.locator('tbody td').first();
		const baseline = await cell.evaluate(cell => cell.getBoundingClientRect().height);
		await page.getByRole('button', { name: 'Collapse table', exact: true }).click();
		const rich = '**Decision**<br><ul><li>First item<ul><li>Nested `code` and [review](Notes.md)</li></ul></li></ul>';
		const from = source.indexOf('Seed');
		await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from, to: from + 4, insert: rich }] });
		await expect(tableLocator.locator('tbody tr:visible')).toHaveCount(5);
		await expect.poll(() => cell.evaluate(cell => cell.getBoundingClientRect().height)).toBeGreaterThan(baseline);
		await expect(handle).toHaveAttribute('aria-valuenow', '64');
		await page.getByRole('button', { name: 'Expand table', exact: true }).click();
		await expect(tableLocator.locator('tbody tr:visible')).toHaveCount(8);
		await handle.focus(); await page.keyboard.press('Shift+ArrowRight');
		await expect(handle).toHaveAttribute('aria-valuenow', '104');
		await postToWebview(page, { type: 'externalUpdate', version: 2, changes: [{ from, to: from + rich.length, insert: 'Seed' }] });
		await expect.poll(() => cell.evaluate((cell, baseline) => Math.abs(cell.getBoundingClientRect().height - baseline), baseline)).toBeLessThan(2);
		await expect(handle).toHaveAttribute('aria-valuenow', '104');
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(source);
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
		expect(errors).toEqual([]);
	});
}

for (const nested of [false, true]) for (const [name, neighbor] of neighbors.slice(0, 2)) {
	test(`per-key table redrafts preserve fixed widths beside ${name}, nested=${nested}`, async ({ page }) => {
		const table = '| Notes | Owner |\n| --- | --- |\n| Seed | Retained |';
		const source = 'Before\n\n' + neighbor + '\n\n' + (nested ? '> [!tip] Agenda\n>\n> ' + table.split('\n').join('\n> ') : table) + '\n\nAfter';
		await mountEditor(page, source);
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
		await handle.focus();
		for (let n = 0; n < 55; n++) await page.keyboard.press('Shift+ArrowLeft');
		const cell = page.locator('.mlp-table tbody td').first();
		const initial = await cell.evaluate(cell => cell.getBoundingClientRect().height);
		for (const value of ['**Decision**<br>Follow up with [owner](Notes.md)', 'Seed']) {
			await cell.click({ position: { x: 12, y: 15 } });
			await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
			await page.keyboard.type(value + 'X', { delay: 15 });
			await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Backspace');
			await page.keyboard.press('Enter');
			await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(source.replace('Seed', value));
			await expect(handle).toHaveAttribute('aria-valuenow', '64');
			await expect(page.locator('.mlp-table td').last()).toHaveText('Retained');
			if (value === 'Seed') await expect.poll(() => cell.evaluate((cell, initial) => Math.abs(cell.getBoundingClientRect().height - initial), initial)).toBeLessThan(2);
			else await expect.poll(() => cell.evaluate(cell => cell.getBoundingClientRect().height)).toBeGreaterThan(initial);
		}
	});
}
