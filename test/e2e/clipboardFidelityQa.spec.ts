import { expect, test, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

// These event-local transfers never access the native clipboard shared with VS Code.
async function clipboard(page: Page, type: 'copy' | 'cut' | 'paste', text = '', html = '') {
	return page.locator('.cm-content').evaluate((content, input) => {
		const data = new DataTransfer();
		if (input.type === 'paste') {
			data.setData('text/plain', input.text);
			if (input.html) data.setData('text/html', input.html);
		}
		content.dispatchEvent(new ClipboardEvent(input.type, { clipboardData: data, bubbles: true, cancelable: true }));
		return data.getData('text/plain');
	}, { type, text, html });
}

async function source(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate(content => (content as any).cmTile.root.view.state.doc.toString());
}

const mixed = [
	'# Clipboard fidelity', '',
	'Unicode: cafe\u0301 \u{1f469}\u200d\u{1f4bb} \u{1f1fa}\u{1f1f8}; **bold** and [a link](Note.md).', '',
	'> [!warning] Keep exact source', '> - [x] Reviewed', '> - [ ] Pending', '',
	'| Item | Detail |', '| --- | --- |', '| A\\|B | first<br>second |', '',
	'```ts', '\tconst label = "\u{1f680}";', 'console.log(label);', '```', '',
	'$$', 'x^2 + y^2 = z^2', '$$', '',
	'Final paragraph.',
].join('\n');

test('whole mixed-object copy and cut preserve exact Markdown and Unicode', async ({ page }) => {
	await mountEditor(page, mixed);
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+a`);
	expect(await clipboard(page, 'copy')).toBe(mixed);
	expect(await clipboard(page, 'cut')).toBe(mixed);
	await expect.poll(() => source(page)).toBe('');
	await clipboard(page, 'paste', mixed);
	await expect.poll(() => source(page)).toBe(mixed);
});

test('multi-cursor copy, cut, and paste retain independent selection boundaries', async ({ page }) => {
	await mountEditor(page, 'TOKEN first\nTOKEN second\nTOKEN third');
	await postToWebview(page, { type: 'jumpToLine', line: 1 });
	for (let index = 0; index < 3; index++) await page.keyboard.press(`${mod}+d`);
	const ranges = await page.locator('.cm-content').evaluate(content => (content as any).cmTile.root.view.state.selection.ranges.length);
	expect(ranges).toBe(3);
	expect(await clipboard(page, 'copy')).toBe('TOKEN\nTOKEN\nTOKEN');
	expect(await clipboard(page, 'cut')).toBe('TOKEN\nTOKEN\nTOKEN');
	await expect.poll(() => source(page)).toBe(' first\n second\n third');
	await clipboard(page, 'paste', 'ONE\nTWO\nTHREE');
	await expect.poll(() => source(page)).toBe('ONE first\nTWO second\nTHREE third');
});

test('CRLF clipboard text normalizes line endings without damaging Unicode or blank lines', async ({ page }) => {
	await mountEditor(page, 'Replace me');
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+a`);
	const value = 'First \u{1f600}\r\n\r\nSecond cafe\u0301\r\nEnd';
	await clipboard(page, 'paste', value);
	await expect.poll(() => source(page)).toBe(value.replaceAll('\r\n', '\n'));
	await page.keyboard.press(`${mod}+a`);
	expect(await clipboard(page, 'copy')).toBe(value.replaceAll('\r\n', '\n'));
});

test('plain-text clipboard content wins over hostile rich HTML', async ({ page }) => {
	const requests: string[] = [];
	page.on('request', request => { if (request.url().includes('clipboard-tracker.invalid')) requests.push(request.url()); });
	await mountEditor(page, 'Replace me');
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+a`);
	await clipboard(page, 'paste', 'Safe plain text', '<img src="https://clipboard-tracker.invalid/pixel" onerror="window.__clipboardExecuted=true"><script>window.__clipboardExecuted=true</script>');
	await expect.poll(() => source(page)).toBe('Safe plain text');
	expect(requests).toEqual([]);
	expect(await page.evaluate(() => (window as any).__clipboardExecuted)).toBeUndefined();
	await expect(page.locator('.cm-content script, .cm-content img[src*="clipboard-tracker"]')).toHaveCount(0);
});

for (const format of ['html-only', 'unknown', 'empty', 'empty-text']) {
	test(`${format} clipboard cannot delete the existing selected source`, async ({ page }) => {
		const original = 'Preserve selected evidence';
		await mountEditor(page, original);
		await page.locator('.cm-content').focus();
		await page.keyboard.press(`${mod}+a`);
		await page.locator('.cm-content').evaluate((content, kind) => {
			const data = new DataTransfer();
			if (kind === 'html-only') data.setData('text/html', '<b>HTML only</b>');
			if (kind === 'unknown') data.setData('application/x-custom', 'opaque');
			if (kind === 'empty-text') data.setData('text/plain', '');
			content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
		}, format);
		expect(await source(page)).toBe(original);
		await expect(page.locator('#mlp-spreadsheet-paste-warning')).toBeVisible();
		expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	});
}

test('HTML-only paste also preserves selected fenced source', async ({ page }) => {
	const original = '```ts\nconst keep = true;\n```';
	await mountEditor(page, original);
	await postToWebview(page, { type: 'jumpToLine', line: 2 });
	await page.keyboard.press('Shift+End');
	await page.locator('.cm-content').evaluate(content => {
		const data = new DataTransfer(); data.setData('text/html', '<b>HTML only</b>');
		content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
	});
	expect(await source(page)).toBe(original);
	await expect(page.locator('#mlp-spreadsheet-paste-warning')).toBeVisible();
});

test('URI-list clipboard text still pastes as ordinary source', async ({ page }) => {
	await mountEditor(page, 'Replace this');
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+a`);
	await page.locator('.cm-content').evaluate(content => {
		const data = new DataTransfer(); data.setData('text/uri-list', 'https://example.invalid/reference');
		content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
	});
	await expect.poll(() => source(page)).toBe('https://example.invalid/reference');
});

