import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const titles = [
	['"A &amp; B &#169; &NotEqualTilde;"', 'A & B © ≂̸'],
	['"\\&copy; &amp;copy;"', '&copy; &copy;'],
	['"&quot;&lt;img src=x onerror=alert(1)&gt;"', '"<img src=x onerror=alert(1)>'],
	["'&apos; &#x1F642; &#0;'", "' 🙂 �"],
	['(Draft &unknown; &copy)', 'Draft &unknown; &copy'],
	['"Line&NewLine;Tab&Tab;End"', 'Line\nTab\tEnd'],
];
for (const editingMode of ['editing', 'locked'] as const) for (const context of ['table', 'cell list', 'callout table', 'embedded quote', 'embedded list', 'embedded table']) for (const [title, expectedTitle] of titles) {
	test(`${editingMode}: title ${title} in ${context} decodes once without changing structure`, async ({ page }) => {
		const inline = `**[Notes](Notes.md ${title})** and ![~~Chart~~](https://tracker.invalid/image.png ${title})`;
		const value = context === 'cell list' ? `<ul><li>${inline}</li></ul>` : inline;
		const table = `| Reference | Other |\n| --- | --- |\n| ${value} | \`&copy;\` |`;
		const embedded = context.startsWith('embedded');
		const body = context === 'callout table' ? '> [!warning] Review\n>\n> ' + table.split('\n').join('\n> ') : table;
		const original = embedded ? 'Before\n\n![[Titles]]\n\nAfter' : 'Before\n\n' + body + '\n\nAfter';
		const requests: string[] = [];
		page.on('request', request => { if (request.url().includes('tracker.invalid')) requests.push(request.url()); });
		await mountEditor(page, original, { editingMode, vaultNotes: [{ path: 'Titles.md', basename: 'Titles', aliases: [], headings: [], blockIds: [] }] });
		if (embedded) {
			await expect.poll(() => page.evaluate(() => (window as any).__posted.find((m: any) => m.type === 'readWikiEmbed')?.requestId)).toBeTruthy();
			const requestId = await page.evaluate(() => (window as any).__posted.find((m: any) => m.type === 'readWikiEmbed').requestId);
			const text = context === 'embedded quote' ? `> ${inline}\n>\n> - [x] **Reviewed**` : context === 'embedded list' ? `- [x] ${inline}\n  - *Detail*` : '> ' + table.split('\n').join('\n> ');
			await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: 'Titles.md', text });
		}
		const root = page.locator(embedded ? '.mlp-wiki-embed-content' : '.mlp-table');
		const link = root.getByRole('link', { name: 'Notes', exact: true });
		await expect(link).toHaveAttribute('title', expectedTitle);
		await expect(link).toHaveAttribute('data-href', 'Notes.md');
		await expect(link).not.toHaveAttribute('href');
		const image = root.locator('img');
		await expect(image).toHaveAttribute('title', expectedTitle);
		await expect(image).toHaveAttribute('alt', 'Chart');
		await expect(image).not.toHaveAttribute('src');
		await expect(image).not.toHaveAttribute('onerror');
		await expect(root.locator('script')).toHaveCount(0);
		if (context.includes('table') || context === 'cell list') await expect(root.locator('td').last().locator('code')).toHaveText('&copy;');
		expect(requests).toEqual([]);
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
		expect(await page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'edit'))).toEqual([]);
	});
}

test('per-key title edits, backspaces, and replacements preserve a callout table', async ({ page }) => {
	const original = 'Before\n\n> [!note] Meeting\n>\n> | Reference | Other |\n> | --- | --- |\n> | Seed | Retained |\n\nAfter';
	await mountEditor(page, original);
	const cell = page.locator('.mlp-table td').first();
	for (const [title, expectedTitle] of titles) {
		const value = `[**Notes**](Notes.md ${title})`;
		await cell.click(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
		await page.keyboard.type(value, { delay: 15 });
		await page.keyboard.press('Backspace'); await page.keyboard.type(')'); await page.keyboard.press('Enter');
		await expect(cell.locator('a')).toHaveAttribute('title', expectedTitle);
		await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.replace('Seed', value));
		await expect(page.locator('.mlp-table td').last()).toHaveText('Retained');
	}
});
