import { expect, test, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const table = '| Status | Next step |\n| --- | --- |\n| Pending | <ul><li>First</li><li>Second</li></ul> |';
const longCode = '```ts\n' + Array.from({ length: 12 }, (_, n) => `const value${n} = ${n};`).join('\n') + '\n```';

async function source(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate(element => (element as any).cmTile.root.view.state.doc.toString());
}

// These fixtures stay in their ClipboardEvent; native app QA owns the OS clipboard.
async function paste(page: Page, values: Record<string, string>): Promise<boolean> {
	return page.evaluate(entries => {
		const data = new DataTransfer();
		for (const [type, value] of Object.entries(entries)) data.setData(type, value);
		const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data });
		document.activeElement!.dispatchEvent(event);
		return event.defaultPrevented;
	}, values);
}

async function selectDocument(page: Page): Promise<void> {
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+a`);
}

test.beforeEach(({ page }) => {
	page.on('pageerror', error => { throw error; });
	page.on('console', message => {
		if (/CodeMirror plugin crashed/.test(message.text())) throw new Error(message.text());
	});
});

for (const first of ['Meeting notes, copied from a report.', '# Findings, evidence, and follow-up']) {
	test(`a large external note is not rejected as a spreadsheet after ${JSON.stringify(first)}`, async ({ page }) => {
		const value = first + '\n\n' + Array.from({ length: 1_200 }, (_, n) =>
			`## Section ${n}\n\nReviewed evidence for this item. ${'Preserve the original external note and its complete source. '.repeat(4)}\n\n- Follow up on this finding.\n\n`).join('');
		expect(new TextEncoder().encode(value).length).toBeGreaterThan(256 * 1024);
		expect(new TextEncoder().encode(value).length).toBeLessThan(1024 * 1024);
		await mountEditor(page, 'Replace the selected draft');
		await selectDocument(page);
		await paste(page, { 'text/plain': value, 'text/html': '<article>Alternate rich representation</article>' });
		await expect.poll(async () => (await source(page)).length).toBe(value.length);
		expect(await source(page)).toBe(value);
		await expect(page.locator('#mlp-spreadsheet-paste-warning')).not.toBeVisible();
	});
}

test('large comma-leading prose is not subject to the grid byte limit', async ({ page }) => {
	const value = 'Research summary, prepared for review.\n\n' + 'This is ordinary paragraph text copied from a lengthy external document.\n'.repeat(4_100);
	await mountEditor(page, 'Replace this draft');
	await selectDocument(page);
	await paste(page, { 'text/plain': value });
	await expect.poll(async () => (await source(page)).length).toBe(value.length);
	expect(await source(page)).toBe(value);
});

test('comma-leading prose with many short lines is not rejected by the spreadsheet row limit', async ({ page }) => {
	const value = 'Summary, copied from an external report.\n' + 'One ordinary paragraph per line.\n'.repeat(1_100);
	expect(new TextEncoder().encode(value).length).toBeLessThan(256 * 1024);
	await mountEditor(page, 'Replace this draft');
	await selectDocument(page);
	await paste(page, { 'text/plain': value });
	await expect.poll(async () => (await source(page)).length).toBe(value.length);
	expect(await source(page)).toBe(value);
});

for (const [name, value] of [
	['oversized plain TSV', 'Left\tRight\n' + 'a'.repeat(140_000) + '\t' + 'b'.repeat(140_000)],
	['oversized plain CSV', 'Left,Right\n' + 'a'.repeat(140_000) + ',' + 'b'.repeat(140_000)],
	['long opening paragraph', 'Summary, ' + 'This opening paragraph exceeds a bounded format-detection prefix. '.repeat(100)
		+ '\n\n# Report details\n\n' + 'Retain this ordinary report paragraph exactly.\n\n'.repeat(6_000)],
	['auto table output expansion', 'A\tB\n' + '!'.repeat(131_069) + '\t' + '!'.repeat(131_069)],
] as const) {
	test(`${name} falls back to complete literal text when automatic table conversion cannot fit safely`, async ({ page }) => {
		const size = new TextEncoder().encode(value).length;
		expect(size).toBeLessThan(1024 * 1024);
		if (name === 'auto table output expansion') expect(size).toBeLessThanOrEqual(256 * 1024);
		else expect(size).toBeGreaterThan(256 * 1024);
		await mountEditor(page, 'Replace this entire draft');
		await selectDocument(page);
		await paste(page, { 'text/plain': value });
		await expect.poll(async () => (await source(page)).length).toBe(value.length);
		expect(await source(page)).toBe(value);
		await expect(page.locator('.mlp-table')).toHaveCount(0);
		await expect(page.locator('#mlp-spreadsheet-paste-warning')).not.toBeVisible();
	});
}

