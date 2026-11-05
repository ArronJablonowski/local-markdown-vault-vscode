import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

for (const editingMode of ['editing', 'locked'] as const) for (const depth of [0, 1, 2]) for (const marker of ['  ', '\\']) {
	test(`${editingMode}: explicit break ${JSON.stringify(marker)} in formatted embed at quote depth ${depth}`, async ({ page }) => {
		const original = 'Before\n\n![[Breaks]]\n\nAfter';
		await mountEditor(page, original, { editingMode,
			vaultNotes: [{ path: 'Breaks.md', basename: 'Breaks', aliases: [], headings: [], blockIds: [] }],
		});
		await expect.poll(() => page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed')?.requestId)).toBeTruthy();
		const requestId = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed').requestId);
		const paragraph = `**first${marker}\nsecond** and [notes${marker}\ncontinued](Notes.md)`;
		const prefix = '> '.repeat(depth);
		await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: 'Breaks.md', text:
			paragraph.split('\n').map(line => prefix + line).join('\n') + '\n\n`literal  \ncode`\n\n| Owner |\n| --- |\n| **Alex** |' });
		const embed = page.locator('.mlp-wiki-embed-content');
		await expect(embed.locator('strong br')).toHaveCount(1);
		await expect(embed.locator('a br')).toHaveCount(1);
		await expect(embed.locator('a')).toHaveAttribute('data-href', 'Notes.md');
		await expect(embed.locator('code')).toHaveText('literal   code');
		await expect(embed.locator('code br')).toHaveCount(0);
		await expect(embed.locator('table strong')).toHaveText('Alex');
		// Check actual line geometry, not just the presence of a break element.
		expect(await embed.locator('strong').first().evaluate(element => {
			const first = document.createRange(); first.selectNodeContents(element.firstChild!);
			const second = document.createRange(); second.selectNodeContents(element.lastChild!);
			return second.getBoundingClientRect().top > first.getBoundingClientRect().top;
		})).toBe(true);
		await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: 0, to: 6, insert: 'Revised' }] });
		await expect(page.locator('.mlp-wiki-embed-content strong br')).toHaveCount(1);
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.replace('Before', 'Revised'));
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	});
}
