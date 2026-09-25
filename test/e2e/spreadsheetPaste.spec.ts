import { expect, test, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Exercise the same DOM paste boundary as the browser, including MIME priority. */
async function paste(page: Page, values: Record<string, string>, selector = '.cm-content'): Promise<void> {
	await page.locator(selector).evaluate((element, entries) => {
		const transfer = new DataTransfer();
		for (const [type, value] of Object.entries(entries)) transfer.setData(type, value);
		element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
	}, values);
}

async function sourceAfterEdits(page: Page, original: string): Promise<string> {
	return page.evaluate(source => {
		let result = source.replace(/\r\n/g, '\n');
		for (const message of (window as any).__posted) {
			if (message.type !== 'edit') continue;
			for (const change of [...message.changes].reverse()) result = result.slice(0, change.from) + change.insert + result.slice(change.to);
		}
		return result;
	}, original);
}

async function selectAll(page: Page): Promise<void> {
	await page.locator('.cm-content').click();
	await page.keyboard.press(`${modifier}+a`);
}

async function renderAwayFromSelection(page: Page): Promise<void> {
	await postToWebview(page, { type: 'jumpToLine', line: 1 });
}

for (const [name, clipboard] of [
	['Excel TSV', 'Name\tQuantity\r\nApples\t3\r\nPears\t7\r\n'],
	['quoted CSV', 'Name,Quantity\r\n"Apples",3\r\n"Pears",7\r\n'],
] as const) {
	test(`${name} replaces a selected paragraph with a real Markdown table in one edit`, async ({ page }) => {
		const original = 'Replace this paragraph';
		await mountEditor(page, original);
		await selectAll(page);
		await paste(page, { 'text/plain': clipboard });
		const expected = '| Name | Quantity |\n| --- | --- |\n| Apples | 3 |\n| Pears | 7 |\n\n';
		await expect.poll(() => sourceAfterEdits(page, original)).toBe(expected);
		await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit').length)).toBe(1);
		await page.keyboard.press(`${modifier}+z`);
		await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'undo').length)).toBe(1);
	});
}

test('TSV inserted between paragraphs preserves both neighbors and renders the first record as headings', async ({ page }) => {
	const original = 'Before\n\n\n\nAfter';
	await mountEditor(page, original);
	await postToWebview(page, { type: 'jumpToLine', line: 3 });
	await paste(page, { 'text/plain': 'Product\tCount\nCaf\u00e9\t12\n\u{1F642}\t0' });
	await expect.poll(() => sourceAfterEdits(page, original)).toBe('Before\n\n| Product | Count |\n| --- | --- |\n| Caf\u00e9 | 12 |\n| \u{1F642} | 0 |\n\nAfter');
	await renderAwayFromSelection(page);
	await expect(page.locator('.mlp-table thead th')).toHaveText(['Product', 'Count']);
	await expect(page.locator('.mlp-table tbody td')).toHaveText(['Caf\u00e9', '12', '\u{1F642}', '0']);
});

test('an explicit CSV MIME can create a one-record table and wins over plain text', async ({ page }) => {
	await mountEditor(page, '');
	await page.locator('.cm-content').click();
	await paste(page, { 'text/plain': 'Unrelated plain fallback', 'text/csv': '"One, literal",Two' });
	await expect.poll(() => sourceAfterEdits(page, '')).toBe('| One\\, literal | Two |\n| --- | --- |\n\n');
});

test('quoted CSV embedded commas, doubled quotes, multiline cells, and empty trailing cells keep their values', async ({ page }) => {
	const original = 'Before\n\n\n\nAfter';
	await mountEditor(page, original);
	await postToWebview(page, { type: 'jumpToLine', line: 3 });
	await paste(page, { 'text/plain': 'Name,Notes,Empty\r\n"Acme, Inc.","Said ""hello""\r\nNext line",\r\n' });
	await expect.poll(() => sourceAfterEdits(page, original)).toBe('Before\n\n| Name | Notes | Empty |\n| --- | --- | --- |\n| Acme\\, Inc\\. | Said \\"hello\\"<br>Next line |  |\n\nAfter');
	await renderAwayFromSelection(page);
	await expect(page.locator('.mlp-table td')).toHaveText(['Acme, Inc.', 'Said "hello"Next line', '']);
	await expect(page.locator('.mlp-table td').nth(1).locator('br')).toHaveCount(1);
});

