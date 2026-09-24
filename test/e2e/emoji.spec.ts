import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

test('emoji menu stays open during background vault refreshes and accepts a mouse click', async ({ page }) => {
	await mountEditor(page, 'Emoji test\n\n');
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.type(':s', { delay: 120 });
	const option = page.getByRole('option', { name: /:smile:/ });
	await expect(option).toBeVisible();
	for (const type of ['vaultNotes', 'vaultNotesChunk', 'invalidateDrawioFiles']) {
		await postToWebview(page, type === 'vaultNotesChunk'
			? { type, generation: 1, offset: 0, total: 0, notes: [] }
			: type === 'vaultNotes' ? { type, notes: [] } : { type });
		await page.waitForTimeout(500);
		await expect(option).toBeVisible();
	}
	await option.click();
	await expect(page.locator('.cm-content')).toContainText('😄');
	await expect(page.locator('.cm-content')).not.toContainText(':s');
});

test('emoji completion inserts real Unicode and sends edits and undo to the host', async ({ page }) => {
	await mountEditor(page, 'Emoji test\n\n');
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.type(':smile');
	await expect(page.getByRole('option', { name: /:smile:/ })).toBeVisible();
	// CodeMirror intentionally ignores acceptance keys during the menu's first
	// 75 ms so ordinary typing cannot accidentally accept a fresh suggestion.
	await page.waitForTimeout(100);
	await page.keyboard.press('Enter');
	await expect(page.locator('.cm-content')).toContainText('😄');
	await expect(page.locator('.cm-content')).not.toContainText(':smile');
	await page.keyboard.press('ControlOrMeta+z');
	const messages = await page.evaluate(() => (window as unknown as { __posted: Array<{ type: string; changes?: Array<{ insert: string }> }> }).__posted);
	expect(messages.some(message => message.type === 'edit' && message.changes?.some(change => change.insert.includes('😄')))).toBe(true);
	await expect.poll(() => page.evaluate(() => (window as unknown as { __posted: Array<{ type: string }> }).__posted.some(message => message.type === 'undo'))).toBe(true);
});

test('Unicode emoji survive rendering in Markdown objects', async ({ page }) => {
	await mountEditor(page, '# Emoji 👩🏽‍💻\n\n- [ ] Review ✅\n- Family 👨‍👩‍👧‍👦\n\n> [!note] Hello 🌍\n> Flags 🇺🇸 and hearts ❤️\n\n| Emoji | Meaning |\n| --- | --- |\n| 👍🏽 | Approved |\n\n```text\n😄 literal :smile:\n```\n\nAfter');
	await expect(page.locator('.cm-content')).toContainText('👩🏽‍💻');
	await expect(page.locator('.cm-content')).toContainText('👨‍👩‍👧‍👦');
	await expect(page.locator('.mlp-table td').first()).toHaveText('👍🏽');
	await expect(page.locator('.cm-content')).toContainText('😄 literal :smile:');
	await page.locator('.mlp-checkbox').click();
	await expect(page.locator('.cm-content')).toContainText('Review ✅');
});
