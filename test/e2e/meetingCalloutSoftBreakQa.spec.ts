import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
for (const [heading, prefix] of [['- > [!note]- Nested meeting', '  > '], ['> - > [!warning]- Nested meeting', '>   > ']]) {
	test(`heading soft break retains list and quote containers: ${heading}`, async ({ page }) => {
		await mountEditor(page, heading);
		await page.locator('.cm-content').focus();
		await page.keyboard.press(`${mod}+End`); await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('Visible meeting body');
		await expect.poll(() => page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString()))
			.toBe(heading + '\n' + prefix + 'Visible meeting body');
		await expect(page.locator('.cm-line', { hasText: 'Visible meeting body' })).toBeVisible();
	});
}
test('locked meeting headings ignore Shift+Enter', async ({ page }) => {
	const initial = '> [!note]- Locked meeting';
	await mountEditor(page, initial, { editingMode: 'locked' });
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+End`); await page.keyboard.press('Shift+Enter');
	expect(await page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString())).toBe(initial);
});
for (const marker of ['', '+', '-']) test(`Shift+Enter opens a meeting body from its ${marker || 'plain'} heading`, async ({ page }) => {
	const initial = `# Meetings\n\n> [!note]${marker} Planning`;
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await mountEditor(page, initial);
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+End`);
	await page.keyboard.press('Shift+Enter');
	for (const char of 'Discuss release timing.') await page.keyboard.type(char);
	await page.keyboard.press('Shift+Enter');
	for (const char of 'Confirm the owner.') await page.keyboard.type(char);
	const source = () => page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString());
	await expect.poll(source).toBe(initial + '\n> Discuss release timing.\n> Confirm the owner.');
	await expect(page.locator('.cm-line', { hasText: 'Confirm the owner.' })).toBeVisible();
	await expect(page.locator('.cm-line', { hasText: 'Confirm the owner.' })).toHaveClass(/mlp-callout/);
	expect(errors).toEqual([]);
});

for (const width of [520, 1100]) test(`three meeting sections support soft breaks, edits and objects at ${width}px`, async ({ page }, info) => {
	await page.setViewportSize({ width, height: 1000 });
	const initial = '# Meeting notes\n\n';
	await mountEditor(page, initial, { css: readFileSync(join(__dirname, '../../media/sample-styles/obsidian-dark.css'), 'utf8') });
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+End`);
	let expected = initial;
	for (const [title, type] of [['Planning', 'note'], ['Risk review', 'warning'], ['Retrospective', 'abstract']]) {
		const lines = [`> [!${type}]- ${title}`, 'Decisions and **important details**.', '', '- [ ] Confirm owner', '',
			'| Owner | Status |', '| --- | --- |', '| Alex | Pending |', '', 'Follow-up remains inside the meeting.'];
		for (let i = 0; i < lines.length; i++) {
			if (i) await page.keyboard.press('Shift+Enter');
			for (const char of lines[i]) await page.keyboard.type(char);
		}
		expected += lines.map((line, i) => i === 4 ? '>       ' : i ? '> ' + line : line).join('\n');
		await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
		expected += '\n\n';
	}
	const source = () => page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString());
	await expect.poll(source).toBe(expected);
	await expect(page.locator('.mlp-table')).toHaveCount(3);
	await expect(page.locator('.mlp-checkbox')).toHaveCount(3);
	await page.locator('.mlp-checkbox').nth(1).click();
	expected = expected.replace('> [!warning]- Risk review\n> Decisions and **important details**.\n> \n> - [ ]', '> [!warning]- Risk review\n> Decisions and **important details**.\n> \n> - [x]');
	await expect.poll(source).toBe(expected);
	for (const title of ['Planning', 'Risk review', 'Retrospective']) {
		const button = page.getByRole('button', { name: `${title} callout`, exact: true });
		await button.click(); await expect(button).toHaveAttribute('aria-expanded', 'false');
		await button.click(); await expect(button).toHaveAttribute('aria-expanded', 'true');
	}
	await expect(page.locator('.mlp-table')).toHaveCount(3);
	await page.screenshot({ path: info.outputPath('three-meetings.png'), fullPage: true });
});
