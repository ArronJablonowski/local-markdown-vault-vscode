import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const objects = [
	['formatting', '<div>\n<strong>one</strong>\n<em>two</em>\n</div>', 'one two'],
	['table', '<table>\n<tr><th>Header</th></tr>\n<tr><td>Value &gt; limit</td></tr>\n</table>', 'Header Value > limit'],
	['disclosure', '<details open>\n<summary>Summary</summary>\n<p>Details</p>\n</details>', 'Summary Details'],
	['preformatted', '<pre>\nline one\nline two > threshold\n</pre>', 'line one line two > threshold'],
];
for (const editingMode of ['editing', 'locked'] as const) for (const context of ['plain', 'quote', 'nested quote', 'quoted list']) for (const [name, html, expected] of objects) {
	test(`${editingMode}: embedded ${name} HTML in ${context} preserves formatting without quote leakage`, async ({ page }) => {
		const requests: string[] = [];
		page.on('request', request => requests.push(request.url()));
		const original = 'Before\n\n![[Html]]\n\nAfter';
		await mountEditor(page, original, { editingMode,
			vaultNotes: [{ path: 'Html.md', basename: 'Html', aliases: [], headings: [], blockIds: [] }],
		});
		await expect.poll(() => page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed')?.requestId)).toBeTruthy();
		const requestId = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed').requestId);
		const lines = html.split('\n'); lines.splice(1, 0, '<img src="https://tracker.invalid/pixel" onerror="alert(1)">');
		const prefix = context === 'plain' ? '' : context === 'nested quote' ? '> > ' : '> ';
		const text = lines.map((line, index) => prefix + (context === 'quoted list' ? index === 0 ? '- ' : '  ' : '') + line).join('\n') + '\n\nAfter **markdown**\n\n| Owner |\n| --- |\n| *Alex* |';
		await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: 'Html.md', text });
		const root = page.locator('.mlp-wiki-embed-content');
		const rendered = root.locator('.mlp-embed-raw-html');
		await expect(rendered).toHaveCount(1);
		await expect.poll(async () => (await rendered.textContent())?.replace(/\s+/g, ' ').trim()).toBe(expected);
		await expect(rendered.locator('img, script, iframe')).toHaveCount(0);
		await expect(root.locator('p strong')).toHaveText('markdown');
		await expect(root.locator('.mlp-embed-table em')).toHaveText('Alex');
		expect(requests.some(url => url.includes('tracker.invalid'))).toBe(false);
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	});
}
