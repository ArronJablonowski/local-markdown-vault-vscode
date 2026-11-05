import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const references = [
	['[missing]', '[missing]', '[missing](Notes.md)', false],
	['[**label**][missing]', '[label][missing]', '[**label**](Notes.md)', false],
	['![*label*][missing]', '![label][missing]', '![*label*](https://tracker.invalid/x.png)', true],
] as const;
for (const editingMode of ['editing', 'locked'] as const) for (const context of ['table', 'cell list', 'embedded quote', 'embedded table']) for (const [reference, displayed, replacement, image] of references) {
	test(`${editingMode}: unresolved ${reference} in ${context} preserves source-like text`, async ({ page }) => {
		const payload = `Reference ${reference} and \`[literal]\` ~~retired~~`;
		const cell = context === 'cell list' ? `<ul><li>${payload}</li><li>*Review*</li></ul>` : payload;
		const table = `| Reference |\n| --- |\n| ${cell} |`;
		const embedded = context.startsWith('embedded');
		const original = embedded ? 'Before\n\n![[References]]\n\nAfter' : 'Before\n\n' + table + '\n\nAfter';
		await mountEditor(page, original, { editingMode,
			vaultNotes: [{ path: 'References.md', basename: 'References', aliases: [], headings: [], blockIds: [] }],
		});
		if (embedded) {
			await expect.poll(() => page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed')?.requestId)).toBeTruthy();
			const requestId = await page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'readWikiEmbed').requestId);
			await postToWebview(page, { type: 'wikiEmbed', requestId, sourcePath: 'References.md', text: context === 'embedded table' ? table : '> ' + payload });
		}
		const root = page.locator(embedded ? '.mlp-wiki-embed-content' : '.mlp-table');
		await expect(root).toContainText(displayed);
		await expect(root.locator('a, img')).toHaveCount(0);
		await expect(root.locator('code')).toHaveText('[literal]');
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'resolveLocalImage'))).toEqual([]);
		if (!embedded) {
			const at = original.indexOf(reference);
			await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: at, to: at + reference.length, insert: replacement }] });
			if (image) { await expect(root.locator('img')).toHaveAttribute('alt', 'label'); await expect(root.locator('img')).not.toHaveAttribute('src'); }
			else await expect(root.locator('a')).toHaveAttribute('data-href', 'Notes.md');
			expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.replace(reference, replacement));
		} else expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	});
}
