import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

const values = [
	'**Decision**<br>Follow up with [owner](Notes.md)',
	'<ul><li>First<ul><li>Nested `code`</li></ul></li></ul>',
	'**A \\| B**<br>*Follow up* and &amp; reference',
	'***Important*** ~~old~~<br>Current <strong>decision</strong>',
];
for (const nested of [false, true]) for (const leadingPipe of [false, true]) for (const rawValue of values) {
	// A block-level HTML tag at column zero starts an HTML block, not a GFM row.
	const value = !leadingPipe && rawValue.startsWith('<ul>') ? 'List: ' + rawValue : rawValue;
	test(`source redraft restores table widths and wrapping, nested=${nested}, leadingPipe=${leadingPipe}, value=${value.slice(0, 16)}`, async ({ page }) => {
		const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
		const rows = leadingPipe ? ['| Notes | Owner |', '| --- | --- |', '| Seed | Team |'] : ['Notes | Owner', '--- | ---', 'Seed | Team'];
		const table = rows.join('\n');
		const source = '# Meeting\n\n> [!tip] Context\n> - [ ] Retained task\n\n' + (nested ? '> [!note] Agenda\n>\n> ' + table.split('\n').join('\n> ') : table) + '\n\nAfter\n\n$$\nx^2+y^2=z^2\n$$\n\n```js\nconst retained = true;\n```';
		await mountEditor(page, source);
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
		await handle.focus();
		for (let n = 0; n < 55; n++) await page.keyboard.press('Shift+ArrowLeft');
		const height = await page.locator('.mlp-table td').first().evaluate(cell => cell.getBoundingClientRect().height);
		await page.getByRole('button', { name: 'Show Markdown source', exact: true }).click();
		const line = page.locator('.cm-line').filter({ hasText: 'Seed | Team' });
		await line.click(); await page.keyboard.press('Home');
		// Home targets the visual line start, which may exclude a hidden quote mark.
		for (let n = 0; n < 10; n++) {
			const head = await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.selection.main.head);
			if (head === source.indexOf('Seed')) break;
			await page.keyboard.press(head < source.indexOf('Seed') ? 'ArrowRight' : 'ArrowLeft');
		}
		await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.selection.main.head)).toBe(source.indexOf('Seed'));
		for (let n = 0; n < 4; n++) await page.keyboard.press('Delete');
		await page.keyboard.type(value + 'XYZ', { delay: 10 });
		for (let n = 0; n < 3; n++) await page.keyboard.press('Shift+ArrowLeft');
		await page.keyboard.press('Backspace');
		await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(source.replace('Seed', value));
		await page.locator('.cm-line', { hasText: /^After$/ }).click();
		await expect(handle).toHaveAttribute('aria-valuenow', '64');
		await expect(page.locator('.mlp-table td').last()).toHaveText('Team');
		await expect.poll(() => page.locator('.mlp-table td').first().evaluate(cell => cell.getBoundingClientRect().height)).toBeGreaterThan(height);
		expect(errors).toEqual([]);
	});
}