for (const mime of ['text/csv', 'text/tab-separated-values']) {
	for (const value of ['', 'CSV-only content']) {
		test(`a ${mime}-only paste with ${value ? 'content' : 'empty content'} cannot delete selected code`, async ({ page }) => {
			const original = '```ts\nconst keep = true;\n```';
			await mountEditor(page, original);
			await postToWebview(page, { type: 'jumpToLine', line: 2 });
			await page.keyboard.press('Shift+End');
			await page.locator('.cm-content').evaluate((content, dataValue) => {
				const data = new DataTransfer(); data.setData(dataValue.mime, dataValue.value);
				content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
			}, { mime, value });
			expect(await source(page)).toBe(original);
			await expect(page.locator('#mlp-spreadsheet-paste-warning')).toBeVisible();
		});
	}
}

test('Shift+Paste preserves literal TSV and does not affect the next ordinary grid paste', async ({ page }) => {
	await mountEditor(page, 'Replace');
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+a`);
	await page.locator('.cm-content').evaluate(content => {
		content.dispatchEvent(new KeyboardEvent('keydown', { key: 'V', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
	});
	await clipboard(page, 'paste', 'Name\tValue\nOne\tTwo');
	await expect.poll(() => source(page)).toBe('Name\tValue\nOne\tTwo');
	await page.keyboard.press(`${mod}+a`);
	await clipboard(page, 'paste', 'Name\tValue\nOne\tTwo');
	await expect.poll(() => source(page)).toBe('| Name | Value |\n| --- | --- |\n| One | Two |\n\n');
});

test('releasing Shift+Paste without a paste event clears the plain-text intent', async ({ page }) => {
	await mountEditor(page, 'Replace');
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+a`);
	await page.locator('.cm-content').evaluate(content => {
		content.dispatchEvent(new KeyboardEvent('keydown', { key: 'V', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
		content.dispatchEvent(new KeyboardEvent('keyup', { key: 'V', ctrlKey: true, shiftKey: true, bubbles: true }));
	});
	await clipboard(page, 'paste', 'Name\tValue\nOne\tTwo');
	await expect.poll(() => source(page)).toBe('| Name | Value |\n| --- | --- |\n| One | Two |\n\n');
});

test('leaving the editor clears an unfinished Shift+Paste gesture', async ({ page }) => {
	await mountEditor(page, 'Replace');
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+a`);
	await page.locator('.cm-content').evaluate(content => {
		content.dispatchEvent(new KeyboardEvent('keydown', { key: 'V', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
	});
	await page.locator('.mlp-editing-mode-toggle').focus();
	await page.locator('.cm-content').focus();
	await clipboard(page, 'paste', 'Name\tValue\nOne\tTwo');
	await expect.poll(() => source(page)).toBe('| Name | Value |\n| --- | --- |\n| One | Two |\n\n');
});

test('Shift+Paste into one table cell retains the existing grid shape', async ({ page }) => {
	const original = 'Before\n\n| A | B |\n| --- | --- |\n| Original | Neighbor |\n\nAfter';
	await mountEditor(page, original);
	const cell = page.locator('.mlp-table td').first();
	await cell.click();
	await page.keyboard.press(`${mod}+a`);
	await cell.evaluate(content => {
		content.dispatchEvent(new KeyboardEvent('keydown', { key: 'V', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
		const data = new DataTransfer(); data.setData('text/plain', 'Name\tValue\nOne\tTwo');
		content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
	});
	await expect.poll(() => source(page)).toBe(original.replace('Original', 'Name\tValue One\tTwo'));
	await expect(page.locator('.mlp-table td')).toHaveCount(2);
});

test('grid-only data cannot delete multiple selected source ranges', async ({ page }) => {
	const original = 'TOKEN first\nTOKEN second';
	await mountEditor(page, original);
	await postToWebview(page, { type: 'jumpToLine', line: 1 });
	await page.keyboard.press(`${mod}+d`);
	await page.keyboard.press(`${mod}+d`);
	await page.locator('.cm-content').evaluate(content => {
		const data = new DataTransfer(); data.setData('text/csv', '');
		content.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
	});
	expect(await source(page)).toBe(original);
	await expect(page.locator('#mlp-spreadsheet-paste-warning')).toBeVisible();
});
