import { expect, test, type Locator, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const plainTable = '| Item | Neighbor |\n| --- | --- |\n| Alpha Beta Omega | Preserve |';

async function source(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate(element => (element as any).cmTile.root.view.state.doc.toString());
}

// Clipboard payloads belong only to the event; native QA owns the OS clipboard.
async function transfer(target: Locator, kind: 'copy' | 'paste' | 'cut', formats: Record<string, string> = {}) {
	return target.evaluate((element, input) => {
		const clipboardData = new DataTransfer();
		for (const [type, value] of Object.entries(input.formats)) clipboardData.setData(type, value);
		const event = new ClipboardEvent(input.kind, { bubbles: true, cancelable: true, clipboardData });
		element.dispatchEvent(event);
		return { text: clipboardData.getData('text/plain'), prevented: event.defaultPrevented };
	}, { kind, formats });
}

async function dragWord(page: Page, target: Locator, word: string, backward = false): Promise<void> {
	await target.scrollIntoViewIfNeeded();
	const point = await target.evaluate((element, text) => {
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const start = node.textContent?.indexOf(text) ?? -1;
			if (start < 0) continue;
			const range = document.createRange();
			range.setStart(node, start); range.setEnd(node, start + text.length);
			const rect = range.getBoundingClientRect();
			return { x: rect.left + 1, y: rect.top + rect.height / 2, right: rect.right };
		}
		throw new Error(`Missing rendered text: ${text}`);
	}, word);
	await page.mouse.move(backward ? point.right : point.x, point.y);
	await page.mouse.down();
	await page.mouse.move(backward ? point.x : point.right, point.y, { steps: 12 });
	await page.mouse.up();
	await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(word);
}

test('a backward mouse selection after Unicode retains exact source offsets', async ({ page }) => {
	const doc = 'Before\n\n' + plainTable.replace('Alpha Beta Omega', '\u{1f642} cafe\u0301 Beta \u96ea') + '\n\nAfter';
	await mountEditor(page, doc);
	const cell = page.locator('.mlp-table td').first();
	await dragWord(page, cell, 'Beta', true);
	expect((await transfer(cell, 'copy')).text).toBe('Beta');
	await transfer(cell, 'paste', { 'text/plain': 'Replacement' });
	await page.keyboard.type(' continued');
	await page.keyboard.press('Enter');
	expect(await source(page)).toBe(doc.replace('Beta', 'Replacement continued'));
});

test.beforeEach(({ page }) => {
	page.on('pageerror', error => { throw error; });
	page.on('console', message => {
		if (/CodeMirror plugin crashed/.test(message.text())) throw new Error(message.text());
	});
});

test('mouse-selected rendered table text can be copied and replaced without erasing unselected content', async ({ page }) => {
	const doc = 'Before\n\n' + plainTable + '\n\nAfter';
	await mountEditor(page, doc);
	const cell = page.locator('.mlp-table td').first();
	await dragWord(page, cell, 'Beta');
	await expect(cell).toBeFocused();
	await expect(page.locator('.mlp-table-cell-editing')).toHaveCount(0);
	expect((await transfer(cell, 'copy')).text).toBe('Beta');
	await transfer(cell, 'paste', { 'text/plain': 'New', 'text/html': '<b>Different rich representation</b>' });
	expect(await source(page)).toBe(doc.replace('Beta', 'New'));
});

for (const [type, value] of [
	['text/plain', 'Left\tRight\nOne\tTwo'],
	['text/tab-separated-values', 'Left\tRight\nOne\tTwo'],
	['text/csv', 'Left,Right\nOne,Two'],
]) {
	test(`a partial rendered word selection cannot overwrite a grid with ${type}`, async ({ page }) => {
		const doc = 'Before\n\n' + plainTable + '\n\nAfter';
		await mountEditor(page, doc);
		const cell = page.locator('.mlp-table td').first();
		await dragWord(page, cell, 'Beta');
		await transfer(cell, 'paste', { [type]: value });
		expect(await source(page)).toBe(doc);
		await expect(page.locator('#mlp-spreadsheet-paste-warning')).toContainText('Press F2');
		await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Beta');
		await transfer(cell, 'paste', { 'text/plain': 'Retry' });
		expect(await source(page)).toBe(doc.replace('Beta', 'Retry'));
	});
}

