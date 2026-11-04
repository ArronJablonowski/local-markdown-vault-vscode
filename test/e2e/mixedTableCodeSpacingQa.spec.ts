import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

for (const editingMode of ['editing', 'locked'] as const) for (const callout of [false, true]) {
	test(`${editingMode}: mixed table code padding and literal markup, callout=${callout}`, async ({ page }) => {
		const table = '| Format | Value |\n| --- | --- |\n| Bold | **` padded `** |\n| Link | [` link `](Notes.md) |\n| Backticks | `` `literal` `` |\n| Spaces | `  ` |\n| Literal | ` <br> **literal** ` |';
		const original = 'Before\n\n' + (callout ? '> [!note] Mixed formats\n>\n' + table.split('\n').map(line => '> ' + line).join('\n') : table) + '\n\nAfter';
		await mountEditor(page, original, { editingMode });
		const codes = page.locator('.mlp-table tbody code');
		await expect(codes).toHaveText(['padded', 'link', '`literal`', '  ', '<br> **literal**'], { useInnerText: false });
		await expect(page.locator('.mlp-table tbody strong code')).toHaveText('padded');
		await expect(page.locator('.mlp-table tbody a code')).toHaveText('link');
		await expect(page.locator('.mlp-table tbody code br')).toHaveCount(0);
		const start = original.indexOf('padded');
		await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: start, to: start + 6, insert: 'revised' }] });
		await expect(codes.first()).toHaveText('revised');
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.replace('padded', 'revised'));
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	});
}
