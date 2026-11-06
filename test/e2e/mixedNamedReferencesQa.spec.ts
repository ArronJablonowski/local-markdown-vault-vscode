import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const cases = [
	['formatted', '**A &amp; B** &copy; &NotEqualTilde;', 'A & B © ≂̸'],
	['inert', '&lt;img src=x onerror=alert(1)&gt; &amp;copy;', '<img src=x onerror=alert(1)> &copy;'],
	['literal', '`&copy;` \\&copy; &unknown;', '&copy; &copy; &unknown;'],
];
for (const editingMode of ['editing', 'locked'] as const) for (const embedded of [false, true]) for (const context of ['cell', 'list', 'link', 'image']) for (const [name, value, expected] of cases) {
	test(`${editingMode}: ${name} references in ${embedded ? 'embedded' : 'local'} ${context}`, async ({ page }) => {
		const payload = context === 'list' ? `<ul><li>${value}</li></ul>` : context === 'link' ? `[${value}](Notes.md)` : context === 'image' ? `![${value}](https://tracker.invalid/x.png)` : value;
		const table = `| Value | Neighbor |\n| --- | --- |\n| ${payload} | ~~Retained~~ |`;
		const original = embedded ? 'Before\n\n![[References]]\n\nAfter' : 'Before\n\n' + table + '\n\nAfter';
		const requests: string[] = [];
		page.on('request', request => { if (request.url().includes('tracker.invalid')) requests.push(request.url()); });
		await mountEditor(page, original, { editingMode, vaultNotes: [{ path: 'References.md', basename: 'References', aliases: [], headings: [], blockIds: [] }] });
		if (embedded) {
			await expect.poll(() => page.evaluate(() => (window as any).__posted.find((m: any) => m.type === 'readWikiEmbed')?.requestId)).toBeTruthy();
			const requestId = await page.evaluate(() => (window as any).__posted.find((m: any) => m.type === 'readWikiEmbed').requestId);
			await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: 'References.md', text: '> ' + table.split('\n').join('\n> ') });
		}
		const cell = page.locator('.mlp-table td').first();
		if (context === 'image') {
			await expect(cell.locator('img')).toHaveAttribute('alt', expected);
			await expect(cell.locator('img')).not.toHaveAttribute('src');
		} else {
			await expect(cell).toHaveText(expected);
			await expect(cell.locator('img')).toHaveCount(0);
			if (name === 'formatted') await expect(cell.locator('strong')).toHaveText('A & B');
			if (name === 'literal') await expect(cell.locator('code')).toHaveText('&copy;');
			if (context === 'link') await expect(cell.locator('a')).toHaveAttribute('data-href', 'Notes.md');
		}
		await expect(page.locator('.mlp-table td').last().locator('del')).toHaveText('Retained');
		expect(requests).toEqual([]);
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
		expect(await page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'edit'))).toEqual([]);
	});
}

test('typing, correcting, and deleting references inside a callout table preserves source', async ({ page }) => {
	const original = 'Before\n\n> [!note] Meeting\n>\n> | Value | Next |\n> | --- | --- |\n> | Seed | Retained |\n\nAfter';
	await mountEditor(page, original);
	const cell = page.locator('.mlp-table td').first();
	const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
	for (const value of ['**A &amp; B**', '&copy;', '&cop;', '&copy;', '&lt;img&gt;', '&amp;copy;', 'Final']) {
		await cell.click(); await page.keyboard.press(`${modifier}+a`);
		await page.keyboard.type(value, { delay: 25 });
		await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Backspace');
		await page.keyboard.type(value.at(-2)!); await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Enter');
		await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.replace('Seed', value));
		await expect(cell.locator('img')).toHaveCount(0);
	}
});