for (const markup of ['Beta', '**Beta**']) {
	test(`selecting a whole rendered cell still permits an intentional grid paste: ${markup}`, async ({ page }) => {
		const doc = 'Before\n\n' + plainTable.replace('Alpha Beta Omega', markup) + '\n\nAfter';
		await mountEditor(page, doc);
		const cell = page.locator('.mlp-table td').first();
		await dragWord(page, cell, 'Beta');
		await transfer(cell, 'paste', { 'text/tab-separated-values': 'Left\tRight\nOne\tTwo' });
		expect(await source(page)).toBe('Before\n\n| Item | Neighbor |\n| --- | --- |\n| Left | Right |\n| One | Two |\n\nAfter');
		await expect(page.locator('.mlp-table thead th')).toHaveText(['Item', 'Neighbor']);
		await expect(page.locator('.mlp-table tbody td')).toHaveText(['Left', 'Right', 'One', 'Two']);
	});
}

for (const markup of ['Alpha **Beta** Omega', '<ul><li>Alpha Beta Omega</li><li>Retain second item</li></ul>']) {
	test(`partial rich selection is preserved with an explicit source-editing instruction: ${markup}`, async ({ page }) => {
		const doc = 'Before\n\n' + plainTable.replace('Alpha Beta Omega', markup) + '\n\nAfter';
		await mountEditor(page, doc);
		const cell = page.locator('.mlp-table td').first();
		await dragWord(page, cell, 'Beta');
		expect((await transfer(cell, 'copy')).text).toBe('Beta');
		await transfer(cell, 'paste', { 'text/plain': 'New' });
		expect(await source(page)).toBe(doc);
		await expect(page.locator('#mlp-spreadsheet-paste-warning')).toContainText('Press F2');
		await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Beta');
		await cell.focus();
		await page.keyboard.press('F2');
		await page.keyboard.press('Home');
		for (let n = 0; n < markup.indexOf('Beta'); n++) await page.keyboard.press('ArrowRight');
		for (let n = 0; n < 4; n++) await page.keyboard.press('Shift+ArrowRight');
		await transfer(cell, 'paste', { 'text/plain': 'New' });
		await page.keyboard.press('Enter');
		expect(await source(page)).toBe(doc.replace('Beta', 'New'));
	});
}

test('a rejected clipboard leaves a mouse-selected rendered cell available for a plain-text retry', async ({ page }) => {
	const doc = 'Before\n\n' + plainTable + '\n\nAfter';
	await mountEditor(page, doc);
	const cell = page.locator('.mlp-table td').first();
	await dragWord(page, cell, 'Beta');
	await transfer(cell, 'paste', { 'text/plain': '', 'text/html': '<b>Unavailable text</b>' });
	expect(await source(page)).toBe(doc);
	await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Beta');
	await transfer(cell, 'paste', { 'text/plain': 'Retry' });
	expect(await source(page)).toBe(doc.replace('Beta', 'Retry'));
});

test('a rendered cell selection cannot paste while locked and still copies only its selected text', async ({ page }) => {
	const doc = 'Before\n\n' + plainTable + '\n\nAfter';
	await mountEditor(page, doc, { editingMode: 'locked' });
	const cell = page.locator('.mlp-table td').first();
	await dragWord(page, cell, 'Beta');
	expect((await transfer(cell, 'copy')).text).toBe('Beta');
	await transfer(cell, 'paste', { 'text/plain': 'Forbidden' });
	expect(await source(page)).toBe(doc);
	expect((await transfer(cell, 'copy')).text).toBe('Beta');
});

