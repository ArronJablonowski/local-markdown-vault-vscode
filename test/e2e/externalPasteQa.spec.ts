import { expect, test, type Locator, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const plain = 'External research notes: cafe\u0301 and \u{1f4cb} stay intact.\nA second paragraph with **authored Markdown**.';
const hostileHtml = '<h1>Different rich representation</h1><img src="https://external-paste.invalid/pixel" onerror="window.__externalPasteExecuted=true"><script>window.__externalPasteExecuted=true</script>';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVb0AAAAASUVORK5CYII=';

async function source(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate(content => (content as any).cmTile.root.view.state.doc.toString());
}

/** Event-local clipboard fixtures never read or replace the operating-system clipboard. */
async function paste(target: Locator, values: Record<string, string>, imageMime?: string, shifted = false) {
	return target.evaluate((element, input) => {
		if (input.shifted) element.dispatchEvent(new KeyboardEvent('keydown', {
			key: 'V', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
		}));
		const data = new DataTransfer();
		for (const [mime, value] of Object.entries(input.values)) data.setData(mime, value);
		if (input.imageMime) {
			const bytes = input.imageMime === 'image/png' ? Uint8Array.from(atob(input.png), character => character.charCodeAt(0))
				: '<svg xmlns="http://www.w3.org/2000/svg"><text>Alternate image</text></svg>';
			data.items.add(new File([bytes], 'external-image', { type: input.imageMime }));
		}
		const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
		element.dispatchEvent(event);
		if (input.shifted) element.dispatchEvent(new KeyboardEvent('keyup', { key: 'V', ctrlKey: true, shiftKey: true, bubbles: true }));
		return { prevented: event.defaultPrevented, types: [...data.types] };
	}, { values, imageMime, shifted, png });
}

async function selectDocument(page: Page): Promise<void> {
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+a`);
}

async function imageMessages(page: Page) {
	return page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'pasteImages'));
}

test.beforeEach(({ page }) => {
	page.on('pageerror', error => { throw error; });
	page.on('request', request => {
		if (request.url().includes('external-paste.invalid')) throw new Error('Clipboard HTML caused a remote request');
	});
});

test('external browser rich HTML uses exact supplied plain text without importing active content', async ({ page }) => {
	await mountEditor(page, 'Replace');
	await selectDocument(page);
	await paste(page.locator('.cm-content'), { 'text/plain': plain, 'text/html': hostileHtml });
	await expect.poll(() => source(page)).toBe(plain);
	expect(await page.evaluate(() => (window as any).__externalPasteExecuted)).toBeUndefined();
});

for (const mime of ['image/png', 'image/svg+xml']) {
	test(`external mixed rich text prefers readable text over its ${mime} representation`, async ({ page }) => {
		await mountEditor(page, 'Replace');
		await selectDocument(page);
		await paste(page.locator('.cm-content'), { 'text/plain': plain, 'text/html': hostileHtml }, mime);
		await expect.poll(() => source(page)).toBe(plain);
		expect(await imageMessages(page)).toEqual([]);
		await expect(page.locator('#mlp-image-paste-warning')).not.toBeVisible();
	});
}

test('Shift+Paste of mixed image and text remains a literal text operation', async ({ page }) => {
	await mountEditor(page, 'Replace');
	await selectDocument(page);
	const text = 'A\tB\nOne\tTwo';
	await paste(page.locator('.cm-content'), { 'text/plain': text, 'text/html': hostileHtml }, 'image/png', true);
	await expect.poll(() => source(page)).toBe(text);
	expect(await imageMessages(page)).toEqual([]);
});

test('external text with an alternate image pastes into code as literal code', async ({ page }) => {
	const original = '```ts\nconst replace = true;\n```';
	await mountEditor(page, original);
	await postToWebview(page, { type: 'jumpToLine', line: 2 });
	await page.keyboard.press('Shift+End');
	const code = 'const pasted = "retained";';
	await paste(page.locator('.cm-content'), { 'text/plain': code, 'text/html': '<pre>Different representation</pre>' }, 'image/png');
	await expect.poll(() => source(page)).toBe(original.replace('const replace = true;', code));
	expect(await imageMessages(page)).toEqual([]);
});

test('spreadsheet text and its alternate image paste as one editable table', async ({ page }) => {
	await mountEditor(page, 'Replace');
	await selectDocument(page);
	await paste(page.locator('.cm-content'), { 'text/plain': 'Name\tCount\nCable\t2', 'text/html': '<table><tr><td>Name</td><td>Count</td></tr></table>' }, 'image/png');
	await expect.poll(() => source(page)).toBe('| Name | Count |\n| --- | --- |\n| Cable | 2 |\n\n');
	expect(await imageMessages(page)).toEqual([]);
});

for (const mime of ['text/csv', 'text/tab-separated-values']) {
	test(`empty external ${mime} metadata does not replace valid plain text with an empty grid`, async ({ page }) => {
		await mountEditor(page, 'Replace');
		await selectDocument(page);
		await paste(page.locator('.cm-content'), { 'text/plain': plain, [mime]: '', 'text/html': hostileHtml });
		await expect.poll(() => source(page)).toBe(plain);
	});
}

test('HTML-only external data is rejected visibly without changing the selected source', async ({ page }) => {
	await mountEditor(page, 'Retain this original');
	await selectDocument(page);
	await paste(page.locator('.cm-content'), { 'text/html': hostileHtml });
	expect(await source(page)).toBe('Retain this original');
	await expect(page.locator('#mlp-spreadsheet-paste-warning')).toBeVisible();
});

test('image-only external data still enters the validated attachment pipeline', async ({ page }) => {
	await mountEditor(page, 'Keep original');
	await postToWebview(page, { type: 'jumpToLine', line: 1 });
	await paste(page.locator('.cm-content'), { 'text/html': '<img src="external representation">' }, 'image/png');
	await expect.poll(() => imageMessages(page)).toMatchObject([{ atPos: 0, images: [{ mimeType: 'image/png', dataBase64: png }] }]);
	expect(await source(page)).toBe('Keep original');
});

test('image-only paste remains available when applications also supply empty text metadata', async ({ page }) => {
	await mountEditor(page, 'Keep original');
	await postToWebview(page, { type: 'jumpToLine', line: 1 });
	await paste(page.locator('.cm-content'), { 'text/plain': '', 'text/csv': '', 'text/html': '<img src="external representation">' }, 'image/png');
	await expect.poll(() => imageMessages(page)).toMatchObject([{ atPos: 0, images: [{ mimeType: 'image/png', dataBase64: png }] }]);
	expect(await source(page)).toBe('Keep original');
});

test('malformed nonempty declared CSV is still rejected instead of falling back to alternate plain text', async ({ page }) => {
	await mountEditor(page, 'Keep original');
	await selectDocument(page);
	await paste(page.locator('.cm-content'), { 'text/csv': '"unterminated', 'text/plain': plain });
	expect(await source(page)).toBe('Keep original');
	await expect(page.locator('#mlp-spreadsheet-paste-warning')).toBeVisible();
});

test('an external URI-only link can replace the selected text of an editable table cell', async ({ page }) => {
	const original = 'Before\n\n| Link |\n| --- |\n| Replace |\n\nAfter';
	await mountEditor(page, original);
	const cell = page.locator('.mlp-table td').first();
	await cell.click();
	await page.keyboard.press(`${mod}+a`);
	await paste(cell, { 'text/uri-list': 'https://example.invalid/reference' });
	await expect.poll(() => source(page)).toBe(original.replace('Replace', 'https://example.invalid/reference'));
});

test('image-only clipboard with empty grid metadata cannot erase a selected table cell', async ({ page }) => {
	const original = 'Before\n\n| Item |\n| --- |\n| Keep original |\n\nAfter';
	await mountEditor(page, original);
	const cell = page.locator('.mlp-table td').first();
	await cell.click();
	await page.keyboard.press(`${mod}+a`);
	await paste(cell, { 'text/plain': '', 'text/csv': '', 'text/html': '<img src="external representation">' }, 'image/png');
	expect(await source(page)).toBe(original);
	await expect(page.locator('#mlp-spreadsheet-paste-warning')).toBeVisible();
	expect(await imageMessages(page)).toEqual([]);
});

test('clicking from a table cell back into prose restores the normal external paste destination', async ({ page }) => {
	const original = 'Before\n\n| Item |\n| --- |\n| Retain |\n\nAfter';
	await mountEditor(page, original);
	await page.locator('.mlp-table td').first().click();
	await page.locator('.cm-line', { hasText: /^After$/ }).click();
	await page.keyboard.press('Home');
	await page.keyboard.press('Shift+End');
	const focused = await page.evaluate(() => document.activeElement?.className);
	expect(focused).toContain('cm-content');
	await paste(page.locator('.cm-content'), { 'text/plain': plain, 'text/html': hostileHtml });
	await expect.poll(() => source(page)).toBe(original.replace('After', plain));
});