test('spreadsheet boundary spaces, leading zeros, decimals, signs, and formulas remain literal data', async ({ page }) => {
	const original = 'Before\n\n\n\nAfter';
	await mountEditor(page, original);
	await postToWebview(page, { type: 'jumpToLine', line: 3 });
	await paste(page, { 'text/plain': 'Text\tID\tPositive\tFormula\tDecimal\tBlank\n  leading  \t00123\t+1\t=SUM(A1:A2)\t1.50\t' });
	await expect.poll(() => sourceAfterEdits(page, original)).toBe('Before\n\n| Text | ID | Positive | Formula | Decimal | Blank |\n| --- | --- | --- | --- | --- | --- |\n| &#32;&#32;leading&#32;&#32; | 00123 | \\+1 | \\=SUM\\(A1\\:A2\\) | 1\\.50 |  |\n\nAfter');
	await renderAwayFromSelection(page);
	// textContent (not whitespace-normalized matcher text) verifies both spaces.
	expect(await page.locator('.mlp-table td').allTextContents()).toEqual(['  leading  ', '00123', '+1', '=SUM(A1:A2)', '1.50', '']);
});

test('spreadsheet values remain literal and clipboard HTML is never inserted or fetched', async ({ page }) => {
	const requested: string[] = [];
	page.on('request', request => { if (request.url().includes('paste-tracker.invalid')) requested.push(request.url()); });
	const original = 'Before\n\n\n\nAfter';
	await mountEditor(page, original);
	await postToWebview(page, { type: 'jumpToLine', line: 3 });
	const values = ['**not bold**', '[do not run](command:workbench.action.closeWindow)', '<img src="https://paste-tracker.invalid/pixel">', 'left|right', '`not code`', '$not math$', '[[not a link]]', ':smile:'];
	await paste(page, {
		'text/plain': 'Value\tOther\n' + values.map(value => `"${value.replace(/"/g, '""')}"\tSafe`).join('\n'),
		'text/html': '<table><tr><td><img src="https://paste-tracker.invalid/html" onerror="window.__pasteExecuted=true"></td></tr></table>',
	});
	await expect.poll(() => sourceAfterEdits(page, original)).toContain('| Value | Other |');
	await renderAwayFromSelection(page);
	await expect(page.locator('.mlp-table tbody tr td:first-child')).toHaveText(values);
	await expect(page.locator('.mlp-table a, .mlp-table img, .mlp-table strong, .mlp-table code, .mlp-table .katex')).toHaveCount(0);
	expect(await page.evaluate(() => (window as any).__pasteExecuted)).toBeUndefined();
	expect(requested).toEqual([]);
});

test('pasting into an existing cell fills and expands a rectangle without retitling headers or erasing neighbors', async ({ page }) => {
	const original = 'Before\n\n| A | B | C |\n| :--- | :--: | ---: |\n| Keep first | Old B | Old C |\n| Keep second | Old 2B | Old 2C |\n\nAfter';
	await mountEditor(page, original);
	const cell = page.locator('.mlp-table tbody tr').first().locator('td').nth(1);
	await cell.click();
	await expect(cell).toHaveAttribute('contenteditable', 'true');
	await paste(page, { 'text/plain': 'New B\tNew C\tNew D\nSecond B\tSecond C\tSecond D\nThird B\tThird C\tThird D' }, '.mlp-table td[contenteditable="true"]');
	const expected = 'Before\n\n| A | B | C |  |\n| :--- | :--: | ---: | --- |\n| Keep first | New B | New C | New D |\n| Keep second | Second B | Second C | Second D |\n|  | Third B | Third C | Third D |\n\nAfter';
	await expect.poll(() => sourceAfterEdits(page, original)).toBe(expected);
	await expect(page.locator('.mlp-table thead th')).toHaveText(['A', 'B', 'C', '']);
	await expect(page.locator('.mlp-table tbody tr')).toHaveCount(3);
	await expect(page.locator('.mlp-table td').last()).toHaveText('Third D');
});

test('header-cell paste replaces only its rectangle and preserves existing alignment', async ({ page }) => {
	const original = 'Before\n\n| A | B | C |\n| :--- | :--: | ---: |\n| Alpha | Bravo | Charlie |\n\nAfter';
	await mountEditor(page, original);
	await page.locator('.mlp-table th').nth(1).click();
	await paste(page, { 'text/plain': 'New B\tNew C\nNew Bravo\tNew Charlie' }, '.mlp-table th[contenteditable="true"]');
	await expect.poll(() => sourceAfterEdits(page, original)).toBe('Before\n\n| A | New B | New C |\n| :--- | :--: | ---: |\n| Alpha | New Bravo | New Charlie |\n\nAfter');
});

