import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

test('table typing saves every character without blur, retains focus/geometry, and Escape restores the session', async ({ page }) => {
	const original = 'Intro\n\n| Owner | Status |\n| --- | --- |\n| Original | Preserve |\n\nAfter';
	await mountEditor(page, original);
	const cell = page.locator('.mlp-table td').first();
	await cell.click();
	const width = await cell.evaluate(el => el.getBoundingClientRect().width);
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
	let value = '';
	for (const char of 'Reviewed now') {
		await page.keyboard.type(char); value += char;
		await expect.poll(() => page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString()))
			.toBe(original.replace('Original', value.trim()));
		await expect(cell).toHaveText(value);
		await expect(cell).toBeFocused();
		expect(await cell.evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(width, 0);
	}
	await page.keyboard.press('Escape');
	await expect.poll(() => page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString())).toBe(original);
});

test('empty-cell replacement preserves pipe padding and literal pipes while saving live text', async ({ page }) => {
	const original = 'Intro\n\n| Owner | Status |\n| --- | --- |\n| Original | Preserve |\n\nAfter';
	await mountEditor(page, original);
	const cell = page.locator('.mlp-table td').first();
	await cell.click(); await cell.fill('');
	await expect.poll(() => page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString()))
		.toBe(original.replace('Original', ''));
	await page.keyboard.type('Restored | value');
	await expect(cell).toHaveText('Restored | value');
	await expect.poll(() => page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString()))
		.toBe(original.replace('Original', 'Restored \\| value'));
	await page.keyboard.press('Enter');
	await expect(cell).not.toHaveAttribute('contenteditable', 'true');
});

test('identical cell paste followed immediately by typing keeps every character in the live cell', async ({ page }) => {
	const original = 'Intro\n\n| Owner | Status |\n| --- | --- |\n| Reviewed now | Preserve |\n\nAfter';
	await mountEditor(page, original);
	const cell = page.locator('.mlp-table td').first();
	await cell.click(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
	await cell.evaluate(el => {
		const data = new DataTransfer(); data.setData('text/plain', 'Reviewed now');
		el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
	});
	await page.keyboard.type(' CLOSED');
	await expect(cell).toHaveText('Reviewed now CLOSED');
	await expect.poll(() => page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString()))
		.toBe(original.replace('Reviewed now', 'Reviewed now CLOSED'));
});
