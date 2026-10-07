import { expect, test, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const marker = 'PASTE_TARGET';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const grid = 'Name\tValue\nCafé\t🙂';
const prelude = 'Meeting context **retained** with a [reference](https://example.test/).\n\n'.repeat(6000);

// A paste must not depend on whether idle parsing happened to finish first.
// This only holds background work; a bounded synchronous parser can still run.
async function holdIdleParsing(page: Page): Promise<void> {
	await page.evaluate(() => {
		let serial = 0;
		window.requestIdleCallback = () => --serial;
		window.cancelIdleCallback = () => {};
	});
}

async function source(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate(element => (element as any).cmTile.root.view.state.doc.toString());
}

function exact(actual: string, expected: string): void {
	let difference = 0;
	while (difference < Math.min(actual.length, expected.length) && actual[difference] === expected[difference]) difference++;
	expect(actual === expected, JSON.stringify({ difference, actualLength: actual.length, expectedLength: expected.length,
		actual: actual.slice(Math.max(0, difference - 60), difference + 180),
		expected: expected.slice(Math.max(0, difference - 60), difference + 180) })).toBe(true);
}

async function emittedSource(page: Page, original: string): Promise<string> {
	return page.evaluate(initial => {
		let result = initial;
		for (const message of (window as any).__posted) {
			if (message.type !== 'edit') continue;
			for (const change of [...message.changes].reverse()) result = result.slice(0, change.from) + change.insert + result.slice(change.to);
		}
		return result;
	}, original);
}

/** Event-local clipboard only: no browser permission or system clipboard. */
async function selectAndPaste(page: Page, original: string, formats: Record<string, string>, requireCold = true) {
	return page.locator('.cm-content').evaluate((element, args) => {
		const view = (element as any).cmTile.root.view;
		const from = args.original.indexOf(args.marker);
		if (from < 0) throw new Error('Missing paste fixture marker');
		view.dispatch({ selection: { anchor: from, head: from + args.marker.length } });
		view.focus();
		// Test-only inspection confirms this is an actually incomplete tree, not
		// just a large document whose syntax has already become available.
		const language = view.state.values.find((value: any) => value?.tree && value?.context && typeof value.context.treeLen === 'number');
		const parsedTo = language?.context.treeLen;
		if (args.requireCold && !(typeof parsedTo === 'number' && parsedTo < from)) {
			throw new Error(`Fixture was not cold: parsedTo=${parsedTo}, from=${from}`);
		}
		const data = new DataTransfer();
		for (const [type, value] of Object.entries(args.formats)) data.setData(type, value);
		const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
		element.dispatchEvent(event);
		return { parsedTo, from, prevented: event.defaultPrevented };
	}, { original, formats, marker, requireCold });
}

test.beforeEach(({ page }) => {
	page.on('pageerror', error => { throw error; });
});

for (const [name, body] of [
	['backtick fence', `\`\`\`text\n${marker}\n\`\`\``],
	['tilde fence', `~~~text\n${marker}\n~~~`],
	['indented code', `    ${marker}`],
	['inline code', `Literal \`${marker}\` remains source.`],
	['HTML block', `<div>\n${marker}\n</div>`],
	['Markdown table source', `| Left | Right |\n| --- | --- |\n| ${marker} | retained |`],
] as const) {
	test(`cold parse: TSV stays literal inside distant ${name}`, async ({ page }) => {
		await holdIdleParsing(page);
		const original = `${prelude}${body}\n\nRetained footer`;
		await mountEditor(page, original);
		await selectAndPaste(page, original, { 'text/plain': grid });
		const expected = original.replace(marker, grid);
		exact(await source(page), expected);
		await expect.poll(async () => (await emittedSource(page, original)) === expected).toBe(true);
		await expect(page.locator('#mlp-spreadsheet-paste-warning')).toHaveCount(0);
	});
}

test('cold parse: grid-only MIME never deletes or reformats selected fenced source', async ({ page }) => {
	await holdIdleParsing(page);
	const original = `${prelude}\`\`\`text\n${marker}\n\`\`\`\n\nRetained footer`;
	await mountEditor(page, original);
	await selectAndPaste(page, original, { 'text/tab-separated-values': grid });
	exact(await source(page), original);
	await expect(page.locator('#mlp-spreadsheet-paste-warning')).toBeVisible();
	expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
});

test('cold parse: a large frontmatter scalar retains literal tabs and Unicode', async ({ page }) => {
	await holdIdleParsing(page);
	const original = `---\nnotes: |\n${'  Retained meeting notes\n'.repeat(1800)}  ${marker}\n---\n\nBody remains`;
	await mountEditor(page, original);
	await selectAndPaste(page, original, { 'text/plain': grid });
	exact(await source(page), original.replace(marker, grid));
});

for (const [name, original] of [
	['oversized', `---\nsummary: ${'x'.repeat(70_000)}\nnext: ${marker}\n---\n\nBody remains`],
	['unfinished', `---\ntitle: Meeting\nnext: ${marker}`],
] as const) {
	test(`${name} frontmatter source retains literal TSV without guessing a table`, async ({ page }) => {
		await mountEditor(page, original);
		await selectAndPaste(page, original, { 'text/plain': grid }, false);
		exact(await source(page), original.replace(marker, grid));
	});
}

for (const [name, original] of [
	['block HTML comment', `<!--\n${marker}\n-->`],
	['inline HTML comment', `Prose <!-- ${marker} --> retained.`],
	['block processing instruction', `<?process\n${marker}\n?>`],
	['inline processing instruction', `Prose <?process ${marker} ?> retained.`],
	['inline HTML attribute', `Prose <span title="${marker}">retained</span>.`],
] as const) {
	test(`parsed ${name} retains literal TSV`, async ({ page }) => {
		await mountEditor(page, original);
		await selectAndPaste(page, original, { 'text/plain': grid }, false);
		exact(await source(page), original.replace(marker, grid));
	});
}

test('parsed ordinary prose still converts a grid after a literal source paste', async ({ page }) => {
	const original = `\`\`\`text\n${marker}\n\`\`\`\n\nNext paragraph`;
	await mountEditor(page, original);
	await selectAndPaste(page, original, { 'text/plain': grid }, false);
	const literal = original.replace(marker, grid);
	exact(await source(page), literal);
	await postToWebview(page, { type: 'jumpToLine', line: literal.split('\n').length });
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Enter');
	await page.locator('.cm-content').evaluate((element, value) => {
		const data = new DataTransfer();
		data.setData('text/plain', value);
		element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
	}, grid);
	exact(await source(page), literal + '\n\n| Name | Value |\n| --- | --- |\n| Café | 🙂 |\n\n');
});

test('locked cold source refuses both plain and explicit grid clipboard data', async ({ page }) => {
	await holdIdleParsing(page);
	const original = `${prelude}\`\`\`text\n${marker}\n\`\`\``;
	await mountEditor(page, original, { editingMode: 'locked' });
	for (const type of ['text/plain', 'text/tab-separated-values']) {
		await selectAndPaste(page, original, { [type]: grid });
		exact(await source(page), original);
	}
	expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
});

for (const [name, key, literal] of [
	['Control+Shift+V', { ctrlKey: true, shiftKey: true }, true],
	['Meta+Shift+V', { metaKey: true, shiftKey: true }, true],
	['Alt-modified Control+Shift+V', { ctrlKey: true, shiftKey: true, altKey: true }, false],
	['composing Control+Shift+V', { ctrlKey: true, shiftKey: true, isComposing: true }, false],
] as const) {
	test(`${name} has scoped plain-text intent with conflicting clipboard formats`, async ({ page }) => {
		await mountEditor(page, marker);
		await page.locator('.cm-content').focus();
		await page.locator('.cm-content').evaluate((element, options) => {
			element.dispatchEvent(new KeyboardEvent('keydown', { key: 'V', bubbles: true, cancelable: true, ...options }));
		}, key);
		await selectAndPaste(page, marker, { 'text/plain': 'literal fallback', 'text/tab-separated-values': grid }, false);
		exact(await source(page), literal ? 'literal fallback' : '| Name | Value |\n| --- | --- |\n| Café | 🙂 |\n\n');
	});
}

test('a search-field paste cannot reformat a selected source object in the body', async ({ page }) => {
	const original = `\`\`\`text\n${marker}\n\`\`\``;
	await mountEditor(page, original);
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${modifier}+f`);
	const input = page.locator('.cm-search input[name="search"]');
	await input.fill(marker);
	await page.keyboard.press('Enter');
	await input.focus();
	const prevented = await input.evaluate((element, value) => {
		const data = new DataTransfer();
		data.setData('text/tab-separated-values', value);
		const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
		element.dispatchEvent(event);
		return event.defaultPrevented;
	}, grid);
	// Synthetic clipboard events have no browser field insertion default. The
	// contract here is non-interception/non-mutation, not simulated native paste.
	expect(prevented).toBe(false);
	await expect(input).toBeFocused();
	exact(await source(page), original);
	await expect(page.locator('#mlp-spreadsheet-paste-warning')).toHaveCount(0);
});

test('cold literal paste, later typing, locking, and Save retain exact ordered source while acknowledgments wait', async ({ page }) => {
	await holdIdleParsing(page);
	const original = `${prelude}\`\`\`text\n${marker}\n\`\`\`\n\nRetained footer`;
	await mountEditor(page, original, { currentVaultPath: 'QA/Cold clipboard.md' });
	await page.evaluate(() => { (window as any).__holdEditAck = true; });
	await selectAndPaste(page, original, { 'text/plain': grid });
	await page.keyboard.type(' retained', { delay: 4 });
	const expected = original.replace(marker, grid + ' retained');
	exact(await source(page), expected);
	await page.getByRole('button', { name: 'Editing: select to lock the editor', exact: true }).click();
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${modifier}+s`);
	const messages = () => page.evaluate(() => (window as any).__posted.filter((message: any) => ['edit', 'save'].includes(message.type)));
	expect((await messages()).map((message: any) => message.type)).toEqual(['edit']);
	await postToWebview(page, { type: 'ackEdit', version: 1 });
	await expect.poll(async () => (await messages()).length).toBe(2);
	const second = (await messages())[1];
	expect(second.type).toBe('edit');
	expect(second.baseVersion).toBe(1);
	exact(await emittedSource(page, original), expected);
	await postToWebview(page, { type: 'ackEdit', version: 2 });
	await expect.poll(async () => (await messages()).map((message: any) => message.type)).toEqual(['edit', 'edit', 'save']);
	exact(await source(page), expected);
});