for (const mime of ['text/plain', 'text/uri-list']) {
	test(`an empty advertised ${mime} representation cannot erase a selected table draft`, async ({ page }) => {
		const doc = 'Before\n\n' + table + '\n\nAfter';
		await mountEditor(page, doc);
		await page.locator('.mlp-table td').first().click();
		await page.keyboard.press(`${mod}+a`);
		await page.keyboard.type('Retain selected draft');
		await page.keyboard.press(`${mod}+a`);
		await paste(page, { [mime]: '', 'text/html': '<b>Unavailable plain representation</b>' });
		await expect(page.locator('.mlp-table-cell-editing')).toHaveText('Retain selected draft');
		await expect(page.locator('#mlp-spreadsheet-paste-warning')).toBeVisible();
		await paste(page, { 'text/plain': 'Retry safely' });
		await page.keyboard.press('Enter');
		expect(await source(page)).toBe(doc.replace('Pending', 'Retry safely'));
	});
}

for (const empty of ['', '\n\n']) {
	test(`external rich Markdown pastes into an ${empty ? 'all-blank' : 'empty'} document and accepts immediate typing`, async ({ page }) => {
		const value = '# External report\n\n- First finding\n- Second finding\n\n' + table + '\n\nTail';
		await mountEditor(page, empty);
		await selectDocument(page);
		await paste(page, { 'text/plain': value, 'text/html': '<h1>External report</h1><ul><li>First finding</li></ul>' });
		await page.keyboard.type(' appended');
		expect(await source(page)).toBe(value + ' appended');
	});
}

test('pasting over a whole document containing collapsed objects replaces exactly the selected source', async ({ page }) => {
	const doc = 'Before\n\n> [!warning]- Folded warning\n> Hidden content\n\n' + longCode + '\n\n' + table + '\n\nAfter';
	await mountEditor(page, doc);
	await page.getByRole('button', { name: /Collapse code block/ }).click();
	await selectDocument(page);
	const replacement = '# Replacement\n\nA completely new report with 🙂 and cafe\u0301.';
	await paste(page, { 'text/plain': replacement, 'text/html': '<h1>Replacement</h1>' });
	await page.keyboard.type(' END');
	expect(await source(page)).toBe(replacement + ' END');
});

test('repeated small external pastes preserve the focused list position and next typed character', async ({ page }) => {
	const doc = '# Notes\n\n- Parent\n  - Child\n\nAfter';
	await mountEditor(page, doc);
	await postToWebview(page, { type: 'jumpToLine', line: 4 });
	await page.keyboard.press('End');
	let expected = doc;
	for (let n = 0; n < 15; n++) {
		const value = ` [${n}:🙂]`;
		await paste(page, { 'text/plain': value, 'text/html': '<b>Different rich text</b>' });
		await page.keyboard.type('x');
		expected = expected.replace('\n\nAfter', value + 'x\n\nAfter');
		expect(await source(page), `paste ${n}`).toBe(expected);
	}
});

for (const block of [
	{ name: 'callout', source: '> [!note] Evidence\n> Replace me\n> Keep the following line', line: 4, start: 2 },
	{ name: 'task', source: '- [x] Replace me\n- [ ] Keep the following task', line: 3, start: 6 },
	{ name: 'fenced source', source: '```text\nReplace me\n```', line: 4, start: 0 },
] as const) {
	test(`external selected-text replacement stays inside ${block.name} and preserves adjacent objects`, async ({ page }) => {
		const doc = 'Before\n\n' + block.source + '\n\n' + table + '\n\nAfter';
		await mountEditor(page, doc);
		await postToWebview(page, { type: 'jumpToLine', line: block.line });
		for (let n = 0; n < block.start; n++) await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Shift+End');
		await paste(page, { 'text/plain': 'Pasted from another app 🙂', 'text/html': '<strong>Unrelated HTML</strong>' });
		await page.keyboard.type('!');
		expect(await source(page)).toBe(doc.replace('Replace me', 'Pasted from another app 🙂!'));
	});
}