test('a table nested in a callout retains its quote prefix when spreadsheet paste expands it', async ({ page }) => {
	const original = 'Before\n\n> [!note] Inventory\n>\n> | A | B |\n> | :--- | ---: |\n> | Keep | Old |\n\nAfter';
	await mountEditor(page, original);
	await page.locator('.mlp-table td').nth(1).click();
	await paste(page, { 'text/plain': 'New\tAdded\nNext\tLast' }, '.mlp-table td[contenteditable="true"]');
	await expect.poll(() => sourceAfterEdits(page, original)).toBe('Before\n\n> [!note] Inventory\n>\n> | A | B |  |\n> | :--- | ---: | --- |\n> | Keep | New | Added |\n> |  | Next | Last |\n\nAfter');
	await expect(page.locator('.mlp-table td').last()).toHaveText('Last');
	await expect(page.getByRole('button', { name: 'Inventory callout', exact: true })).toBeVisible();
});

test('a list-nested table keeps its indentation and the following sibling list item', async ({ page }) => {
	const original = 'Before\n\n- Inventory\n\n  | A | B |\n  | --- | --- |\n  | Keep | Old |\n\n- Following item\n\nAfter';
	await mountEditor(page, original);
	await page.locator('.mlp-table td').nth(1).click();
	await paste(page, { 'text/plain': 'New\tAdded\nNext\tLast' }, '.mlp-table td[contenteditable="true"]');
	await expect.poll(() => sourceAfterEdits(page, original)).toBe('Before\n\n- Inventory\n\n  | A | B |  |\n  | --- | --- | --- |\n  | Keep | New | Added |\n  |  | Next | Last |\n\n- Following item\n\nAfter');
});

test('a single literal value pasted into a cell replaces the selection without creating a grid or importing HTML', async ({ page }) => {
	const original = 'Before\n\n| A | B |\n| --- | --- |\n| Original | Neighbor |\n\nAfter';
	await mountEditor(page, original);
	const cell = page.locator('.mlp-table td').first();
	await cell.click();
	await page.keyboard.press(`${modifier}+a`);
	await paste(page, { 'text/plain': 'Plain replacement', 'text/html': '<b>Wrong HTML</b>' }, '.mlp-table td[contenteditable="true"]');
	await expect(cell).toHaveText('Plain replacement');
	await expect(cell.locator('b, strong')).toHaveCount(0);
	await page.keyboard.press('Enter');
	await expect.poll(() => sourceAfterEdits(page, original)).toBe(original.replace('Original', 'Plain replacement'));
	await expect(page.locator('.mlp-table td')).toHaveCount(2);
});

for (const clipboard of ['ordinary text', 'A single, ordinary sentence', 'Name,Value\nOnly one field']) {
	test(`nonrectangular or ordinary clipboard text stays plain: ${JSON.stringify(clipboard)}`, async ({ page }) => {
		await mountEditor(page, '');
		await page.locator('.cm-content').click();
		await paste(page, { 'text/plain': clipboard });
		await expect.poll(() => sourceAfterEdits(page, '')).toBe(clipboard);
		await expect(page.locator('.mlp-table')).toHaveCount(0);
	});
}

test('ragged TSV pads absent values without dropping the trailing empty column', async ({ page }) => {
	await mountEditor(page, '');
	await page.locator('.cm-content').click();
	await paste(page, { 'text/plain': 'A\tB\tC\nOne\tTwo\nThree\t\n' });
	await expect.poll(() => sourceAfterEdits(page, '')).toBe('| A | B | C |\n| --- | --- | --- |\n| One | Two |  |\n| Three |  |  |\n\n');
});

for (const clipboard of ['Name,Value\n"Unterminated,field', 'A\tB\n"Bad" tail\tOther']) {
	test(`malformed quoted spreadsheet is refused without modifying the note: ${JSON.stringify(clipboard)}`, async ({ page }) => {
		const original = 'Keep this source';
		await mountEditor(page, original);
		await selectAll(page);
		await paste(page, { 'text/plain': clipboard });
		await expect(page.locator('#mlp-spreadsheet-paste-warning')).toBeVisible();
		await expect(page.locator('#mlp-spreadsheet-paste-warning')).toHaveAttribute('role', 'alert');
		expect(await sourceAfterEdits(page, original)).toBe(original);
	});
}

