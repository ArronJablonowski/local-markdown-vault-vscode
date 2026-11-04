import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const initial = 'Before\n\n```text\nFIRST\n```\n\nAfter';
for (const editingMode of ['editing', 'locked'] as const) for (const change of ['same-length', 'longer', 'moved', 'removed-and-restored']) test(`${editingMode}: pending copy survives ${change} external source changes without stale clipboard confirmation`, async ({ page }) => {
	await mountEditor(page, initial, { editingMode });
	const request = () => page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'copyCode').at(-1));
	await page.locator('.mlp-copy-code-btn').click();
	const first = await request();
	expect(first.text).toBe('FIRST');
	const code = change === 'same-length' ? 'LATER' : 'Updated code 😀\nSecond line';
	const updated = (change === 'moved' ? 'Additional introductory paragraph.\n\n' : '') + `Before\n\n~~~text\n${code}\n~~~\n\nAfter`;
	let baseline = initial, version = 1;
	if (change === 'removed-and-restored') {
		baseline = 'No code remains';
		await postToWebview(page, { type: 'externalUpdate', version: version++, changes: [{ from: 0, to: initial.length, insert: baseline }] });
		await expect(page.locator('.mlp-copy-code-btn')).toHaveCount(0);
	}
	await postToWebview(page, { type: 'externalUpdate', version, changes: [{ from: 0, to: baseline.length, insert: updated }] });
	await expect(page.locator('.mlp-copy-code-btn')).toBeVisible();
	await postToWebview(page, { type: 'copyCodeResult', requestId: first.requestId, ok: false });
	await page.locator('.mlp-copy-code-btn').click();
	const second = await request();
	expect(second.requestId).not.toBe(first.requestId);
	expect(second.text).toBe(code);
	await postToWebview(page, { type: 'copyCodeResult', requestId: first.requestId, ok: true });
	await expect(page.locator('.mlp-copy-code-btn')).not.toHaveClass(/mlp-copy-code-btn-done/);
	await postToWebview(page, { type: 'copyCodeResult', requestId: second.requestId, ok: true });
	await expect(page.locator('.mlp-copy-code-btn')).toHaveClass(/mlp-copy-code-btn-done/);
	expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(updated);
	expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
});
