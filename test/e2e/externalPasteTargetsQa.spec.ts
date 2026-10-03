import { expect, test, type Page } from '@playwright/test';
import { mountEditor } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const table = '| Item | Count |\n| --- | --- |\n| Cable | 2 |';

async function source(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate(content => (content as any).cmTile.root.view.state.doc.toString());
}

// Clipboard bytes are event-local: these tests never read or change the system
// clipboard used by the separate, native VS Code validation session.
async function pasteAtFocus(page: Page, text: string) {
	return page.evaluate(value => {
		const target = document.activeElement as HTMLElement;
		const data = new DataTransfer();
		data.setData('text/plain', value);
		const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data });
		const before = target.className;
		target.dispatchEvent(event);
		return { before, after: document.activeElement?.className, prevented: event.defaultPrevented };
	}, text);
}

async function pasteKeyAtFocus(page: Page) {
	return page.evaluate(mac => {
		let escaped = false;
		const listener = () => { escaped = true; };
		window.addEventListener('keydown', listener);
		const key = new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac });
		document.activeElement!.dispatchEvent(key);
		window.removeEventListener('keydown', listener);
		return { escaped, prevented: key.defaultPrevented };
	}, process.platform === 'darwin');
}

test.beforeEach(({ page }) => {
	page.on('pageerror', error => { throw error; });
	page.on('console', message => {
		if (message.type() === 'error' && /CodeMirror plugin crashed/.test(message.text())) throw new Error(message.text());
	});
});

for (const kind of ['prose', 'code', 'table source'] as const) test(`external plain text paste follows the focused ${kind} caret`, async ({ page }) => {
	const doc = 'Before paragraph.\n\n```ts\nconst retained = 1;\n```\n\n' + table + '\n\nAfter paragraph.';
	await mountEditor(page, doc);
	let needle: string;
	if (kind === 'table source') {
		await page.locator('.mlp-table-wrap .mlp-code-mode-btn').click();
		await page.keyboard.press('Home');
		needle = '| Item | Count |';
	} else {
		needle = kind === 'code' ? 'const retained = 1;' : 'After paragraph.';
		await page.locator('.cm-line').filter({ hasText: needle }).click();
		await page.keyboard.press('End');
	}
	await expect(page.locator('.cm-content')).toBeFocused();
	expect(await pasteKeyAtFocus(page)).toEqual({ escaped: false, prevented: false });
	const head = await page.locator('.cm-content').evaluate(content => (content as any).cmTile.root.view.state.selection.main.head);
	await pasteAtFocus(page, 'PASTED');
	expect(await source(page)).toBe(doc.slice(0, head) + 'PASTED' + doc.slice(head));
});