for (const [name, original, line, expected] of [
	['fenced code', 'Before\n\n```text\n\n```\n\nAfter', 4, 'Before\n\n```text\nA\tB\n1\t2\n```\n\nAfter'],
	['frontmatter source', '---\ntitle: Note\n\n---\nBody', 3, '---\ntitle: Note\nA\tB\n1\t2\n---\nBody'],
] as const) {
	test(`spreadsheet-looking text inside ${name} remains plain source`, async ({ page }) => {
		await mountEditor(page, original);
		await postToWebview(page, { type: 'jumpToLine', line });
		await paste(page, { 'text/plain': 'A\tB\n1\t2' });
		await expect.poll(() => sourceAfterEdits(page, original)).toBe(expected);
		await expect(page.locator('.mlp-table')).toHaveCount(0);
	});
}

test('locked documents ignore both body and rendered-cell spreadsheet paste', async ({ page }) => {
	const original = 'Before\n\n| A | B |\n| --- | --- |\n| One | Two |\n\nAfter';
	await mountEditor(page, original, { editingMode: 'locked' });
	await paste(page, { 'text/plain': 'X\tY\n1\t2' });
	await paste(page, { 'text/plain': 'X\tY\n1\t2' }, '.mlp-table td:first-child');
	await expect.poll(() => sourceAfterEdits(page, original)).toBe(original);
	await expect(page.locator('.mlp-table td')).toHaveText(['One', 'Two']);
	expect(await page.evaluate(() => (window as any).__posted.some((message: any) => message.type === 'edit'))).toBe(false);
});

for (const [name, clipboard] of [
	['byte limit', `A\tB\n${'x'.repeat(256 * 1024)}\tEnd`],
	['UTF-8 byte limit', `A\tB\n${'\u{1F642}'.repeat(70_000)}\tEnd`],
	['row limit', Array.from({ length: 1001 }, (_, index) => `Row ${index}\tValue`).join('\n')],
	['column limit', Array.from({ length: 201 }, (_, index) => `Column ${index}`).join('\t')],
	['cell limit', Array.from({ length: 101 }, () => Array(100).fill('x').join('\t')).join('\n')],
] as const) {
	test(`spreadsheet ${name} is refused visibly without changing the selected text`, async ({ page }) => {
		const original = 'This note must remain exactly intact.';
		await mountEditor(page, original);
		await selectAll(page);
		await paste(page, { 'text/plain': clipboard });
		await expect(page.getByRole('alert')).toBeVisible();
		await expect(page.getByRole('alert')).not.toHaveText('');
		expect(await sourceAfterEdits(page, original)).toBe(original);
		expect(await page.evaluate(() => (window as any).__posted.some((message: any) => message.type === 'edit'))).toBe(false);
	});
}

test('an over-limit paste into a cell preserves its uncommitted draft and every table cell', async ({ page }) => {
	const original = 'Before\n\n| A | B |\n| --- | --- |\n| Original | Neighbor |\n\nAfter';
	await mountEditor(page, original);
	const cell = page.locator('.mlp-table td').first();
	await cell.click();
	await page.keyboard.press(`${modifier}+a`);
	await page.keyboard.type('Uncommitted draft');
	await paste(page, { 'text/plain': Array.from({ length: 201 }, () => 'x').join('\t') }, '.mlp-table td[contenteditable="true"]');
	await expect(page.getByRole('alert')).toBeVisible();
	await expect(cell).toHaveText('Uncommitted draft');
	await expect(page.locator('.mlp-table td').last()).toHaveText('Neighbor');
	await page.keyboard.press('Enter');
	await expect.poll(() => sourceAfterEdits(page, original)).toBe(original.replace('Original', 'Uncommitted draft'));
});

test('oversized non-grid cell paste is refused before changing the selected cell or its neighbor', async ({ page }) => {
	const original = 'Before\n\n| A | B |\n| --- | --- |\n| Original | Neighbor |\n\nAfter';
	await mountEditor(page, original);
	const cell = page.locator('.mlp-table td').first();
	await cell.click();
	await page.keyboard.press(`${modifier}+a`);
	await paste(page, { 'text/plain': 'x'.repeat(256 * 1024 + 1) }, '.mlp-table td[contenteditable="true"]');
	await expect(page.locator('#mlp-spreadsheet-paste-warning')).toBeVisible();
	await expect(cell).toHaveText('Original');
	await expect(page.locator('.mlp-table td').last()).toHaveText('Neighbor');
	expect(await sourceAfterEdits(page, original)).toBe(original);
});

