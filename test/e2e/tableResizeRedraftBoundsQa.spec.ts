import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

const contexts = [
	['plain', '## Meeting', ''],
	['callout', '> [!warning]+ Meeting', '> '],
	['nested', '> [!note]+ Outer\n>\n> > [!tip]+ Meeting', '> > '],
	['list callout', '- > [!abstract]+ Meeting', '  > '],
];
const values = [
	['text', 'Updated status'],
	['Markdown', '**Updated** with *details*<br>Follow up'],
	['HTML list', '<ul><li>Updated <strong>status</strong><ul><li>Nested follow-up</li></ul></li></ul>'],
];
for (const [context, header, prefix] of contexts) for (const [format, value] of values) for (const themeKind of ['dark', 'light'] as const) {
	test(`${context}: ${format}, ${themeKind}, reverse resize survives a neighboring cell redraft`, async ({ page }) => {
		const code = Array.from({ length: 9 }, (_, n) => `key_${n}: retained`).join('\n');
		const body = '- [ ] Review\n    - Follow up\n\n```yaml\n' + code + '\n```\n\n| Notes | State |\n| --- | --- |\n| `' + 'Identifier'.repeat(100) + '` | Seed |';
		const source = '---\ntitle: Redraft bounds\n---\n\n# Redraft bounds\n\n' + header + '\n' + body.split('\n').map(line => prefix + line).join('\n') + '\n\nOutside';
		const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
		await mountEditor(page, source, { themeKind });
		const column = page.locator('.mlp-table th').first();
		const startWidth = await column.evaluate(cell => cell.getBoundingClientRect().width);
		expect(startWidth).toBeGreaterThan(2000);
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
		await handle.focus(); await page.keyboard.press('ArrowLeft');
		const cell = page.locator('.mlp-table td').nth(1);
		const initialHeight = await cell.evaluate(cell => cell.getBoundingClientRect().height);
		await cell.dblclick();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
		await page.keyboard.type(value, { delay: 1 }); await page.keyboard.press('Enter');
		await handle.focus(); await page.keyboard.press('ArrowRight');
		await expect.poll(() => column.evaluate(cell => cell.getBoundingClientRect().width)).toBeCloseTo(startWidth, 0);
		await expect(handle).toHaveAttribute('aria-valuemax', String(Math.round(startWidth)));
		if (format !== 'text') await expect.poll(() => cell.evaluate(cell => cell.getBoundingClientRect().height)).toBeGreaterThan(initialHeight);
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(source.replace('| Seed |', `| ${value} |`));
		await cell.dblclick();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
		await page.keyboard.press('Backspace'); await page.keyboard.type('Seed'); await page.keyboard.press('Enter');
		await expect.poll(() => cell.evaluate(cell => cell.getBoundingClientRect().height)).toBeLessThanOrEqual(initialHeight + 2);
		expect(Math.abs(await column.evaluate(cell => cell.getBoundingClientRect().width) - startWidth)).toBeLessThan(2);
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(source);
		expect(errors).toEqual([]);
	});
}

for (const nested of [false, true]) for (const themeKind of ['dark', 'light'] as const) {
	test(`tiny columns keep their original minimum after a cell edit, callout=${nested}, ${themeKind}`, async ({ page }) => {
		const heading = '| ' + Array.from({ length: 30 }, (_, n) => `h${n}`).join(' | ') + ' |';
		const divider = '| ' + Array.from({ length: 30 }, () => '---').join(' | ') + ' |';
		const row = '| ' + Array.from({ length: 30 }, () => 'a').join(' | ') + ' |';
		const block = heading + '\n' + divider + '\n' + row;
		await mountEditor(page, '# Tiny redraft\n\n' + (nested ? '> [!note]+ Meeting\n>\n' + block.split('\n').map(line => '> ' + line).join('\n') : block) + '\n\nAfter',
			{ themeKind, css: 'table th, table td { font-size: 2px; padding: 0; min-width: 0; }' });
		const header = page.locator('.mlp-table th').first();
		const original = await header.evaluate(cell => cell.getBoundingClientRect().width); expect(original).toBeLessThan(64);
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
		await handle.focus(); await page.keyboard.press('ArrowRight');
		const cell = page.locator('.mlp-table td').nth(1); await cell.focus(); await page.keyboard.press('F2');
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
		await page.keyboard.type('b'); await page.keyboard.press('Enter');
		await handle.focus(); await page.keyboard.press('ArrowLeft');
		expect(Math.abs(await header.evaluate(cell => cell.getBoundingClientRect().width) - original)).toBeLessThan(2);
		await expect(handle).toHaveAttribute('aria-valuemin', String(Math.round(original)));
	});
}

for (const nested of [false, true]) for (const action of ['Add a row', 'Sort rows ascending by selected column', 'Insert row below selected row']) {
	test(`oversized column bounds survive ${action}, callout=${nested}`, async ({ page }) => {
		const block = '| Notes | State |\n| --- | --- |\n| `' + 'Identifier'.repeat(100) + '` | Seed |\n| Zebra | Retained |';
		await mountEditor(page, '# Structural bounds\n\n' + (nested ? '> [!note]+ Meeting\n>\n' + block.split('\n').map(line => '> ' + line).join('\n') : block) + '\n\nOutside');
		const header = page.locator('.mlp-table th').first();
		const original = await header.evaluate(cell => cell.getBoundingClientRect().width);
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
		await handle.focus(); await page.keyboard.press('ArrowLeft');
		await page.locator('.mlp-table td').nth(1).click(); await page.keyboard.press('Enter');
		if (action !== 'Add a row') await page.getByRole('button', { name: 'Table options', exact: true }).click();
		await page.getByRole('button', { name: action, exact: true }).click();
		await handle.focus(); await page.keyboard.press('ArrowRight');
		expect(Math.abs(await header.evaluate(cell => cell.getBoundingClientRect().width) - original)).toBeLessThan(2);
		await expect(handle).toHaveAttribute('aria-valuemax', String(Math.round(original)));
	});
}