test('selecting a complete rich text cell intentionally replaces its complete source', async ({ page }) => {
	const doc = 'Before\n\n' + plainTable.replace('Alpha Beta Omega', '**Beta**') + '\n\nAfter';
	await mountEditor(page, doc);
	const cell = page.locator('.mlp-table td').first();
	await dragWord(page, cell, 'Beta');
	await transfer(cell, 'paste', { 'text/plain': 'Replacement' });
	expect(await source(page)).toBe(doc.replace('**Beta**', 'Replacement'));
});

test('text selected beside an image does not count as the entire rendered cell', async ({ page }) => {
	const markup = '![Retain image](Attachment.png) **Beta**';
	const doc = 'Before\n\n' + plainTable.replace('Alpha Beta Omega', markup) + '\n\nAfter';
	await mountEditor(page, doc);
	const cell = page.locator('.mlp-table td').first();
	await dragWord(page, cell, 'Beta');
	await transfer(cell, 'paste', { 'text/plain': 'Replacement' });
	expect(await source(page)).toBe(doc);
	await expect(page.locator('#mlp-spreadsheet-paste-warning')).toContainText('Press F2');
});

test('table raw-source editor preserves a partial selection through paste and subsequent typing', async ({ page }) => {
	const doc = 'Before\n\n' + plainTable + '\n\nAfter';
	await mountEditor(page, doc);
	const cell = page.locator('.mlp-table td').first();
	await cell.click();
	await page.keyboard.press('Home');
	for (let n = 0; n < 6; n++) await page.keyboard.press('ArrowRight');
	for (let n = 0; n < 4; n++) await page.keyboard.press('Shift+ArrowRight');
	await transfer(cell, 'paste', { 'text/plain': 'New' });
	await page.keyboard.type(' expanded');
	await page.keyboard.press('Enter');
	expect(await source(page)).toBe(doc.replace('Beta', 'New expanded'));
});

test('copying a selected Markdown source span does not consume its following paste replacement', async ({ page }) => {
	const doc = 'Before\n\nAlpha **Beta** Omega\n\nAfter';
	await mountEditor(page, doc);
	await postToWebview(page, { type: 'jumpToLine', line: 3 });
	await page.keyboard.press('Shift+End');
	const editor = page.locator('.cm-content');
	expect((await transfer(editor, 'copy')).text).toBe('Alpha **Beta** Omega');
	await transfer(editor, 'paste', { 'text/plain': 'Copied replacement' });
	await page.keyboard.type(' continued');
	expect(await source(page)).toBe(doc.replace('Alpha **Beta** Omega', 'Copied replacement continued'));
});

test('opening and closing a property edit cannot redirect a following code-source paste', async ({ page }) => {
	const doc = '---\nowner: Morgan\n---\n\n```text\nReplace code\n```\n\nAfter';
	await mountEditor(page, doc);
	await page.getByRole('button', { name: 'Edit owner', exact: true }).dblclick();
	await expect(page.locator('.mlp-property-input')).toBeFocused();
	await page.keyboard.press('Escape');
	await postToWebview(page, { type: 'jumpToLine', line: 6 });
	await page.keyboard.press('Shift+End');
	await transfer(page.locator('.cm-content'), 'paste', { 'text/plain': 'New code', 'text/html': '<pre>Different code</pre>' });
	await page.keyboard.type(' retained');
	expect(await source(page)).toBe(doc.replace('Replace code', 'New code retained'));
});

test('repeated copy and paste of selected Unicode source preserves every character', async ({ page }) => {
	const value = 'cafe\u0301 \u{1f642} \u{1f469}\u200d\u{1f4bb} \u{1f1fa}\u{1f1f8} \u2014 \u96ea';
	await mountEditor(page, value);
	for (let attempt = 0; attempt < 10; attempt++) {
		const editor = page.locator('.cm-content');
		await editor.focus();
		await page.keyboard.press(`${mod}+a`);
		const copied = (await transfer(editor, 'copy')).text;
		expect(copied).toBe(value);
		await transfer(editor, 'paste', { 'text/plain': copied, 'text/html': '<p>Alternate representation</p>' });
		expect(await source(page)).toBe(value);
	}
});
