import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const labels = [
	['**Bold** and *italic* with `code`', 'Bold and italic with code'],
	['outer ![inner](nested.png) label', 'outer inner label'],
	['\\*literal\\* <b>label</b>', '*literal* label'],
];
for (const editingMode of ['editing', 'locked'] as const) for (const context of ['table', 'cell list', 'embedded quote', 'embedded table']) for (const [label, alt] of labels) {
	test(`${editingMode}: image description ${label} in ${context} is readable and non-fetching`, async ({ page }) => {
		const requests: string[] = [];
		page.on('request', request => requests.push(request.url()));
		const imageSource = `![${label}](https://tracker.invalid/chart.png)`;
		const cell = context === 'cell list' ? `<ul><li>${imageSource}</li><li>**Review**</li></ul>` : imageSource;
		const table = `| Media | Link |\n| --- | --- |\n| ${cell} | [**Notes**](Notes.md) |\n| \`literal image\` | ~~retired~~ |`;
		const embedded = context.startsWith('embedded');
		const original = embedded ? 'Before\n\n![[Images]]\n\nAfter' : 'Before\n\n' + table + '\n\nAfter';
		await mountEditor(page, original, { editingMode,
			vaultNotes: [{ path: 'Images.md', basename: 'Images', aliases: [], headings: [], blockIds: [] }],
		});
		if (embedded) {
			await expect.poll(() => page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed')?.requestId)).toBeTruthy();
			const requestId = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed').requestId);
			await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: 'Images.md', text:
				context === 'embedded table' ? table : '> ' + imageSource + '\n\n- [x] **Reviewed**' });
		}
		const root = page.locator(embedded ? '.mlp-wiki-embed-content' : '.mlp-table');
		await expect(root.locator('img')).toHaveCount(1);
		await expect(root.locator('img')).toHaveAttribute('alt', alt);
		await expect(root.locator('img')).toHaveAccessibleName(alt);
		await expect(root.locator('img')).not.toHaveAttribute('src');
		expect(requests.some(url => url.includes('tracker.invalid') || url.endsWith('/nested.png'))).toBe(false);
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'resolveLocalImage' && JSON.stringify(message).includes('nested.png')))).toEqual([]);
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	});
}
