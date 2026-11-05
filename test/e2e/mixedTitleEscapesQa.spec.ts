import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const titles = [
	['"Review \\"quoted\\" notes"', 'Review "quoted" notes'],
	["'Review \\'quoted\\' notes'", "Review 'quoted' notes"],
	['(Review \\(draft\\) notes)', 'Review (draft) notes'],
	['"<img src=x onerror=alert(1)> \\"quoted\\""', '<img src=x onerror=alert(1)> "quoted"'],
];
for (const editingMode of ['editing', 'locked'] as const) for (const context of ['table', 'embedded quote', 'embedded table']) for (const [title, expectedTitle] of titles) {
	test(`${editingMode}: escaped title ${title} in ${context} stays inert and displays correctly`, async ({ page }) => {
		const requests: string[] = [];
		page.on('request', request => requests.push(request.url()));
		const inline = `**[Notes](Notes.md ${title})** and ![Chart](https://tracker.invalid/image.png ${title})`;
		const table = `| Reference |\n| --- |\n| ${inline} |\n| \`literal title\` and ~~retired~~ |`;
		const embedded = context !== 'table';
		const original = embedded ? 'Before\n\n![[Titles]]\n\nAfter' : 'Before\n\n' + table + '\n\nAfter';
		await mountEditor(page, original, { editingMode,
			vaultNotes: [{ path: 'Titles.md', basename: 'Titles', aliases: [], headings: [], blockIds: [] }],
		});
		if (embedded) {
			await expect.poll(() => page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed')?.requestId)).toBeTruthy();
			const requestId = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed').requestId);
			await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: 'Titles.md', text:
				context === 'embedded table' ? table : inline.split('\n').map(line => '> ' + line).join('\n') + '\n\n- [x] **Reviewed**' });
		}
		const root = page.locator(embedded ? '.mlp-wiki-embed-content' : '.mlp-table');
		const link = root.getByRole('link', { name: 'Notes', exact: true });
		await expect(link).toHaveAttribute('title', expectedTitle);
		await expect(link).toHaveAttribute('data-href', 'Notes.md');
		const image = root.locator('img');
		await expect(image).toHaveAttribute('title', expectedTitle);
		await expect(image).not.toHaveAttribute('src');
		await expect(image).not.toHaveAttribute('onerror');
		await expect(link).not.toHaveAttribute('onmouseover');
		await expect(root.locator('script')).toHaveCount(0);
		expect(requests.some(url => url.includes('tracker.invalid'))).toBe(false);
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	});
}