test('keyboard lock toggle remains focused while locked and restores the editor on unlock', async ({ page }) => {
	const doc = 'Retained text';
	await mountEditor(page, doc);
	await page.locator('.cm-line').click();
	await page.keyboard.press('End');
	const toggle = page.locator('.mlp-editing-mode-toggle');
	await toggle.focus();
	await page.keyboard.press('Space');
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
	await expect(toggle).toBeFocused();
	await page.keyboard.press('Space');
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	await expect(page.locator('.cm-content')).toBeFocused();
	const event = await pasteAtFocus(page, ' external');
	await page.keyboard.type(' Continue typing');
	expect(await source(page), JSON.stringify(event)).toBe(doc + ' external Continue typing');
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('successive external plain text pastes retain a table cell editing target', async ({ page }) => {
	await mountEditor(page, 'Before\n\n' + table + '\n\nAfter');
	await page.locator('.mlp-table td').first().click();
	await page.keyboard.press(`${mod}+a`);
	expect(await pasteKeyAtFocus(page)).toEqual({ escaped: false, prevented: false });
	const first = await pasteAtFocus(page, 'First');
	expect(await source(page), JSON.stringify(first)).toContain('| First | 2 |');
	const second = await pasteAtFocus(page, ' second');
	expect(await source(page), JSON.stringify(second)).toContain('| First second | 2 |');
});

test('mid-cell Unicode paste restores the exact normalized insertion endpoint before typing', async ({ page }) => {
	const doc = 'Before\n\n' + table.replace('Cable', 'start🙂 end') + '\n\nAfter';
	await mountEditor(page, doc);
	await page.locator('.mlp-table td').first().click();
	await page.keyboard.press('Home');
	for (let key = 0; key < 6; key++) await page.keyboard.press('ArrowRight');
	await pasteAtFocus(page, '\u96ea | \u03a9\nline');
	await expect(page.locator('.mlp-table-cell-editing')).toBeFocused();
	await page.keyboard.type('X');
	await page.keyboard.press('Enter');
	expect(await source(page)).toBe(doc.replace('start🙂 end', 'start🙂\u96ea \\| \u03a9 lineX end'));
});

test('plain cell paste resumes only its own table, including unchanged replacements', async ({ page }) => {
	const secondTable = table.replace('Cable', 'Second');
	const doc = 'Before\n\n' + table + '\n\nBetween\n\n' + secondTable + '\n\nAfter';
	await mountEditor(page, doc);
	await page.locator('.mlp-table').nth(1).locator('td').first().click();
	await page.keyboard.press(`${mod}+a`);
	await pasteAtFocus(page, 'Second');
	await expect(page.locator('.mlp-table-cell-editing')).toBeFocused();
	await pasteAtFocus(page, ' appended');
	await page.keyboard.type('X');
	await page.keyboard.press('Enter');
	expect(await source(page)).toBe(doc.replace('| Second |', '| Second appendedX |'));
});

test('external paste after Tab preserves the next cell typed draft', async ({ page }) => {
	const doc = 'Before\n\n' + table + '\n\nAfter';
	await mountEditor(page, doc);
	await page.locator('.mlp-table td').first().click();
	await page.keyboard.press(`${mod}+a`);
	await page.keyboard.type('Updated');
	await page.keyboard.press('Tab');
	await expect(page.locator('.mlp-table-cell-editing')).toHaveAttribute('data-mlp-col', '1');
	await page.keyboard.type('Typed');
	await pasteAtFocus(page, ' pasted');
	expect(await source(page)).toBe(doc.replace('| Cable | 2 |', '| Updated | Typed pasted |'));
});

test('typing immediately after Tab never waits for a rendering frame to reach its cell', async ({ page }) => {
	for (let attempt = 0; attempt < 20; attempt++) {
		const doc = 'Before\n\n' + table + '\n\nAfter';
		await mountEditor(page, doc);
		await page.locator('.mlp-table td').first().click();
		await page.keyboard.press(`${mod}+a`);
		await page.keyboard.type('Left');
		await page.keyboard.press('Tab');
		// No locator wait between the actual navigation and following keystrokes.
		await page.keyboard.type('Typed');
		await pasteAtFocus(page, 'External');
		expect(await source(page), `attempt ${attempt}`).toBe(doc.replace('| Cable | 2 |', '| Left | TypedExternal |'));
	}
});

test('select-all replacing a pasted table retains the first typed character', async ({ page }) => {
	await mountEditor(page, 'Initial selection');
	for (let attempt = 0; attempt < 20; attempt++) {
		await page.locator('.cm-content').focus();
		await page.keyboard.press(`${mod}+a`);
		await pasteAtFocus(page, 'Name\tCount\nApples\t3\nPears\t7');
		await page.locator('.cm-content').focus();
		await page.keyboard.press(`${mod}+a`);
		await page.keyboard.type('External selection to replace');
		expect(await source(page), `attempt ${attempt}`).toBe('External selection to replace');
	}
});

test('leaving the page commits a table draft and refocusing its cell accepts external paste', async ({ page }) => {
	await mountEditor(page, 'Before\n\n' + table + '\n\nAfter');
	await page.locator('.mlp-table td').first().click();
	await page.keyboard.press(`${mod}+a`);
	await page.keyboard.type('Typed');
	// Simulate the page lifecycle only, without touching the OS clipboard.
	await page.evaluate(() => window.dispatchEvent(new Event('blur')));
	await expect.poll(() => source(page)).toContain('| Typed | 2 |');
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
	// Actual external-application focus restoration is covered in native VS
	// Code; dispatching a window FocusEvent cannot reproduce Electron's routing.
	await page.locator('.mlp-table td').first().click();
	await page.keyboard.press('End');
	const event = await pasteAtFocus(page, ' external');
	expect(await source(page), JSON.stringify(event)).toContain('| Typed external | 2 |');
});

test('a focused rendered table cell can accept plain paste without a preceding typing gesture', async ({ page }) => {
	await mountEditor(page, 'Before\n\n' + table + '\n\nAfter');
	const cell = page.locator('.mlp-table td').first();
	await cell.focus();
	await expect(page.locator('.mlp-table-cell-editing')).toHaveCount(0);
	expect(await pasteKeyAtFocus(page)).toEqual({ escaped: false, prevented: false });
	await pasteAtFocus(page, 'External replacement');
	expect(await source(page)).toContain('| External replacement | 2 |');
});

test('external paste keys stay in a property input and leave its native text paste unblocked', async ({ page }) => {
	await mountEditor(page, '---\nowner: Morgan\n---\n\nBody');
	await page.getByRole('button', { name: 'Edit owner', exact: true }).dblclick();
	const input = page.locator('.mlp-property-input');
	await expect(input).toBeFocused();
	expect(await pasteKeyAtFocus(page)).toEqual({ escaped: false, prevented: false });
	// An untrusted ClipboardEvent cannot invoke the browser's input default;
	// test that handlers leave it alone, then model the native inserted bytes.
	expect((await pasteAtFocus(page, 'External owner')).prevented).toBe(false);
	await page.keyboard.insertText('External owner');
	await page.keyboard.press('Enter');
	expect(await source(page)).toBe('---\nowner: External owner\n---\n\nBody');
});

test('copying a code block keeps the existing source caret ready for external paste', async ({ page }) => {
	const doc = 'Before\n\n```ts\nconst value = 1;\n```\n\nAfter';
	await mountEditor(page, doc);
	await page.locator('.cm-line').filter({ hasText: /^After$/ }).click();
	await page.keyboard.press('End');
	await page.locator('.mlp-copy-code-btn').click();
	await expect(page.locator('.cm-content')).toBeFocused();
	await pasteAtFocus(page, ' replacement');
	expect(await source(page)).toBe(doc + ' replacement');
});

test('locking a source caret still blocks focused external paste after a click back into prose', async ({ page }) => {
	const doc = 'Retained text';
	await mountEditor(page, doc);
	await page.locator('.mlp-editing-mode-toggle').click();
	await page.locator('.cm-line').click();
	await pasteAtFocus(page, 'Must not insert');
	expect(await source(page)).toBe(doc);
	await expect(page.locator('.mlp-editing-mode-toggle')).toHaveAttribute('aria-pressed', 'true');
});
