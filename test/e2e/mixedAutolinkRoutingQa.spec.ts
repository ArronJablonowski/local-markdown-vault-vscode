import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const links = [
	['<qa@example.invalid>', 'qa@example.invalid', 'mailto:qa@example.invalid'],
	['qa@example.invalid', 'qa@example.invalid', 'mailto:qa@example.invalid'],
	['www.example.invalid/path', 'www.example.invalid/path', 'https://www.example.invalid/path'],
];
for (const editingMode of ['editing', 'locked'] as const) for (const context of ['table', 'cell list', 'embedded quote', 'embedded table']) for (const [source, label, href] of links) {
	test(`${editingMode}: ${source} routes correctly in mixed ${context}`, async ({ page }) => {
		const inline = `**${source}** and \`literal@example.invalid\` with ~~retired~~`;
		const cell = context === 'cell list' ? `<ul><li>${inline}</li><li>*Review*</li></ul>` : inline;
		const table = `| Reference |\n| --- |\n| ${cell} |`;
		const embedded = context.startsWith('embedded');
		const original = embedded ? 'Before\n\n![[Links]]\n\nAfter' : 'Before\n\n' + table + '\n\nAfter';
		await mountEditor(page, original, { editingMode,
			vaultNotes: [{ path: 'Links.md', basename: 'Links', aliases: [], headings: [], blockIds: [] }],
		});
		if (embedded) {
			await expect.poll(() => page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed')?.requestId)).toBeTruthy();
			const requestId = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed').requestId);
			await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: 'Links.md', text:
				context === 'embedded table' ? table : '> ' + inline + '\n\n- [x] **Reviewed**' });
		}
		const root = page.locator(embedded ? '.mlp-wiki-embed-content' : '.mlp-table');
		const link = root.getByRole('link', { name: label, exact: true });
		await expect(link).toHaveAttribute('data-href', href);
		await expect(link).not.toHaveAttribute('href');
		await expect(root.locator('code')).toHaveText('literal@example.invalid');
		await expect(root.locator('code a')).toHaveCount(0);
		await link.focus(); await page.keyboard.press('Enter');
		await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'openLink').map((message: any) => message.href))).toEqual([href]);
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	});
}
