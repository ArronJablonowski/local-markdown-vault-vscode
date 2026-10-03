import { expect, test, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const errors = new Map<Page, string[]>();

interface InputRecord {
	type: string;
	trusted: boolean;
	prevented: boolean;
	inputType?: string;
	data?: string | null;
	body: boolean;
}

test.beforeEach(({ page }) => {
	const found: string[] = [];
	errors.set(page, found);
	page.on('pageerror', error => found.push(error.message));
});
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); errors.delete(page); });

async function source(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate(element => (element as any).cmTile.root.view.state.doc.toString());
}

async function emittedSource(page: Page, initial: string, start = 0): Promise<string> {
	return page.evaluate(({ text: initial, start }) => {
		let text = initial;
		for (const message of (window as any).__posted.slice(start)) {
			if (message.type !== 'edit') continue;
			for (const change of [...message.changes].reverse()) {
				if (change.from < 0 || change.to < change.from || change.to > text.length) throw new Error('Invalid emitted source range');
				text = text.slice(0, change.from) + change.insert + text.slice(change.to);
			}
		}
		return text;
	}, { text: initial, start });
}

async function recordInput(page: Page): Promise<void> {
	await page.evaluate(() => {
		(window as any).__typingIntegrityEvents = [];
		// Observe at the document bubble boundary, after editor handlers decide
		// whether native DOM insertion is allowed. Never alter the event or text.
		for (const type of ['beforeinput', 'input']) document.addEventListener(type, event => {
			const input = event as InputEvent;
			(window as any).__typingIntegrityEvents.push({ type, trusted: event.isTrusted, prevented: event.defaultPrevented,
				inputType: input.inputType, data: input.data, body: event.target === document.querySelector('.cm-content') });
		});
	});
}

async function records(page: Page): Promise<InputRecord[]> {
	return page.evaluate(() => (window as any).__typingIntegrityEvents);
}

async function focusEnd(page: Page): Promise<void> {
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+End`);
}

async function find(page: Page, text: string): Promise<void> {
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+f`);
	await page.locator('.cm-search input[name="search"]').fill(text);
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	await expect.poll(() => page.locator('.cm-content').evaluate(element => {
		const state = (element as any).cmTile.root.view.state;
		return state.sliceDoc(state.selection.main.from, state.selection.main.to);
	})).toBe(text);
}

test('trusted printable typing uses transactions without native input mutations and emits exact source', async ({ page }) => {
	const initial = 'Retained prefix ';
	await mountEditor(page, initial);
	await focusEnd(page);
	await recordInput(page);
	await page.keyboard.type('Az 019 stable text');
	const expected = initial + 'Az 019 stable text';
	await expect.poll(() => source(page)).toBe(expected);
	await expect.poll(() => emittedSource(page, initial)).toBe(expected);
	const events = await records(page);
	const before = events.filter(event => event.type === 'beforeinput');
	expect(before.map(event => event.data).join('')).toBe('Az 019 stable text');
	expect(before.every(event => event.trusted && event.prevented && event.body && event.inputType === 'insertText')).toBe(true);
	expect(events.filter(event => event.type === 'input')).toEqual([]);
});

for (const backwards of [false, true]) test(`typing replaces an exact ${backwards ? 'backward' : 'forward'} selection once`, async ({ page }) => {
	const initial = 'Before TARGET after';
	await mountEditor(page, initial);
	await find(page, 'TARGET');
	if (backwards) {
		await page.keyboard.press('ArrowRight');
		for (let n = 0; n < 'TARGET'.length; n++) await page.keyboard.press('Shift+ArrowLeft');
	}
	await page.keyboard.type('Replacement');
	await expect.poll(() => source(page)).toBe('Before Replacement after');
	await expect.poll(() => emittedSource(page, initial)).toBe('Before Replacement after');
	expect(await page.locator('.cm-content').evaluate(element => (element as any).cmTile.root.view.state.selection.main.empty)).toBe(true);
});

test('text committed without keydown retains native Unicode insertion and subsequent ordinary typing', async ({ page }) => {
	const initial = 'Before ';
	const committed = 'cafe\u0301 é 👩🏽‍💻 🇺🇳';
	await mountEditor(page, initial);
	await focusEnd(page);
	await recordInput(page);
	await page.keyboard.insertText(committed);
	await expect.poll(() => source(page)).toBe(initial + committed);
	const fallback = await records(page);
	expect(fallback.some(event => event.type === 'input' && event.trusted && event.body)).toBe(true);
	expect(fallback.filter(event => event.type === 'beforeinput').every(event => !event.prevented)).toBe(true);
	await page.keyboard.type(' kept');
	await expect.poll(() => source(page)).toBe(initial + committed + ' kept');
	await expect.poll(() => emittedSource(page, initial)).toBe(initial + committed + ' kept');
});