test('a clipboard that fits alone cannot grow an existing table beyond the column cap', async ({ page }) => {
	const headings = Array.from({ length: 200 }, (_, index) => `H${index}`);
	const row = (cells: string[]) => `| ${cells.join(' | ')} |`;
	const original = `Before\n\n${row(headings)}\n${row(Array(200).fill('---'))}\n${row(Array(200).fill('Keep'))}\n\nAfter`;
	await mountEditor(page, original);
	const cell = page.locator('.mlp-table td').last();
	await cell.click();
	await paste(page, { 'text/plain': 'New\tOverflow' }, '.mlp-table td[contenteditable="true"]');
	await expect(page.locator('#mlp-spreadsheet-paste-warning')).toBeVisible();
	expect(await sourceAfterEdits(page, original)).toBe(original);
	await expect(page.locator('.mlp-table thead th')).toHaveCount(200);
	await expect(cell).toHaveText('Keep');
});

test('held host acknowledgments keep prior typing, spreadsheet paste, later typing, and Undo in separate ordered operations', async ({ page }) => {
	const original = 'Start ';
	await mountEditor(page, original);
	await page.evaluate(() => { (window as any).__holdEditAck = true; });
	await page.locator('.cm-content').click();
	await page.keyboard.press('End');
	await page.keyboard.type('A');
	const edits = () => page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'));
	const undos = () => page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'undo').length);
	await expect.poll(async () => (await edits()).length).toBe(1);
	await page.keyboard.type('B');
	await paste(page, { 'text/plain': 'Name\tValue\nItem\t42' });
	await page.keyboard.type('C');
	await page.keyboard.press(`${modifier}+z`);
	expect(await edits()).toHaveLength(1);
	expect(await undos()).toBe(0);
	const inserts = ['A', 'B', '\n\n| Name | Value |\n| --- | --- |\n| Item | 42 |\n\n', 'C'];
	for (let index = 0; index < inserts.length; index++) {
		await expect.poll(async () => (await edits()).length).toBe(index + 1);
		const current = (await edits())[index];
		expect(current.baseVersion).toBe(index);
		expect(current.changes.map((change: any) => change.insert).join('')).toBe(inserts[index]);
		expect(await undos()).toBe(0);
		await postToWebview(page, { type: 'ackEdit', version: index + 1 });
	}
	await expect.poll(undos).toBe(1);
	expect(await sourceAfterEdits(page, original)).toBe(original + inserts.join(''));
});

test('hiding immediately after a cell paste publishes the complete edit, checkpoint, and recovery snapshot before acknowledgment', async ({ page }) => {
	const original = 'Before\n\n| A | B |\n| --- | --- |\n| Keep | Old |\n\nAfter';
	await mountEditor(page, original, { currentVaultPath: 'QA/Spreadsheet.md' });
	await page.evaluate(() => { (window as any).__holdEditAck = true; });
	await page.locator('.mlp-table td').nth(1).click();
	await page.locator('.mlp-table td[contenteditable="true"]').evaluate(element => {
		const clipboardData = new DataTransfer();
		clipboardData.setData('text/plain', 'New\tAdded\nNext\tLast');
		element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
		// Same JavaScript turn; no render, host ACK, or save delay before hiding.
		Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
		document.dispatchEvent(new Event('visibilitychange'));
	});
	const expected = 'Before\n\n| A | B |  |\n| --- | --- | --- |\n| Keep | New | Added |\n|  | Next | Last |\n\nAfter';
	expect(await sourceAfterEdits(page, original)).toBe(expected);
	const published = await page.evaluate(() => ({
		messages: (window as any).__posted.filter((message: any) => ['edit', 'checkpoint'].includes(message.type)),
		recovery: (window as any).__webviewState?.recovery,
	}));
	expect(published.messages.map((message: any) => message.type)).toEqual(['edit', 'checkpoint']);
	expect(published.messages[1].text).toBe(expected);
	expect(published.recovery.draftText).toBe(expected);
	expect(published.recovery.currentVaultPath).toBe('QA/Spreadsheet.md');
});
