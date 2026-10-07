import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

for (const width of [480, 1100]) test(`literal code backticks survive meeting-note revisions at ${width}px`, async ({ page }) => {
	await page.setViewportSize({ width, height: 720 });
	const initial = '# Revised implementation\n\n```javascript\nconst label = ;\n```\n\nNext decision.';
	await mountEditor(page, initial);
	const editor = page.locator('.cm-content');
	await editor.focus();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Home' : 'Control+Home');
	for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
	await page.keyboard.press('End');
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.type('`', { delay: 25 });
	await expect.poll(() => editor.evaluate(el => (el as any).cmTile.root.view.state.doc.toString())).toBe(initial.replace('= ;', '= `;'));
	await page.keyboard.type('pilot`', { delay: 25 });
	await expect.poll(() => editor.evaluate(el => (el as any).cmTile.root.view.state.doc.toString())).toBe(initial.replace('= ;', '= `pilot`;'));
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('Backspace');
	await page.keyboard.type('t', { delay: 25 });
	await expect.poll(() => editor.evaluate(el => (el as any).cmTile.root.view.state.doc.toString())).toBe(initial.replace('= ;', '= `pilot`;'));
});

test('End moves past a trailing rendered tag before appending a decision', async ({ page }) => {
	const initial = '# Meeting\n\nDiscussion: **ownership** remains open. #meeting/session';
	await mountEditor(page, initial);
	await page.locator('.cm-content').focus();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Home' : 'Control+Home');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('End');
	await page.keyboard.type(' Revised.', { delay: 25 });
	await expect.poll(() => page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString())).toBe(initial + ' Revised.');
});

test('typing a backtick replaces selected fenced code without Markdown wrapping', async ({ page }) => {
	const initial = '```text\nreplace\n```';
	await mountEditor(page, initial);
	await page.locator('.cm-content').focus();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Home' : 'Control+Home');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Home');
	for (let i = 0; i < 7; i++) await page.keyboard.press('Shift+ArrowRight');
	await page.keyboard.type('`');
	await expect.poll(() => page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString())).toBe('```text\n`\n```');
});
