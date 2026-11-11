import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const errors = new WeakMap<object, string[]>();
test.beforeEach(({ page }) => {
	const found: string[] = []; errors.set(page, found);
	page.on('pageerror', error => found.push(error.message));
	page.on('console', message => { if (message.type() === 'error' && /CodeMirror|plugin crashed/i.test(message.text())) found.push(message.text()); });
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

for (const editingMode of ['editing', 'locked'] as const) for (const quoted of [false, true]) for (const indented of [false, true]) for (const operation of ['insert', 'delete']) {
	test(`${editingMode}: ${quoted ? 'quoted' : 'plain'} ${indented ? 'indented' : 'fenced'} preview remains six lines after ${operation}`, async ({ page }) => {
		const prefix = (quoted ? '> ' : '') + (indented ? '    ' : '');
		const lines = Array.from({ length: 12 }, (_, n) => `${prefix}value_${n + 1}();`);
		const code = indented ? lines.join('\n') : (quoted ? '> ' : '') + '```text\n' + lines.join('\n') + '\n' + (quoted ? '> ' : '') + '```';
		const original = 'Before\n\n' + (quoted ? '> [!note] Meeting\n>\n' : '') + code + '\n\nAfter';
		await mountEditor(page, original, { editingMode });
		await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
		const from = operation === 'insert' ? original.indexOf('value_2') : original.indexOf(prefix + 'value_2');
		const to = operation === 'insert' ? from : original.indexOf(prefix + 'value_3');
		const insert = operation === 'insert' ? 'Inserted\n' + prefix : '';
		await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from, to, insert }] });
		await expect(page.locator('.cm-content')).toContainText(operation === 'insert' ? 'value_5();' : 'value_7();');
		await expect(page.locator('.cm-content')).not.toContainText(operation === 'insert' ? 'value_6();' : 'value_8();');
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.slice(0, from) + insert + original.slice(to));
		expect(await page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'edit'))).toEqual([]);
		await page.getByRole('button', { name: 'Expand code block', exact: true }).click();
		await expect(page.locator('.cm-content')).toContainText('value_12();');
	});
}

for (const editingMode of ['editing', 'locked'] as const) test(`${editingMode}: shortening folded code to seven lines keeps a local expand control`, async ({ page }) => {
	const original = 'Before\n\n```text\n' + Array.from({ length: 12 }, (_, n) => `line_${n + 1}`).join('\n') + '\n```\n\nAfter';
	await mountEditor(page, original, { editingMode });
	await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
	const from = original.indexOf('line_8');
	const to = original.lastIndexOf('\n```');
	await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: from - 1, to, insert: '' }] });
	await expect(page.getByRole('button', { name: 'Expand code block', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Expand code block', exact: true }).click();
	await expect(page.locator('.cm-content')).toContainText('line_7');
});

test('per-key edits in visible code keep the caret stable and normalize only after leaving code', async ({ page }) => {
	const original = 'Before\n\n```text\n' + Array.from({ length: 12 }, (_, n) => `value_${n + 1}();`).join('\n') + '\n```\n\nAfter';
	await mountEditor(page, original);
	await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
	await page.locator('.cm-line', { hasText: 'value_1();' }).click();
	await page.keyboard.press('End'); await page.keyboard.press('Enter');
	for (const char of 'InserteX') await page.keyboard.type(char, { delay: 20 });
	await page.keyboard.press('Backspace'); await page.keyboard.type('d');
	await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight');
	const expected = original.replace('value_1();\n', 'value_1();\nInserted\n');
	await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(expected);
	expect(await page.locator('.cm-content').evaluate((el: any) => { const state = el.cmTile.root.view.state; return state.doc.sliceString(state.selection.main.head - 8, state.selection.main.head); })).toBe('Inserted');
	await page.locator('.cm-line', { hasText: /^After$/ }).click();
	await expect(page.locator('.cm-content')).toContainText('value_5();');
	await expect(page.locator('.cm-content')).not.toContainText('value_6();');
});

for (const remaining of [4, 6]) for (const editingMode of ['editing', 'locked'] as const) test(`${editingMode}: shortened ${remaining}-line block exposes all remaining code`, async ({ page }) => {
	const original = 'Before\n\n```text\n' + Array.from({ length: 12 }, (_, n) => `line_${n + 1}`).join('\n') + '\n```\n\nAfter';
	await mountEditor(page, original, { editingMode });
	await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
	const from = original.indexOf('\nline_2'), to = original.indexOf(`\nline_${14 - remaining}`);
	await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from, to, insert: '' }] });
	await expect(page.locator('.cm-content')).toContainText('line_12');
	await expect(page.getByRole('button', { name: 'Expand code block', exact: true })).toHaveCount(0);
	expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.slice(0, from) + original.slice(to));
});
