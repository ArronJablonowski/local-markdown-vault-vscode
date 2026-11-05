import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

for (const editingMode of ['editing', 'locked'] as const) for (const depth of [0, 1, 2]) for (const endings of ['LF', 'CRLF', 'CR', 'mixed']) {
	test(`${editingMode}: ${endings} embedded mixed formatting at quote depth ${depth}`, async ({ page }) => {
		const original = 'Before\n\n![[Imported]]\n\nAfter';
		await mountEditor(page, original, { editingMode,
			vaultNotes: [{ path: 'Imported.md', basename: 'Imported', aliases: [], headings: [], blockIds: [] }],
		});
		await expect.poll(() => page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed')?.requestId)).toBeTruthy();
		const requestId = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed').requestId);
		const lines = ['**Meeting**', '===', '', '3. **Agenda**', '   - [x] **Done**', '',
			'first  ', 'second *italic*', '', '| Owner | Code |', '| :--- | ---: |', '| *Alex* | `x\\|y` |', '',
			'```js', 'const marker = "\\r";', 'const value = 2;', '```'];
		// Avoid CR immediately followed by an empty LF line: those two bytes
		// constitute one CRLF terminator, not the intended paragraph separator.
		const delimiters = endings === 'mixed' ? ['\r', '\r\n', '\n'] : [endings === 'LF' ? '\n' : endings === 'CRLF' ? '\r\n' : '\r'];
		const text = lines.map((line, index) => '> '.repeat(depth) + line + (index === lines.length - 1 ? '' : delimiters[index % delimiters.length])).join('');
		await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: 'Imported.md', text });
		const embed = page.locator('.mlp-wiki-embed-content');
		await expect(embed.locator('h1 strong')).toHaveText('Meeting');
		await expect(embed.locator('ol')).toHaveAttribute('start', '3');
		await expect(embed.getByRole('checkbox', { name: 'Done', exact: true })).toBeChecked();
		await expect(embed.locator('p br')).toHaveCount(1);
		await expect(embed.locator('table tbody td')).toHaveText(['Alex', 'x|y']);
		await expect(embed.locator('table tbody td').last()).toHaveCSS('text-align', 'right');
		await expect.poll(() => embed.locator('pre code').textContent()).toBe('const marker = "\\r";\nconst value = 2;');
		expect(await embed.textContent()).not.toContain('\r');
		await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: 0, to: 6, insert: 'Revised' }] });
		await expect(page.locator('.mlp-wiki-embed-content table tbody td')).toHaveText(['Alex', 'x|y']);
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.replace('Before', 'Revised'));
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	});
}