test('editing a table list source accepts mixed-format paste and keeps the neighboring cell', async ({ page }) => {
	const doc = 'Before\n\n' + table + '\n\nAfter';
	await mountEditor(page, doc);
	await page.locator('.mlp-table td').nth(1).click();
	await page.keyboard.press(`${mod}+a`);
	const value = '<ul><li>Revised from app</li><li>🙂 Next step</li></ul>';
	await paste(page, { 'text/plain': value, 'text/html': '<ul><li>Revised from app</li><li>🙂 Next step</li></ul>' });
	await page.keyboard.press('Enter');
	expect(await source(page)).toBe(doc.replace('<ul><li>First</li><li>Second</li></ul>', value));
	await expect(page.locator('.mlp-table td').nth(1).locator('li')).toHaveText(['Revised from app', '🙂 Next step']);
});

test('switching from table source back to prose routes successive external pastes to each selected range', async ({ page }) => {
	const doc = 'Before\n\n' + table + '\n\nAfter';
	await mountEditor(page, doc);
	await page.locator('.mlp-table-wrap .mlp-code-mode-btn').click();
	await page.keyboard.press('Home');
	await page.keyboard.press('Shift+End');
	await paste(page, { 'text/plain': '| State | Follow-up |' });
	await postToWebview(page, { type: 'jumpToLine', line: 7 });
	await page.keyboard.press('Shift+End');
	await paste(page, { 'text/plain': 'New conclusion' });
	expect(await source(page)).toBe(doc.replace('| Status | Next step |', '| State | Follow-up |').replace('After', 'New conclusion'));
});

test('rejected rich-only paste preserves an in-progress table draft and its selection for retry', async ({ page }) => {
	const doc = 'Before\n\n' + table + '\n\nAfter';
	await mountEditor(page, doc);
	await page.locator('.mlp-table td').first().click();
	await page.keyboard.press(`${mod}+a`);
	await page.keyboard.type('Uncommitted draft');
	await page.keyboard.press(`${mod}+a`);
	await paste(page, { 'text/html': '<b>Rich-only data</b>' });
	await expect(page.locator('.mlp-table-cell-editing')).toHaveText('Uncommitted draft');
	await expect(page.locator('#mlp-spreadsheet-paste-warning')).toBeVisible();
	await paste(page, { 'text/plain': 'Plain retry' });
	await page.keyboard.press('Enter');
	expect(await source(page)).toBe(doc.replace('Pending', 'Plain retry'));
});

test('lock after editing a cell prevents rich mixed-format paste and unlocking permits the next paste', async ({ page }) => {
	const doc = 'Before\n\n' + table + '\n\nAfter';
	await mountEditor(page, doc);
	await page.locator('.mlp-table td').first().click();
	await page.keyboard.press(`${mod}+a`);
	await page.keyboard.type('Committed draft');
	await page.locator('.mlp-editing-mode-toggle').click();
	await page.locator('.mlp-table td').first().focus();
	await paste(page, { 'text/plain': 'Do not insert', 'text/html': '<b>Do not insert</b>' });
	expect(await source(page)).toBe(doc.replace('Pending', 'Committed draft'));
	await page.locator('.mlp-editing-mode-toggle').click();
	await page.locator('.mlp-table td').first().click();
	await page.keyboard.press(`${mod}+a`);
	await paste(page, { 'text/plain': 'Allowed after unlocking' });
	await page.keyboard.press('Enter');
	expect(await source(page)).toBe(doc.replace('Pending', 'Allowed after unlocking'));
});

test('mouse unlocking restores the source caret for paste and an immediate leading space', async ({ page }) => {
	const doc = 'Keep this paragraph';
	await mountEditor(page, doc);
	await page.locator('.cm-line').click();
	await page.keyboard.press('End');
	const toggle = page.locator('.mlp-editing-mode-toggle');
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	await expect(page.locator('.cm-content')).toBeFocused();
	await paste(page, { 'text/plain': ' from another app' });
	await page.keyboard.type(' Continue taking notes.');
	expect(await source(page)).toBe(doc + ' from another app Continue taking notes.');
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('unlocking retains the selected replacement range instead of pasting at another caret', async ({ page }) => {
	const doc = 'Before\nReplace this line\nAfter';
	await mountEditor(page, doc);
	await postToWebview(page, { type: 'jumpToLine', line: 2 });
	await page.keyboard.press('Shift+End');
	const toggle = page.locator('.mlp-editing-mode-toggle');
	await toggle.click();
	await toggle.click();
	await expect(page.locator('.cm-content')).toBeFocused();
	await paste(page, { 'text/plain': 'External replacement' });
	await page.keyboard.type(' Continue typing');
	expect(await source(page)).toBe('Before\nExternal replacement Continue typing\nAfter');
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});
