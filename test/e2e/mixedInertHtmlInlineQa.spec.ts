import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

for (const editingMode of ['editing', 'locked'] as const) for (const embedded of [false, true]) for (const tag of ['div', 'p', 'section']) for (const context of ['cell', 'list', 'link', 'image']) {
	test(`${editingMode}: inert ${tag} formatting in ${embedded ? 'embedded' : 'local'} ${context}`, async ({ page }) => {
		const fragment = `<${tag}>**visible** <br>*detail*</${tag}>`;
		const value = context === 'list' ? `<ul><li>${fragment}</li></ul>` : context === 'link' ? `[${fragment}](Notes.md)` : context === 'image' ? `![${fragment}](https://tracker.invalid/image.png)` : fragment;
		const table = `| Value | Neighbor |\n| --- | --- |\n| ${value} | ~~Retained~~ |`;
		const original = embedded ? 'Before\n\n![[Inline]]\n\nAfter' : 'Before\n\n' + table + '\n\nAfter';
		await mountEditor(page, original, { editingMode, vaultNotes: [{ path: 'Inline.md', basename: 'Inline', aliases: [], headings: [], blockIds: [] }] });
		if (embedded) {
			await expect.poll(() => page.evaluate(() => (window as any).__posted.find((m: any) => m.type === 'readWikiEmbed')?.requestId)).toBeTruthy();
			const requestId = await page.evaluate(() => (window as any).__posted.find((m: any) => m.type === 'readWikiEmbed').requestId);
			await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: 'Inline.md', text: '> ' + table.split('\n').join('\n> ') });
		}
		const cell = page.locator('.mlp-table td').first();
		if (context === 'image') {
			await expect(cell.locator('img')).toHaveAttribute('alt', 'visible detail');
			await expect(cell.locator('img')).not.toHaveAttribute('src');
		} else {
			await expect(cell.locator('strong')).toHaveText('visible');
			await expect(cell.locator('em')).toHaveText('detail');
			await expect(cell.locator('br')).toHaveCount(1);
			await expect(cell).toContainText(`<${tag}>`);
			await expect(cell.locator(tag)).toHaveCount(0);
			if (context === 'link') await expect(cell.locator('a')).toHaveAttribute('data-href', 'Notes.md');
		}
		await expect(page.locator('.mlp-table td').last().locator('del')).toHaveText('Retained');
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
		expect(await page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'edit'))).toEqual([]);
	});
}
