import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

for (const editingMode of ['editing', 'locked'] as const) for (const start of [0, 3, 42, 999999999]) {
	test(`${editingMode}: embedded agenda ${start} mixes numbering, nested bullets, tables, and empty fences`, async ({ page }) => {
		const original = 'Before\n\n![[Agenda]]\n\nAfter';
		await mountEditor(page, original, {
			editingMode, vaultNotes: [{ path: 'Agenda.md', basename: 'Agenda', aliases: [], headings: [], blockIds: [] }],
		});
		await expect.poll(() => page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed')?.requestId)).toBeTruthy();
		const requestId = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed').requestId);
		await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: 'Agenda.md', text: [
			'# **Agenda**', '', `${start}. **Decision** with [context](Notes.md)`,
			' '.repeat(String(start).length + 2) + '- `follow up`', '',
			'| Owner | Action |', '| --- | --- |', '| **Alex** | ` review ` |', '',
			'```js', '```', '', '~~~text', '~~~', '', '```js', 'const safe = "<br>";', '```',
		].join('\n') });
		const embed = page.locator('.mlp-wiki-embed-content');
		await expect(embed.locator('ol')).toHaveAttribute('start', String(start));
		await expect(embed.locator('ol > li > ul code')).toHaveText('follow up');
		await expect(embed.locator('ol strong')).toHaveText('Decision');
		await expect(embed.locator('ol a')).toHaveAttribute('data-href', 'Notes.md');
		await expect(embed.locator('table tbody code')).toHaveText('review');
		await expect(embed.locator('pre code')).toHaveText(['', '', 'const safe = "<br>";']);
		await expect(embed.locator('pre code br')).toHaveCount(0);
		await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: 0, to: 6, insert: 'Revised introduction' }] });
		await expect(page.locator('.mlp-wiki-embed-content ol')).toHaveAttribute('start', String(start));
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.replace('Before', 'Revised introduction'));
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	});
}
