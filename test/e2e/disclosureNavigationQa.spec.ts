import { expect, test } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const html = '<div><details><summary>Meeting evidence</summary><p>Outer evidence</p><details><summary>Nested evidence</summary><p>Inner evidence</p></details></details></div>';
const source = (page: import('@playwright/test').Page) => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString());

test('native default-summary disclosure also survives rapid scroll without rewriting source', async ({ page }) => {
	const text = '# Notes\n\n<div><details><p>Evidence without an explicit summary</p></details></div>\n\n' + 'Retained paragraph.\n\n'.repeat(250) + 'After';
	await mountEditor(page, text);
	await page.locator('.mlp-safe-html details').click({ position: { x: 20, y: 8 } });
	await expect(page.locator('.mlp-safe-html details')).toHaveJSProperty('open', true);
	await page.locator('.cm-content').focus(); await page.keyboard.press(`${mod}+End`); await page.keyboard.press(`${mod}+Home`);
	await expect(page.locator('.mlp-safe-html details')).toHaveJSProperty('open', true);
	expect(await source(page)).toBe(text);
});

for (const editingMode of ['editing', 'locked'] as const) test(`${editingMode}: repeated nested disclosure activation stays local through palette and viewport changes`, async ({ page }) => {
	const text = '# Notes\n\n' + html + '\n\nAfter';
	await mountEditor(page, text, { editingMode });
	await page.locator('.mlp-safe-html summary').first().focus(); await page.keyboard.press('Enter');
	for (let i = 0; i < 5; i++) {
		await page.locator('.mlp-safe-html summary').nth(1).focus(); await page.keyboard.press('Space');
		await postToWebview(page, { type: 'applyCss', css: `.mlp-safe-html { font-size: ${14 + i}px; }` });
		await page.setViewportSize({ width: i % 2 ? 460 : 1200, height: 700 });
		await expect(page.locator('.mlp-safe-html details').nth(1)).toHaveJSProperty('open', i % 2 === 0);
	}
	await page.getByRole('button', { name: 'Switch to code mode' }).click();
	await page.keyboard.press(`${mod}+End`);
	await expect(page.locator('.mlp-safe-html details[open]')).toHaveCount(2);
	expect(await source(page)).toBe(text);
	expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
});

test('disclosure snapshots follow source shifts before eviction and do not reopen deliberately closed children', async ({ page }) => {
	const text = '# Notes\n\n' + html + '\n\n' + 'Retained paragraph.\n\n'.repeat(300) + 'After';
	await mountEditor(page, text);
	await page.locator('.mlp-safe-html summary').first().click();
	await page.locator('.mlp-safe-html summary').nth(1).click();
	await page.locator('.mlp-safe-html summary').nth(1).click();
	await page.locator('.cm-line').first().click(); await page.keyboard.press('End'); await page.keyboard.type(' revised');
	await page.keyboard.press(`${mod}+End`); await page.keyboard.press(`${mod}+Home`);
	await expect(page.locator('.mlp-safe-html details').first()).toHaveJSProperty('open', true);
	await expect(page.locator('.mlp-safe-html details').nth(1)).toHaveJSProperty('open', false);
	expect(await source(page)).toBe(text.replace('# Notes', '# Notes revised'));
});

test('nested HTML disclosures retain independent state after viewport eviction and return', async ({ page }) => {
	const text = '# Notes\n\n' + html + '\n\n' + Array.from({ length: 250 }, (_, i) => `Paragraph ${i} with **retained** meeting context.\n\n`).join('') + 'End sentinel';
	await mountEditor(page, text);
	await page.locator('.mlp-safe-html summary').first().click();
	await page.locator('.mlp-safe-html summary').nth(1).click();
	await page.locator('.cm-content').focus(); await page.keyboard.press(`${mod}+End`);
	await expect(page.locator('.cm-content')).toContainText('End sentinel');
	await expect(page.locator('.mlp-safe-html')).toHaveCount(0);
	await page.keyboard.press(`${mod}+Home`);
	await expect(page.locator('.mlp-safe-html details[open]')).toHaveCount(2);
	expect(await source(page)).toBe(text);
});

test('keyboard activation of nested disclosures survives resize and source reveal', async ({ page }) => {
	const text = '# Notes\n\n' + html + '\n\nAfter';
	await mountEditor(page, text);
	await page.locator('.mlp-safe-html summary').first().focus();
	await page.keyboard.press('Enter');
	await expect(page.locator('.mlp-safe-html details').first()).toHaveAttribute('open', '');
	await page.keyboard.press('Tab'); await page.keyboard.press('Space');
	await expect(page.locator('.mlp-safe-html details[open]')).toHaveCount(2);
	for (const width of [380, 1440, 580]) {
		await page.setViewportSize({ width, height: 600 });
		await expect(page.locator('.mlp-safe-html details[open]')).toHaveCount(2);
	}
	await page.getByRole('button', { name: 'Switch to code mode' }).click();
	await page.keyboard.press(`${mod}+End`);
	await expect(page.locator('.mlp-safe-html details[open]')).toHaveCount(2);
	expect(await source(page)).toBe(text);
});