for (const [name, initial, typed, expected] of [
	['heading spacing', '#', 'Heading', '# Heading'],
	['parenthesis pairing', 'Before ', '(value)', 'Before (value)'],
	['inline code pairing', '', '`value`', '`value`'],
	['fenced code pairing', '', '```ts', '```ts\n\n```'],
] as const) test(`transactional typing preserves the ${name} input handler`, async ({ page }) => {
	await mountEditor(page, initial);
	await focusEnd(page);
	await page.keyboard.type(typed);
	await expect.poll(() => source(page)).toBe(expected);
	await expect.poll(() => emittedSource(page, initial)).toBe(expected);
});

for (const delimiter of ['"', '`', '*']) test(`typing ${delimiter} preserves intentional wrapped selection before replacement`, async ({ page }) => {
	const initial = 'Before TARGET after';
	await mountEditor(page, initial);
	await find(page, 'TARGET');
	await page.keyboard.type(delimiter);
	await expect.poll(() => source(page)).toBe(`Before ${delimiter}TARGET${delimiter} after`);
	expect(await page.locator('.cm-content').evaluate(element => {
		const state = (element as any).cmTile.root.view.state;
		return state.sliceDoc(state.selection.main.from, state.selection.main.to);
	})).toBe('TARGET');
	await page.keyboard.type('Replaced');
	const expected = `Before ${delimiter}Replaced${delimiter} after`;
	await expect.poll(() => source(page)).toBe(expected);
	await expect.poll(() => emittedSource(page, initial)).toBe(expected);
});

test('printable typing replaces every Find All range with exact ordered host changes', async ({ page }) => {
	const initial = 'TOKEN first\nTOKEN second\nTOKEN third';
	await mountEditor(page, initial);
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+f`);
	await page.locator('.cm-search input[name="search"]').fill('TOKEN');
	await page.locator('.cm-search button[name="select"]').click();
	await page.keyboard.press('Escape');
	expect(await page.locator('.cm-content').evaluate(element => (element as any).cmTile.root.view.state.selection.ranges.length)).toBe(3);
	await recordInput(page);
	await page.keyboard.type('Updated');
	const expected = initial.replaceAll('TOKEN', 'Updated');
	await expect.poll(() => source(page)).toBe(expected);
	await expect.poll(() => emittedSource(page, initial)).toBe(expected);
	expect((await records(page)).filter(event => event.type === 'input')).toEqual([]);
	expect(await page.locator('.cm-content').evaluate(element => (element as any).cmTile.root.view.state.selection.ranges.length)).toBe(3);
});

test('locked typing and replacement remain nonmutating without emitting edits', async ({ page }) => {
	const initial = 'Locked source stays exact';
	await mountEditor(page, initial, { editingMode: 'locked' });
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+a`);
	await page.keyboard.type('Blocked replacement');
	await page.keyboard.insertText('Blocked native insertion');
	expect(await source(page)).toBe(initial);
	expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
});

for (const field of ['search', 'property', 'multiline property', 'table'] as const) test(`ordinary typing stays inside the ${field} field`, async ({ page }) => {
	const initial = '---\nowner: Original\nsummary: "First\\nSecond"\n---\n\nBefore\n\n| Name | State |\n| --- | --- |\n| Original | Retained |\n\nAfter';
	await mountEditor(page, initial);
	let input;
	if (field === 'search') {
		await page.locator('.cm-content').focus();
		await page.keyboard.press(`${mod}+f`);
		input = page.locator('.cm-search input[name="search"]');
	} else if (field === 'table') {
		input = page.locator('.mlp-table td').first();
		await input.focus();
		await page.keyboard.press('F2');
	} else {
		const name = field === 'property' ? 'owner' : 'summary';
		await page.getByRole('button', { name: `Edit ${name}`, exact: true }).focus();
		await page.keyboard.press('F2');
		input = page.getByRole('textbox', { name: `Edit ${name}`, exact: true });
	}
	await input.fill('');
	await recordInput(page);
	await page.keyboard.type('Field value');
	if (field === 'table') await expect(input).toHaveText('Field value');
	else await expect(input).toHaveValue('Field value');
	expect(await source(page)).toBe(initial);
	expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	const events = await records(page);
	expect(events.some(event => event.type === 'input' && event.trusted && !event.body)).toBe(true);
	expect(events.filter(event => event.type === 'beforeinput').every(event => !event.prevented)).toBe(true);
	if (field === 'search') await page.keyboard.press('Escape');
	else {
		await page.keyboard.press('Enter');
		const expected = field === 'table' ? initial.replace('| Original |', '| Field value |')
			: field === 'property' ? initial.replace('owner: Original', 'owner: Field value')
				: initial.replace('summary: "First\\nSecond"', 'summary: "Field value"');
		await expect.poll(() => source(page)).toBe(expected);
		await expect.poll(() => emittedSource(page, initial)).toBe(expected);
	}
});

