import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

for (const editingMode of ['editing', 'locked'] as const) for (const failure of ['rejected', 'timeout', 'success']) for (const retrySucceeds of [false, true]) test(`${editingMode}: code-copy ${failure} retry retains fresh feedback, success=${retrySucceeds}`, async ({ page }) => {
	await page.clock.install();
	const original = 'Before\n\n```text\nRetain every character 😀\n```\n\nAfter';
	await mountEditor(page, original, { editingMode });
	const button = page.locator('.mlp-copy-code-btn');
	const request = () => page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'copyCode').at(-1));
	await button.click();
	const first = await request();
	if (failure !== 'timeout') await postToWebview(page, { type: 'copyCodeResult', requestId: first.requestId, ok: failure === 'success' });
	else await page.clock.runFor(5001);
	await expect(button).toHaveClass(failure === 'success' ? /mlp-copy-code-btn-done/ : /mlp-copy-code-btn-failed/);
	await page.clock.runFor(1000);
	await button.click();
	const second = await request();
	expect(second.requestId).not.toBe(first.requestId);
	expect(second.text).toBe('Retain every character 😀');
	// A late success for the old request cannot confirm this new attempt.
	await postToWebview(page, { type: 'copyCodeResult', requestId: first.requestId, ok: true });
	await postToWebview(page, { type: 'copyCodeResult', requestId: second.requestId, ok: retrySucceeds });
	const feedback = retrySucceeds ? /mlp-copy-code-btn-done/ : /mlp-copy-code-btn-failed/;
	await expect(button).toHaveClass(feedback);
	await page.clock.runFor(300);
	await expect(button).toHaveClass(feedback);
	await page.clock.runFor(1000);
	await expect(button).not.toHaveClass(/mlp-copy-code-btn-(?:done|failed)/);
	expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
});
