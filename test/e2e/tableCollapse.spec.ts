import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mountEditor, postToWebview } from './harness';

const table = (count: number) => '| Name | Notes |\n| --- | --- |\n' + Array.from({ length: count }, (_, n) => `| Row ${n + 1} | **Detail ${n + 1}** |`).join('\n');
for (const editingMode of ['editing', 'locked'] as const) for (const callout of [false, true]) for (const count of [5, 6, 40]) {
	test(`${editingMode}: ${count} rows ${callout ? 'in callout' : 'standalone'} collapse without editing source`, async ({ page }) => {
		const content = callout ? '> [!note] Meeting\n>\n> ' + table(count).split('\n').join('\n> ') : table(count);
		const original = 'Before\n\n' + content + '\n\nAfter';
		await mountEditor(page, original, { editingMode });
		const button = page.getByRole('button', { name: 'Collapse table', exact: true });
		if (count <= 5) { await expect(button).toHaveCount(0); return; }
		await button.click();
		await expect(page.locator('.mlp-table tbody tr:visible')).toHaveCount(5);
		await expect(page.locator('.mlp-table thead')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Expand table', exact: true })).toHaveAttribute('aria-expanded', 'false');
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
		expect(await page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'edit'))).toEqual([]);
		await page.getByRole('button', { name: 'Expand table', exact: true }).press('Enter');
		await expect(page.locator('.mlp-table tbody tr:visible')).toHaveCount(count);
	});
}

test('table collapse survives preceding edits, resizing, and source round trips', async ({ page }) => {
	await mountEditor(page, 'Before\n\n' + table(10) + '\n\nAfter');
	await page.getByRole('button', { name: 'Collapse table', exact: true }).click();
	await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: 0, to: 0, insert: 'Added\n\n' }] });
	await expect(page.locator('.mlp-table tbody tr:visible')).toHaveCount(5);
	await page.getByRole('separator', { name: 'Resize column 1', exact: true }).focus(); await page.keyboard.press('Shift+ArrowRight');
	await expect(page.locator('.mlp-table tbody tr:visible')).toHaveCount(5);
	await page.getByRole('button', { name: 'Show Markdown source', exact: true }).click();
	await expect(page.locator('.cm-content')).toContainText('Row 10');
	await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.dispatch({ selection: { anchor: 0 } }));
	await expect(page.locator('.mlp-table tbody tr:visible')).toHaveCount(5);
});

test('navigation into the sixth row expands instead of trapping keyboard focus', async ({ page }) => {
	await mountEditor(page, 'Before\n\n' + table(10) + '\n\nAfter', { editingMode: 'locked' });
	await page.getByRole('button', { name: 'Collapse table', exact: true }).click();
	await page.locator('.mlp-table tbody tr').nth(4).locator('td').first().focus();
	await page.keyboard.press('ArrowDown');
	await expect(page.locator('.mlp-table tbody tr').nth(5).locator('td').first()).toBeFocused();
	await expect(page.locator('.mlp-table tbody tr:visible')).toHaveCount(10);
});

test('global collapse and expand include tables', async ({ page }) => {
	await mountEditor(page, 'Before\n\n' + table(10) + '\n\nAfter');
	await page.getByRole('button', { name: 'Collapse all collapsible objects' }).click();
	await expect(page.locator('.mlp-table tbody tr:visible')).toHaveCount(5);
	await page.getByRole('button', { name: 'Expand all collapsible objects' }).click();
	await expect(page.locator('.mlp-table tbody tr:visible')).toHaveCount(10);
});

test('collapsing commits a pending cell edit without losing text', async ({ page }) => {
	await mountEditor(page, 'Before\n\n' + table(10) + '\n\nAfter');
	await page.locator('.mlp-table tbody td').first().click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a'); await page.keyboard.type('Updated');
	await page.getByRole('button', { name: 'Collapse table', exact: true }).click();
	await expect(page.locator('.mlp-table tbody tr:visible')).toHaveCount(5);
	await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toContain('Updated');
});

test('read-only embedded notes offer independent table collapse', async ({ page }) => {
	await mountEditor(page, 'Before\n\n![[Tables]]\n\nAfter', { vaultNotes: [{ path: 'Tables.md', basename: 'Tables', aliases: [], headings: [], blockIds: [] }] });
	await expect.poll(() => page.evaluate(() => (window as any).__posted.find((m: any) => m.type === 'readWikiEmbed')?.requestId)).toBeTruthy();
	const requestId = await page.evaluate(() => (window as any).__posted.find((m: any) => m.type === 'readWikiEmbed').requestId);
	await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: 'Tables.md', text: table(9) });
	await page.getByRole('button', { name: 'Collapse table', exact: true }).click();
	await expect(page.locator('.mlp-embed-table tbody tr:visible')).toHaveCount(5);
	await page.getByRole('button', { name: 'Expand table', exact: true }).click();
	await expect(page.locator('.mlp-embed-table tbody tr:visible')).toHaveCount(9);
});

test('Markdown Preview controls collapse, refresh, and preserve complete table data', async ({ page }) => {
	await page.setContent('<table><thead><tr><th>Header</th></tr></thead><tbody>' + Array.from({ length: 9 }, (_, n) => `<tr><td>Row ${n}</td></tr>`).join('') + '</tbody></table>');
	await page.addStyleTag({ content: readFileSync(join(process.cwd(), 'media/markdown-preview-copy.css'), 'utf8') });
	await page.addScriptTag({ content: readFileSync(join(process.cwd(), 'media/markdown-preview-copy.js'), 'utf8') });
	await page.getByRole('button', { name: 'Collapse table', exact: true }).click();
	await expect(page.locator('tbody tr:visible')).toHaveCount(5);
	await expect(page.locator('tbody tr')).toHaveCount(9);
	await page.evaluate(() => document.querySelector('tbody')!.insertAdjacentHTML('beforeend', '<tr><td>New row</td></tr>'));
	await expect(page.locator('tbody tr:visible')).toHaveCount(5);
	await page.getByRole('button', { name: 'Expand table', exact: true }).click();
	await expect(page.locator('tbody tr:visible')).toHaveCount(10);
});
