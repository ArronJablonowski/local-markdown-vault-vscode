import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

for (const editingMode of ['editing', 'locked'] as const) for (const context of ['plain', 'callout', 'list']) for (const kind of ['fenced', 'unclosed', 'indented']) for (const global of [false, true]) {
	test(`${editingMode}: ${context} ${kind} code retains six lines, global=${global}`, async ({ page }) => {
		const lines = Array.from({ length: 12 }, (_, n) => `snippet_${n + 1}();`);
		const code = kind === 'indented' ? lines.map(line => '    ' + line).join('\n') : '```text\n' + lines.join('\n') + (kind === 'unclosed' ? '' : '\n```');
		const block = context === 'callout' ? '> [!note] Code\n>\n> ' + code.split('\n').join('\n> ') : context === 'list' ? '- Item\n\n  ' + code.split('\n').join('\n  ') : code;
		const original = 'Before\n\n' + block + (kind === 'unclosed' ? '' : '\n\nAfter');
		await mountEditor(page, original, { editingMode });
		if (global && context === 'callout') {
			// Global folding hides the parent too; reopen it to inspect the code preview.
			await page.getByRole('button', { name: 'Collapse all collapsible objects' }).click();
			await page.getByRole('button', { name: 'Code callout', exact: true }).click();
		} else await page.getByRole('button', { name: global ? 'Collapse all collapsible objects' : 'Collapse code block', exact: true }).click();
		for (let n = 1; n <= 6; n++) await expect(page.locator('.cm-content')).toContainText(`snippet_${n}();`);
		await expect(page.locator('.cm-content')).not.toContainText('snippet_7();');
		await expect(page.locator('.cm-content')).not.toContainText('snippet_12();');
		await page.getByRole('button', { name: 'Copy code block', exact: true }).click();
		await expect.poll(() => page.evaluate(() => (window as any).__posted.findLast((m: any) => m.type === 'copyCode')?.text)).toBe(lines.join('\n'));
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
		expect(await page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'edit'))).toEqual([]);
		await page.getByRole('button', { name: 'Expand code block', exact: true }).press('Enter');
		await expect(page.locator('.cm-content')).toContainText('snippet_12();');
	});
}

test('blank content lines count toward the six-line preview', async ({ page }) => {
	await mountEditor(page, 'Before\n\n```text\none\n\nthree\nfour\n\nsix\nseven\neight\n```\n\nAfter');
	await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
	await expect(page.locator('.cm-content')).toContainText('six');
	await expect(page.locator('.cm-content')).not.toContainText('seven');
});

test('editing before a mapped code fold does not strand its hidden content', async ({ page }) => {
	const original = 'Before\n\n```text\n' + Array.from({ length: 12 }, (_, n) => `value_${n + 1}`).join('\n') + '\n```\n\nAfter';
	await mountEditor(page, original);
	await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
	const from = original.indexOf('value_2');
	await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from, to: from, insert: 'Inserted\n' }] });
	await page.getByRole('button', { name: 'Expand code block', exact: true }).click();
	await expect(page.locator('.cm-content')).toContainText('value_12');
});
