import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

for (const editingMode of ['editing', 'locked'] as const) for (const context of ['table', 'embedded table', 'embedded paragraph', 'embedded quote']) for (const nested of [false, true]) {
	test(`${editingMode}: image code pipes retain ${context} rules, nested=${nested}`, async ({ page }) => {
		const label = nested ? 'outer ![`x\\|y`](inner.png) **label**' : '`x\\|y` and **label**';
		const image = `![${label}](https://tracker.invalid/image.png)`;
		const table = `| Image | Literal |\n| --- | --- |\n| ${image} | \`a\\|b\` |`;
		const embedded = context !== 'table';
		const original = embedded ? 'Before\n\n![[Pipes]]\n\nAfter' : 'Before\n\n' + table + '\n\nAfter';
		await mountEditor(page, original, { editingMode,
			vaultNotes: [{ path: 'Pipes.md', basename: 'Pipes', aliases: [], headings: [], blockIds: [] }],
		});
		if (embedded) {
			await expect.poll(() => page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed')?.requestId)).toBeTruthy();
			const requestId = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed').requestId);
			await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: 'Pipes.md', text: context === 'embedded table' ? table : (context === 'embedded quote' ? '> ' : '') + image });
		}
		const root = page.locator(embedded ? '.mlp-wiki-embed-content' : '.mlp-table');
		const pipe = context.includes('table') ? 'x|y' : 'x\\|y';
		await expect(root.locator('img')).toHaveCount(1);
		await expect(root.locator('img')).toHaveAttribute('alt', nested ? `outer ${pipe} label` : `${pipe} and label`);
		await expect(root.locator('img')).not.toHaveAttribute('src');
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'resolveLocalImage' && message.src === 'inner.png'))).toEqual([]);
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	});
}
