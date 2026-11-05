import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const code = 'first **literal**\n\nlast <br> `literal`';
const cases = [
	['quoted fence', '> ```js\n' + code.split('\n').map(line => '> ' + line).join('\n') + '\n> ```'],
	['nested quote fence', '> > ~~~text\n' + code.split('\n').map(line => '> > ' + line).join('\n') + '\n> > ~~~'],
	['bullet fence', '- ```js\n' + code.split('\n').map(line => '  ' + line).join('\n') + '\n  ```'],
	['numbered fence', '3. ```js\n' + code.split('\n').map(line => '   ' + line).join('\n') + '\n   ```'],
	['indented code', code.split('\n').map(line => '    ' + line).join('\n')],
	['quoted indented code', code.split('\n').map(line => '>     ' + line).join('\n')],
];
for (const editingMode of ['editing', 'locked'] as const) for (const [name, block] of cases) {
	test(`${editingMode}: embedded ${name} retains all literal lines beside formatted objects`, async ({ page }) => {
		const original = 'Before\n\n![[Container]]\n\nAfter';
		await mountEditor(page, original, { editingMode,
			vaultNotes: [{ path: 'Container.md', basename: 'Container', aliases: [], headings: [], blockIds: [] }],
		});
		await expect.poll(() => page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed')?.requestId)).toBeTruthy();
		const requestId = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed').requestId);
		await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: 'Container.md', text: '# **Meeting**\n\n' + block + '\n\nAfter **code**\n\n| Owner |\n| --- |\n| *Alex* |' });
		const rendered = page.locator('.mlp-wiki-embed-content pre code');
		await expect(rendered).toHaveCount(1);
		await expect.poll(() => rendered.textContent()).toBe(code);
		await expect(rendered.locator('strong, em, br')).toHaveCount(0);
		await expect(page.locator('.mlp-embed-table tbody em')).toHaveText('Alex');
		await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: 0, to: 6, insert: 'Revised' }] });
		await expect.poll(() => page.locator('.mlp-wiki-embed-content pre code').textContent()).toBe(code);
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.replace('Before', 'Revised'));
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	});
}
