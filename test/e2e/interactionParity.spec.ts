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
	for (const mode of ['editing', 'locked'] as const) {
		test(`mouse selection copies partial table text in ${mode} mode`, async ({ page }) => {
			await mountEditor(page, 'Before\n\n| Name | Value |\n| --- | --- |\n| Alpha bravo | Charlie delta |\n\nAfter', { editingMode: mode });
			const bounds = await page.locator('.mlp-table td').first().boundingBox();
			await page.mouse.move(bounds!.x + 12, bounds!.y + bounds!.height / 2);
			await page.mouse.down();
			await page.mouse.move(bounds!.x + 53, bounds!.y + bounds!.height / 2, { steps: 10 });
			await page.mouse.up();
			const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
			expect(selected.trim()).toBe('Alpha');
			expect(await dispatchClipboard(page, 'copy')).toBe(selected);
		});
		test(`mouse selection copies across code and table blocks in ${mode} mode`, async ({ page }) => {
			const markdown = 'Start paragraph\n\n```text\ncode one\ncode two\n```\n\n| Name | Value |\n| --- | --- |\n| Alpha | Bravo |\n\nLast paragraph';
			await mountEditor(page, markdown, { editingMode: mode });
			const first = await page.locator('.cm-line', { hasText: /^Start paragraph$/ }).boundingBox();
			const last = await page.locator('.cm-line', { hasText: /^Last paragraph$/ }).boundingBox();
			await page.mouse.move(first!.x + 1, first!.y + first!.height / 2);
			await page.mouse.down();
			await page.mouse.move(last!.x + last!.width - 2, last!.y + last!.height / 2, { steps: 30 });
			await page.mouse.up();
			expect(await dispatchClipboard(page, 'copy')).toBe(markdown);
		});
		test(`mouse selection can extend through a long scrolling document in ${mode} mode`, async ({ page }) => {
			await mountEditor(page, Array.from({ length: 250 }, (_, i) => `Paragraph ${i} selectable text.`).join('\n\n'), { editingMode: mode });
			const first = await page.locator('.cm-line').first().boundingBox();
			await page.mouse.move(first!.x + 1, first!.y + first!.height / 2);
			await page.mouse.down();
			await page.mouse.move(first!.x + 160, 600, { steps: 20 });
			await page.mouse.wheel(0, 2500);
			await expect.poll(() => page.locator('.cm-scroller').evaluate(e => e.scrollTop)).toBeGreaterThan(1500);
			await page.mouse.move(first!.x + 180, 620, { steps: 10 });
			await page.mouse.up();
			const copied = await dispatchClipboard(page, 'copy');
			expect(copied).toContain('Paragraph 0 selectable text.');
			expect(copied).toContain('Paragraph 30 selectable text.');
		});
		test(`dragging from table text into the following paragraph preserves the selection in ${mode} mode`, async ({ page }) => {
			await mountEditor(page, 'Before\n\n| Name | Value |\n| --- | --- |\n| Alpha bravo | Charlie delta |\n\nFollowing paragraph\n\nAfter', { editingMode: mode });
			const first = await page.locator('.mlp-table td').first().boundingBox();
			const last = await page.locator('.cm-line', { hasText: /^Following paragraph$/ }).boundingBox();
			await page.mouse.move(first!.x + 12, first!.y + first!.height / 2);
			await page.mouse.down();
			await page.mouse.move(last!.x + 180, last!.y + last!.height / 2, { steps: 20 });
			await page.mouse.up();
			const selection = await page.evaluate(() => window.getSelection()?.toString() ?? '');
			expect(selection).toContain('Following');
			const copied = await dispatchClipboard(page, 'copy');
			expect(copied).toContain('bravo');
			expect(copied).toContain('Following');
		});
		test(`mouse selection copies multiple lines in ${mode} mode with a visible highlight`, async ({ page }) => {
			await mountEditor(page, 'Alpha bravo charlie\nSecond selected line\nFinal selected line\n\nAfter', { editingMode: mode });
			const first = await page.locator('.cm-line').first().boundingBox();
			const last = await page.locator('.cm-line').nth(2).boundingBox();
			await page.mouse.move(first!.x + 1, first!.y + first!.height / 2);
			await page.mouse.down();
			await page.mouse.move(last!.x + 180, last!.y + last!.height / 2, { steps: 20 });
			await page.mouse.up();
			const selection = await page.evaluate(() => window.getSelection()?.toString());
			expect(selection).toContain('Alpha bravo charlie');
			expect(selection).toContain('Second selected line');
			expect(await dispatchClipboard(page, 'copy')).toBe(selection);
			const selectionColor = await page.locator('.cm-line').first().evaluate((element) => getComputedStyle(element, '::selection').backgroundColor);
			expect(selectionColor).not.toBe('rgba(0, 0, 0, 0)');
		});
	}
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
