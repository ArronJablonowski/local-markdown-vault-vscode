import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

test('continuous typing is sent before typing stops', async ({ page }) => {
	await mountEditor(page, 'Start ');
	await page.locator('.cm-content').click();
	await page.keyboard.press('End');
	const typing = page.keyboard.type('abcdefghijklmnopqrstuvwxyz', { delay: 40 });
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'edit').length)).toBeGreaterThan(2);
	await typing;
	await expect(page.locator('.cm-content')).toContainText('Start abcdefghijklmnopqrstuvwxyz');
});

test('slow host acknowledgment queues edits in order and delays undo until all edits arrive', async ({ page }) => {
	await mountEditor(page, 'Start ');
	await page.evaluate(() => { (window as any).__holdEditAck = true; });
	await page.locator('.cm-content').click();
	await page.keyboard.press('End');
	await page.keyboard.type('A');
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'edit').length)).toBe(1);
	await page.keyboard.type('BC');
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
	let messages = await page.evaluate(() => (window as any).__posted);
	expect(messages.filter((m: any) => m.type === 'edit')).toHaveLength(1);
	expect(messages.filter((m: any) => m.type === 'undo')).toHaveLength(0);
	await postToWebview(page, { type: 'ackEdit', version: 2 });
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'edit').length)).toBe(2);
	messages = await page.evaluate(() => (window as any).__posted);
	const edits = messages.filter((m: any) => m.type === 'edit');
	expect(edits[1].baseVersion).toBe(2);
	expect(edits[1].changes.map((c: any) => c.insert).join('')).toBe('BC');
	await postToWebview(page, { type: 'ackEdit', version: 3 });
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'undo').length)).toBe(1);
});

test('valid property edits commit when clicking away instead of being discarded', async ({ page }) => {
	await mountEditor(page, '---\ntitle: Before\n---\n\nBody');
	await page.locator('.mlp-frontmatter tr', { hasText: 'title' }).locator('td').focus();
	await page.keyboard.press('Enter');
	await page.locator('.mlp-property-input').fill('After');
	await page.locator('.cm-line', { hasText: 'Body' }).click();
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'edit').map((m: any) => JSON.stringify(m)).join(''))).toContain('After');
});

test('background vault refresh cannot interrupt a table cell draft', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n| Name | Value |\n| --- | --- |\n| Alpha | Bold |\n\nAfter');
	const cell = page.locator('.mlp-table td').first();
	await cell.focus();
	await page.keyboard.press('F2');
	await page.keyboard.type('Up');
	await postToWebview(page, { type: 'vaultNotes', notes: [] });
	await expect(cell).toBeFocused();
	await page.keyboard.type('dated');
	await page.keyboard.press('Enter');
	await expect(page.locator('.mlp-table td').first()).toHaveText('Updated');
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'edit').map((m: any) => JSON.stringify(m)).join(''))).toContain('Updated');
});
