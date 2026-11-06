import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

for (const editingMode of ['editing', 'locked'] as const) for (const embedded of [false, true]) for (const context of ['cell', 'cell list', 'link label', 'image label']) for (const marker of ['```', '~~~']) {
	test(`${editingMode}: ${marker} remains visible in ${context}, embed=${embedded}`, async ({ page }) => {
		const inline = `${marker} **visible**`;
		const value = context === 'cell list' ? `<ul><li>${inline}</li></ul>` : context === 'link label' ? `[${inline}](Notes.md)`
			: context === 'image label' ? `![${inline}](https://tracker.invalid/x.png)` : inline;
		const table = `| Value | Neighbor |\n| --- | --- |\n| ${value} | *Retained* |`;
		const original = embedded ? 'Before\n\n![[Incomplete]]\n\nAfter' : 'Before\n\n' + table + '\n\nAfter';
		await mountEditor(page, original, { editingMode,
			vaultNotes: [{ path: 'Incomplete.md', basename: 'Incomplete', aliases: [], headings: [], blockIds: [] }],
		});
		if (embedded) {
			await expect.poll(() => page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed')?.requestId)).toBeTruthy();
			const requestId = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed').requestId);
			await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: 'Incomplete.md', text: '> ' + table.split('\n').join('\n> ') + '\n\n```text\nactual block\n```' });
		}
		const root = page.locator('.mlp-table');
		if (context === 'image label') await expect(root.locator('img')).toHaveAttribute('alt', `${marker} visible`);
		else { await expect(root.locator('td').first()).toHaveText(`${marker} visible`); await expect(root.locator('strong')).toHaveText('visible'); }
		await expect(root.locator('td').last().locator('em')).toHaveText('Retained');
		if (embedded) await expect(page.locator('.mlp-wiki-embed-content pre code')).toHaveText('actual block');
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	});
}

test('character-by-character fence-like cell edits remain visible after every commit', async ({ page }) => {
	const original = 'Before\n\n| Value | Neighbor |\n| --- | --- |\n| Seed | Retained |\n\nAfter';
	await mountEditor(page, original);
	const cell = page.locator('.mlp-table td').first();
	for (const value of ['`', '``', '```', '``` text', '```literal```', '~~~', '~~~ text']) {
		await cell.click(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
		await page.keyboard.type(value, { delay: 20 }); await page.keyboard.press('Enter');
		await expect(cell).toHaveText(value === '```literal```' ? 'literal' : value);
		await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.replace('Seed', value));
		await expect(page.locator('.mlp-table td').last()).toHaveText('Retained');
	}
});
