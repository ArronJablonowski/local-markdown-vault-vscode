import { expect, test, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

async function editedText(page: Page, source: string): Promise<string> {
	return page.evaluate(original => {
		let text = original;
		for (const message of (window as any).__posted) {
			if (message.type !== 'edit') continue;
			for (const change of [...message.changes].reverse()) text = text.slice(0, change.from) + change.insert + text.slice(change.to);
		}
		return text;
	}, source);
}

test('typing adjacent pipes in a rendered cell preserves its neighbor and table width', async ({ page }) => {
	const source = 'Intro\n\n| A | B |\n| --- | --- |\n| Original | Neighbor stays |\n\nAfter';
	await mountEditor(page, source);
	await page.locator('.mlp-table td').first().click();
	await expect(page.locator('.mlp-table td').first()).toHaveAttribute('contenteditable', 'true');
	await page.keyboard.press(`${modifier}+a`);
	await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Original');
	await page.keyboard.insertText('left||right|||tail');
	await page.keyboard.press('Enter');
	await expect.poll(() => editedText(page, source)).toContain('left\\|\\|right\\|\\|\\|tail');
	await expect(page.locator('.mlp-table tbody tr')).toHaveCount(1);
	await expect(page.locator('.mlp-table tbody td')).toHaveCount(2);
	await expect(page.locator('.mlp-table td').first()).toHaveText('left||right|||tail');
	await expect(page.locator('.mlp-table td').last()).toHaveText('Neighbor stays');
});

test('adding a row does not erase source cells hidden beyond the GFM display width', async ({ page }) => {
	const source = 'Intro\n\n| A | B |\n| --- | --- |\n| One | Two | Hidden source remains |\n\nAfter';
	await mountEditor(page, source);
	await expect(page.locator('.mlp-table td')).toHaveCount(2);
	await page.locator('.mlp-table-add-row').click();
	await expect.poll(() => editedText(page, source)).toContain('| One | Two | Hidden source remains |');
	await expect(page.locator('.mlp-table tbody tr')).toHaveCount(2);
	await expect(page.locator('.mlp-table thead th')).toHaveCount(2);
});

for (const columns of [3, 12]) {
	test(`select-all and deletion affect only the focused cell in a ${columns}-column table, and undo restores it`, async ({ page }) => {
		const rows = columns === 12 ? 100 : 4;
		const line = (values: string[]) => `| ${values.join(' | ')} |`;
		const table = [line(Array.from({ length: columns }, (_, c) => `Heading ${c}`)),
			line(Array(columns).fill('---')),
			...Array.from({ length: rows }, (_, r) => line(Array.from({ length: columns }, (_, c) => `Row ${r} cell ${c}`)))].join('\n');
		const source = `Before\n\n${table}\n\nAfter`;
		await page.setViewportSize({ width: 500, height: 700 });
		await mountEditor(page, source);
		await page.locator('.mlp-table-viewport').evaluate(el => { el.scrollLeft = el.scrollWidth; });
		const cell = page.locator('.mlp-table tbody tr').first().locator('td').last();
		await cell.click();
		await page.keyboard.press(`${modifier}+a`);
		await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(`Row 0 cell ${columns - 1}`);
		await page.keyboard.press('Backspace');
		await page.keyboard.press('Enter');
		await expect(cell).toHaveText('');
		await expect(page.locator('.mlp-table tbody tr')).toHaveCount(rows);
		await expect(page.locator('.mlp-table tbody tr').first().locator('td').first()).toHaveText('Row 0 cell 0');
		const expected = source.replace(`Row 0 cell ${columns - 1}`, '');
		await expect.poll(() => editedText(page, source)).toBe(expected);
		await page.keyboard.press(`${modifier}+z`);
		// Undo belongs to the host's workspace edit history. The lightweight
		// browser host records the request but does not implement native undo.
		await expect.poll(() => page.evaluate(() => (window as any).__posted
			.filter((message: any) => message.type === 'edit' || message.type === 'undo')
			.map((message: any) => message.type))).toEqual(['edit', 'undo']);
		const from = source.indexOf(`Row 0 cell ${columns - 1}`);
		await postToWebview(page, { type: 'externalUpdate', version: 2,
			changes: [{ from, to: from, insert: `Row 0 cell ${columns - 1}` }] });
		await expect.poll(() => page.evaluate(() => (window as any).__posted
			.filter((message: any) => message.type === 'draftSnapshot').at(-1)?.text)).toBe(source);
		// Undo can restore the caret within table source. Move to the beginning
		// before asserting rendered cells, rather than requiring raw-source mode
		// to render an actively selected table.
		await postToWebview(page, { type: 'jumpToLine', line: 1 });
		await expect(cell).toHaveText(`Row 0 cell ${columns - 1}`);
		await expect(page.locator('.cm-content')).toContainText('Before');
	});
}
