import { expect, test, type Page } from '@playwright/test';
import { mountEditor } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function dispatchClipboard(page: Page, type: 'copy' | 'cut' | 'paste', text = ''): Promise<string> {
	return page.evaluate(({ eventType, supplied }) => {
		const transfer = new DataTransfer();
		if (eventType === 'paste') transfer.setData('text/plain', supplied);
		const event = new ClipboardEvent(eventType, {
			bubbles: true,
			cancelable: true,
			clipboardData: transfer,
		});
		document.querySelector('.cm-content')?.dispatchEvent(event);
		return transfer.getData('text/plain');
	}, { eventType: type, supplied: text });
}

async function source(page: Page): Promise<string> {
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+a`);
	return dispatchClipboard(page, 'copy');
}

test.describe('Obsidian interaction parity', () => {
	test('copies and cuts the current Markdown line when there is no selection', async ({ page }) => {
		await mountEditor(page, 'Alpha\nBravo\nCharlie');
		await page.locator('.cm-line').nth(1).click();

		expect(await dispatchClipboard(page, 'copy')).toBe('Bravo');
		expect(await dispatchClipboard(page, 'cut')).toBe('Bravo');
		await expect(page.locator('.cm-content')).not.toContainText('Bravo');
		expect(await source(page)).toBe('Alpha\nCharlie');
	});

	test('mouse selection supports copying, replacement typing, and Delete', async ({ page }) => {
		await mountEditor(page, 'Alpha bravo charlie\nSecond line');
		const first = page.locator('.cm-line').first();
		const box = await first.boundingBox();
		expect(box).not.toBeNull();
		await page.mouse.move(box!.x + 2, box!.y + box!.height / 2);
		await page.mouse.down();
		await page.mouse.move(box!.x + 44, box!.y + box!.height / 2, { steps: 6 });
		await page.mouse.up();
		expect((await page.evaluate(() => window.getSelection()?.toString() ?? '')).trim()).toBe('Alpha');
		expect(await dispatchClipboard(page, 'copy')).toBe('Alpha');

		await page.keyboard.insertText('Omega');
		expect(await source(page)).toBe('Omega bravo charlie\nSecond line');

		await page.keyboard.press('Escape');
		await page.locator('.cm-line').nth(1).click();
		await page.keyboard.press('Home');
		for (let index = 0; index < 7; index += 1) await page.keyboard.press('Shift+ArrowRight');
		await page.keyboard.press('Delete');
		expect(await source(page)).toBe('Omega bravo charlie\nline');
	});

	test('bold and italic shortcuts wrap typing and selected text like Obsidian', async ({ page }) => {
		await mountEditor(page, 'Before ');
		await page.locator('.cm-content').click();
		await page.keyboard.press('End');
		await page.keyboard.press(`${mod}+b`);
		await page.keyboard.insertText('bold');
		await page.keyboard.press(`${mod}+b`);
		await page.keyboard.insertText(' after');
		expect(await source(page)).toBe('Before **bold** after');

		await page.keyboard.press('Home');
		for (let index = 0; index < 6; index += 1) await page.keyboard.press('Shift+ArrowRight');
		await page.keyboard.press(`${mod}+i`);
		expect(await source(page)).toBe('*Before* **bold** after');
	});

	test('Enter, Shift+Enter, Tab, and Shift+Tab preserve Obsidian list behavior', async ({ page }) => {
		await mountEditor(page, '- Parent\n- Child\n\n3. Ordered');
		await page.locator('.cm-line', { hasText: 'Child' }).click();
		await page.keyboard.press('Tab');
		await page.locator('.cm-line', { hasText: 'Ordered' }).click();
		await expect(page.locator('.mlp-bullet-2')).toHaveCount(1);
		await page.locator('.cm-line', { hasText: 'Child' }).click();
		await page.keyboard.press('Shift+Tab');
		await page.locator('.cm-line', { hasText: 'Ordered' }).click();
		await expect(page.locator('.mlp-bullet-2')).toHaveCount(0);

		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await page.keyboard.insertText('Next');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.insertText('Continuation');
		expect(await source(page)).toBe('- Parent\n- Child\n\n3. Ordered\n4. Next\n   Continuation');
	});

	test('keyboard selection can be copied, replaced, undone, and redone', async ({ page }) => {
		await mountEditor(page, 'Alpha bravo charlie');
		await page.locator('.cm-content').click();
		await page.keyboard.press('Home');
		for (let index = 0; index < 5; index += 1) await page.keyboard.press('Shift+ArrowRight');
		expect(await dispatchClipboard(page, 'copy')).toBe('Alpha');
		await page.keyboard.insertText('Omega');
		await page.keyboard.press(`${mod}+z`);
		await page.keyboard.press(`${mod}+Shift+z`);
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string }> }).__posted
				.filter((message) => message.type === 'undo' || message.type === 'redo')
				.map((message) => message.type),
		)).toEqual(['undo', 'redo']);
	});
});