test('held host acknowledgment preserves exact typing order before Undo is requested', async ({ page }) => {
	const initial = 'Keep ';
	await mountEditor(page, initial);
	await focusEnd(page);
	await page.evaluate(() => { (window as any).__holdEditAck = true; });
	await page.keyboard.type('ABC');
	await page.keyboard.press(`${mod}+z`);
	await expect.poll(() => source(page)).toBe(initial + 'ABC');
	let messages = await page.evaluate(() => (window as any).__posted);
	expect(messages.filter((message: any) => message.type === 'edit')).toHaveLength(1);
	expect(messages.filter((message: any) => message.type === 'undo')).toHaveLength(0);
	await postToWebview(page, { type: 'ackEdit', version: 1 });
	await expect.poll(() => emittedSource(page, initial)).toBe(initial + 'ABC');
	messages = await page.evaluate(() => (window as any).__posted);
	expect(messages.filter((message: any) => message.type === 'edit')).toHaveLength(2);
	expect(messages.filter((message: any) => message.type === 'undo')).toHaveLength(0);
	await postToWebview(page, { type: 'ackEdit', version: 2 });
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'undo').length)).toBe(1);
});

test('typing after CRLF initialization emits normalized source offsets', async ({ page }) => {
	const initial = 'Title\r\n\r\nKeep';
	const normalized = initial.replaceAll('\r\n', '\n');
	await mountEditor(page, initial);
	await focusEnd(page);
	await page.keyboard.type(' exact');
	await expect.poll(() => source(page)).toBe(normalized + ' exact');
	await expect.poll(() => emittedSource(page, normalized)).toBe(normalized + ' exact');
});

test('reinitializing the editor replaces listeners without double insertion or stale input state', async ({ page }) => {
	await mountEditor(page, 'Original');
	for (const [index, text] of ['Reset one', 'Reset two'].entries()) {
		await postToWebview(page, { type: 'init', protocolVersion: 1, text, version: index * 100 + 10, css: '', codeTheme: 'dark-plus',
			workspaceTrusted: true, diagramRenderingAllowed: true, editingMode: 'editing', remoteMedia: 'block', vaultNotes: [], currentVaultPath: '' });
		await expect.poll(() => source(page)).toBe(text);
		const start = await page.evaluate(() => (window as any).__posted.length);
		await focusEnd(page);
		await page.keyboard.type(' typed once');
		await expect.poll(() => source(page)).toBe(text + ' typed once');
		await expect.poll(() => emittedSource(page, text, start)).toBe(text + ' typed once');
		await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery)).toBeUndefined();
	}
});

for (const kind of ['untrusted', 'composing', 'noncancelable'] as const) test(`${kind} synthetic input is not intercepted or converted into source edits`, async ({ page }) => {
	const initial = 'Retain source';
	await mountEditor(page, initial);
	await focusEnd(page);
	const result = await page.locator('.cm-content').evaluate((element, kind) => {
		if (kind === 'composing') element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
		// These do not emulate a native IME: they prove that untrusted/passive
		// event dispatch cannot make the mitigation manufacture a document edit.
		const input = new InputEvent('beforeinput', { bubbles: true, cancelable: kind !== 'noncancelable',
			inputType: 'insertText', data: 'UNEXPECTED', isComposing: kind === 'composing' });
		element.dispatchEvent(input);
		if (kind === 'composing') element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
		return { trusted: input.isTrusted, prevented: input.defaultPrevented };
	}, kind);
	expect(result).toEqual({ trusted: false, prevented: false });
	expect(await source(page)).toBe(initial);
	expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
	await page.keyboard.type(' allowed');
	await expect.poll(() => source(page)).toBe(initial + ' allowed');
});
