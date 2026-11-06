import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const cases = [
	['definition', '[label]: Notes.md'], ['image definition', '![label]: chart.png'],
	['link label', '[    **label** and *detail*](Notes.md)'],
	['image label', '![    **label**](https://tracker.invalid/x.png)'],
];
for (const editingMode of ['editing', 'locked'] as const) for (const context of ['table', 'cell list', 'embedded table']) for (const [name, value] of cases) {
	test(`${editingMode}: inline ${name} in ${context} is not reclassified as a block`, async ({ page }) => {
		const payload = context === 'cell list' ? `<ul><li>${value}</li><li>*Review*</li></ul>` : value;
		const table = `| Value | Neighbor |\n| --- | --- |\n| ${payload} | ~~Retained~~ |`;
		const embedded = context === 'embedded table';
		const original = embedded ? 'Before\n\n![[Inline]]\n\nAfter' : 'Before\n\n' + table + '\n\nAfter';
		await mountEditor(page, original, { editingMode,
			vaultNotes: [{ path: 'Inline.md', basename: 'Inline', aliases: [], headings: [], blockIds: [] }],
		});
		if (embedded) {
			await expect.poll(() => page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed')?.requestId)).toBeTruthy();
			const requestId = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed').requestId);
			await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: 'Inline.md', text: '> ' + table.split('\n').join('\n> ') + '\n\n```text\nreal block\n```' });
		}
		const root = page.locator('.mlp-table');
		if (name.includes('definition')) {
			await expect(root.locator('td').first()).toContainText(value);
			await expect(root.locator('a, img')).toHaveCount(0);
		} else if (name === 'link label') {
			await expect(root.locator('a')).toHaveAttribute('data-href', 'Notes.md');
			await expect(root.locator('a strong')).toHaveText('label');
			await expect(root.locator('a em')).toHaveText('detail');
		} else { await expect(root.locator('img')).toHaveAttribute('alt', 'label'); await expect(root.locator('img')).not.toHaveAttribute('src'); }
		await expect(root.locator('td').last().locator('del')).toHaveText('Retained');
		if (embedded) await expect(page.locator('.mlp-wiki-embed-content pre code')).toHaveText('real block');
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	});
}

test('definition-like text remains visible through per-key table commits', async ({ page }) => {
	const original = 'Before\n\n| Value | Neighbor |\n| --- | --- |\n| Seed | Retained |\n\nAfter';
	await mountEditor(page, original);
	const cell = page.locator('.mlp-table td').first();
	let value = '';
	for (const chunk of ['[', 'l', 'a', 'b', 'e', 'l', ']', ':', ' N', 'o', 't', 'e', 's', '.', 'm', 'd']) {
		await cell.click(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
		if (value) await page.keyboard.press('ArrowRight');
		await page.keyboard.type(chunk, { delay: 20 }); value += chunk; await page.keyboard.press('Enter');
		await expect(cell).toHaveText(value);
		await expect(cell.locator('a')).toHaveCount(0);
		await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.replace('Seed', value));
	}
});
