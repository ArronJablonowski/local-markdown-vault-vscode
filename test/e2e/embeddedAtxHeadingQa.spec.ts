import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

for (const editingMode of ['editing', 'locked'] as const) for (const level of [1, 2, 3, 4, 5, 6]) for (const context of ['plain', 'quote', 'list', 'quoted list']) {
	test(`${editingMode}: level ${level} empty and mixed embedded headings in ${context}`, async ({ page }) => {
		const original = 'Before\n\n![[Headings]]\n\nAfter';
		await mountEditor(page, original, { editingMode,
			vaultNotes: [{ path: 'Headings.md', basename: 'Headings', aliases: [], headings: [], blockIds: [] }],
		});
		await expect.poll(() => page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed')?.requestId)).toBeTruthy();
		const requestId = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed').requestId);
		const marker = '#'.repeat(level);
		const content = [marker, '', `${marker} ${marker}`, '', `${marker} **Heading** #hash \`##\` ${marker}`, '', `${marker} \\#literal`, '',
			'- [x] **Done**', '', '| Owner | Value |', '| --- | --- |', '| *Alex* | `x` |', '', '```text', '# literal code', '```'].join('\n');
		const quoted = context.includes('quot'); const inList = context.includes('list');
		const text = content.split('\n').map((line, index) => (quoted ? '> ' : '') + (inList ? index === 0 ? '- ' : '  ' : '') + line).join('\n');
		await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: 'Headings.md', text });
		const embed = page.locator('.mlp-wiki-embed-content');
		await expect(embed.locator(`h${level}`)).toHaveText(['', '', 'Heading #hash ##', '#literal']);
		await expect(embed.locator(`h${level} strong`)).toHaveText('Heading');
		await expect(embed.locator(`h${level} code`)).toHaveText('##');
		await expect(embed.getByRole('checkbox')).toBeChecked();
		await expect(embed.getByRole('checkbox')).toBeDisabled();
		await expect(embed.locator('table em')).toHaveText('Alex');
		await expect(embed.locator('pre code')).toHaveText('# literal code');
		await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: 0, to: 6, insert: 'Revised' }] });
		await expect(page.locator(`.mlp-wiki-embed-content h${level}`)).toHaveText(['', '', 'Heading #hash ##', '#literal']);
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.replace('Before', 'Revised'));
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	});
}
