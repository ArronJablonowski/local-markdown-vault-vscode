import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

for (const editingMode of ['editing', 'locked'] as const) for (const hex of [false, true]) for (const context of ['table', 'cell list', 'embedded paragraph', 'embedded quote', 'embedded list', 'embedded table']) {
	test(`${editingMode}: numeric reference compatibility, hex=${hex}, ${context}`, async ({ page }) => {
		const references = Array.from({ length: 32 }, (_, index) => hex ? `&#x${(128 + index).toString(16)};` : `&#${128 + index};`).join(' ');
		const payload = `**${references}** and [*${references}*](Notes.md)<br>\`${references}\` ![&#128; &#145;](https://tracker.invalid/x.png) &#60;img src=x onerror=alert(1)&#62;`;
		const cell = context === 'cell list' ? `<ul><li>${payload}</li><li>~~Retired~~</li></ul>` : payload;
		const table = `| Reference |\n| --- |\n| ${cell} |`;
		const embedded = context.startsWith('embedded');
		const original = embedded ? 'Before\n\n![[Characters]]\n\nAfter' : 'Before\n\n' + table + '\n\nAfter';
		const requests: string[] = [];
		page.on('request', request => requests.push(request.url()));
		await mountEditor(page, original, { editingMode,
			vaultNotes: [{ path: 'Characters.md', basename: 'Characters', aliases: [], headings: [], blockIds: [] }],
		});
		if (embedded) {
			await expect.poll(() => page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed')?.requestId)).toBeTruthy();
			const requestId = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed').requestId);
			const text = context === 'embedded table' ? table : (context === 'embedded quote' ? '> ' : context === 'embedded list' ? '- ' : '') + payload;
			await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: 'Characters.md', text });
		}
		// Independent browser reference: generated numeric tokens only, no user HTML.
		const expected = await page.evaluate(value => { const decoder = document.createElement('textarea'); decoder.innerHTML = value; return decoder.value; }, references);
		const root = page.locator(embedded ? '.mlp-wiki-embed-content' : '.mlp-table');
		await expect.poll(() => root.locator('strong').first().textContent()).toBe(expected);
		await expect.poll(() => root.locator('a em').textContent()).toBe(expected);
		await expect(root.locator('code')).toHaveText(references);
		await expect(root.locator('img')).toHaveCount(1);
		await expect(root.locator('img')).toHaveAttribute('alt', '\u20ac \u2018');
		await expect(root.locator('img')).not.toHaveAttribute('src');
		await expect(root.locator('img')).not.toHaveAttribute('onerror');
		expect(await root.textContent()).toContain('<img src=x onerror=alert(1)>');
		expect(requests.some(url => url.includes('tracker.invalid'))).toBe(false);
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	});
}
