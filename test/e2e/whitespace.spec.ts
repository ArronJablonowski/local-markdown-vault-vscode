import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

for (const mode of ['editing', 'locked'] as const) {
	test(`whitespace markers default off and toggle without editing or polluting copy in ${mode} mode`, async ({ page }) => {
		const text = 'First two words\n\nLast\tline';
		await mountEditor(page, text, { editingMode: mode });
		const editor = page.locator('.cm-editor');
		await expect(editor).not.toHaveClass(/mlp-show-whitespace/);
		await expect(page.locator('.cm-highlightSpace')).toHaveCount(0);
		for (const enabled of [true, false, true, false]) {
			await page.evaluate(enabled => window.dispatchEvent(new MessageEvent('message', { data: { type: 'setWhitespace', enabled } })), enabled);
			await expect.poll(() => editor.evaluate(e => e.classList.contains('mlp-show-whitespace'))).toBe(enabled);
			await expect(page.locator('.cm-highlightSpace')).toHaveCount(enabled ? 2 : 0);
			const marker = await page.locator('.cm-line').first().evaluate(e => getComputedStyle(e, '::after').content);
			expect(marker).toBe(enabled ? '"↵"' : 'none');
			expect(await page.locator('.cm-line').last().evaluate(e => getComputedStyle(e, '::after').content)).toBe('none');
			await expect(page.locator('.cm-highlightTab')).toHaveCount(enabled ? 1 : 0);
			if (enabled) await expect(page.locator('.cm-highlightTab')).toHaveCSS('background-image', 'none');
			await page.locator('.cm-content').focus();
			await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
			await expect.poll(() => page.evaluate(() => {
				const data = new DataTransfer();
				document.querySelector('.cm-content')?.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
				return data.getData('text/plain');
			})).toBe(text);
		}
		const edits = await page.evaluate(() => (window as unknown as { __posted: Array<{ type: string }> }).__posted.filter(m => m.type === 'edit'));
		expect(edits).toEqual([]);
	});
}
