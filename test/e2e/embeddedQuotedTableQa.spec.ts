import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

for (const editingMode of ['editing', 'locked'] as const) for (const depth of [0, 1, 2]) for (const borderless of [false, true]) for (const inList of [false, true]) {
	test(`${editingMode}: embedded mixed table at quote depth ${depth}, borderless=${borderless}, list=${inList}`, async ({ page }) => {
		const original = 'Before\n\n![[Grid]]\n\nAfter';
		await mountEditor(page, original, { editingMode,
			vaultNotes: [{ path: 'Grid.md', basename: 'Grid', aliases: [], headings: [], blockIds: [] }],
		});
		await expect.poll(() => page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed')?.requestId)).toBeTruthy();
		const requestId = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed').requestId);
		const rows = ['| **Owner** | Code | Literal | Actions |', '| :--- | :---: | ---: | --- |',
			'| *Alex* | `x\\|y` | > literal | <ul><li>**Review**</li><li>[Notes](Notes.md)</li></ul> |',
			'| ~~Sam~~ | `z` | retained | follow up |'];
		const table = rows.map((line, index) => '> '.repeat(depth) + (inList ? index === 0 ? '- ' : '  ' : '') + (borderless ? line.slice(1, -1).trim() : line)).join('\n');
		await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: 'Grid.md', text:
			'# Meeting\n\n- [x] **Reviewed**\n\n' + table + '\n\n```text\n> literal code\n```' });
		const rendered = page.locator('.mlp-embed-table');
		await expect(rendered.locator('thead th')).toHaveText(['Owner', 'Code', 'Literal', 'Actions']);
		await expect(rendered.locator('tbody tr').first().locator('td')).toHaveText(['Alex', 'x|y', '> literal', 'ReviewNotes']);
		await expect(rendered.locator('tbody tr').last().locator('td')).toHaveText(['Sam', 'z', 'retained', 'follow up']);
		for (const [index, alignment] of ['left', 'center', 'right'].entries()) await expect(rendered.locator('tbody tr').first().locator('td').nth(index)).toHaveCSS('text-align', alignment);
		await expect(rendered.locator('tbody li')).toHaveText(['Review', 'Notes']);
		await expect(rendered.locator('tbody a')).toHaveAttribute('data-href', 'Notes.md');
		await expect(page.locator('.mlp-wiki-embed-content pre code')).toHaveText('> literal code');
		await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: 0, to: 6, insert: 'Revised' }] });
		await expect(page.locator('.mlp-embed-table tbody tr').first().locator('td')).toHaveText(['Alex', 'x|y', '> literal', 'ReviewNotes']);
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.replace('Before', 'Revised'));
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	});
}
