import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

for (const editingMode of ['editing', 'locked'] as const) for (const depth of [1, 2]) for (const underline of ['===', '---']) {
	test(`${editingMode}: embedded quote depth ${depth} preserves mixed heading ${underline} and multiline prose`, async ({ page }) => {
		const original = 'Before\n\n![[Meeting]]\n\nAfter';
		await mountEditor(page, original, { editingMode,
			vaultNotes: [{ path: 'Meeting.md', basename: 'Meeting', aliases: [], headings: [], blockIds: [] }],
		});
		await expect.poll(() => page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed')?.requestId)).toBeTruthy();
		const requestId = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed').requestId);
		const prefix = '> '.repeat(depth);
		const quoted = ['**Meeting** with `code`', 'continued *heading*', underline, '', 'First **bold** line', 'second *italic* with `a > b` and [notes](Notes.md)', '', '- **Action**', '  - `nested`'];
		await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: 'Meeting.md', text: quoted.map(line => prefix + line).join('\n') + '\n\n| Owner |\n| --- |\n| *Alex* |' });
		const embed = page.locator('.mlp-wiki-embed-content');
		const heading = embed.locator(underline === '===' ? 'h1' : 'h2');
		await expect(heading).toHaveText('Meeting with code\ncontinued heading');
		await expect(heading.locator('strong')).toHaveText('Meeting');
		await expect(heading.locator('em')).toHaveText('heading');
		const paragraph = embed.locator('p').filter({ hasText: 'First bold line' });
		await expect(paragraph).toHaveText('First bold line\nsecond italic with a > b and notes');
		await expect(paragraph.locator('code')).toHaveText('a > b');
		await expect(paragraph.locator('a')).toHaveAttribute('data-href', 'Notes.md');
		await expect(embed.locator('ul ul code')).toHaveText('nested');
		await expect(embed.locator('table em')).toHaveText('Alex');
		await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: 0, to: 6, insert: 'Revised' }] });
		await expect(page.locator('.mlp-wiki-embed-content').locator(underline === '===' ? 'h1' : 'h2')).toHaveText('Meeting with code\ncontinued heading');
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.replace('Before', 'Revised'));
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	});
}
