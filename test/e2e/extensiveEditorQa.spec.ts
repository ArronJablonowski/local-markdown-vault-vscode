import { expect, test, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const errors = new Map<Page, string[]>();

test.use({ actionTimeout: 10000, screenshot: 'only-on-failure' });
test.beforeEach(({ page }) => {
	const found: string[] = [];
	errors.set(page, found);
	page.on('pageerror', error => found.push(error.message));
});
test.afterEach(({ page }) => {
	expect(errors.get(page)).toEqual([]);
	errors.delete(page);
});

async function source(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate(element => (element as any).cmTile.root.view.state.doc.toString());
}

async function emittedSource(page: Page, initial: string): Promise<string> {
	return page.evaluate(text => {
		for (const message of (window as any).__posted) {
			if (message.type !== 'edit') continue;
			for (const change of [...message.changes].reverse()) text = text.slice(0, change.from) + change.insert + text.slice(change.to);
		}
		return text;
	}, initial);
}

async function traceTyping(page: Page): Promise<void> {
	await page.locator('.cm-content').evaluate(element => {
		const view = (element as any).cmTile.root.view;
		const trace: unknown[] = [];
		(window as any).__footerTrace = trace;
		const originalUpdate = view.update.bind(view);
		view.update = (transactions: any[]) => {
			for (const transaction of transactions) trace.push({ kind: 'transaction', changes: transaction.changes.toJSON(), selection: transaction.newSelection.toJSON(), tail: transaction.newDoc.toString().slice(-230) });
			return originalUpdate(transactions);
		};
		for (const event of ['keydown', 'beforeinput', 'input', 'selectionchange']) document.addEventListener(event, (e: any) => {
			const native = window.getSelection();
			trace.push({ kind: event, key: e.key, data: e.data, anchor: native?.anchorOffset, focus: native?.focusOffset, node: native?.focusNode?.textContent, selection: view.state.selection.toJSON() });
		}, true);
	});
}

async function selected(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate(element => {
		const state = (element as any).cmTile.root.view.state;
		return state.sliceDoc(state.selection.main.from, state.selection.main.to);
	});
}

async function find(page: Page, text: string): Promise<void> {
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+f`);
	await page.locator('.cm-search input[name="search"]').fill(text);
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	await expect.poll(() => selected(page)).toBe(text);
}

async function caretVisible(page: Page): Promise<void> {
	await expect.poll(() => page.locator('.cm-content').evaluate(element => {
		const view = (element as any).cmTile.root.view;
		const selection = view.state.selection.main;
		const position = view.coordsAtPos(selection.head, selection.empty ? selection.assoc || 1 : selection.head > selection.anchor ? -1 : 1);
		const viewport = view.scrollDOM.getBoundingClientRect();
		return Boolean(position && position.top >= viewport.top - 3 && position.bottom <= viewport.bottom + 3);
	})).toBe(true);
}

function longPrelude(): string {
	return Array.from({ length: 100 }, (_, index) => `## Earlier section ${index}\n\nA paragraph with **bold**, *emphasis*, a [local link](Other.md), and enough prose to wrap on a narrow screen.\n\n- Earlier entry ${index}\n  - Nested entry\n\n`).join('');
}

const searchObjects = {
	property: '---\nowner: PROPERTY_NEEDLE\ntags: [qa, extensive]\n---\n\nPrelude',
	closedCallout: '> [!warning]- Closed outer\n> Retained paragraph\n>\n> > [!tip]- Closed inner\n> > INNER_NEEDLE\n> > - [ ] Keep task\n>\n> Kept outer tail',
	quotedTable: '> [!info]+ Table wrapper\n>\n> | Name | Detail |\n> | :--- | ---: |\n> | TABLE_NEEDLE | **Keep** |',
	quotedCode: '> [!example]+ Code wrapper\n> ~~~typescript\n> const original = "CODE_NEEDLE";\n> const retained = 42;\n> ~~~',
	mermaid: '```mermaid\nflowchart LR\nA[MERMAID_NEEDLE] --> B[Retain]\n```',
	drawio: '```drawio\n<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="DRAWIO_NEEDLE" vertex="1" parent="1"><mxGeometry x="20" y="20" width="160" height="60" as="geometry"/></mxCell></root></mxGraphModel>\n```',
};

test('Find replaces a phrase inside two initially collapsed callouts without moving subsequent keystrokes', async ({ page }, info) => {
	const initial = `Before\n\n${searchObjects.closedCallout}\n\nEnd`;
	await mountEditor(page, initial);
	await find(page, 'INNER_NEEDLE');
	const trace: unknown[] = [];
	for (const character of 'Revised value') {
		trace.push(await page.locator('.cm-content').evaluate(element => {
			const state = (element as any).cmTile.root.view.state;
			return { selection: state.selection.toJSON(), text: state.doc.toString(), visibleText: element.textContent };
		}));
		await page.keyboard.type(character);
	}
	await info.attach('nested-callout-typing.json', { body: JSON.stringify(trace, null, 2), contentType: 'application/json' });
	await expect.poll(() => source(page)).toBe(initial.replace('INNER_NEEDLE', 'Revised value'));
});

test('Find keeps late-parsed folded ancestors open while immediately replacing text in a megabyte note', async ({ page }) => {
	test.setTimeout(60000);
	const initial = `${longPrelude().repeat(50)}BEFORE_ANCHOR\n\n${searchObjects.closedCallout}\n\nEND_ANCHOR`;
	await mountEditor(page, initial);
	await find(page, 'INNER_NEEDLE');
	await page.keyboard.type('Immediate replacement');
	const expected = initial.replace('INNER_NEEDLE', 'Immediate replacement');
	await expect.poll(() => source(page)).toBe(expected);
	await expect.poll(() => emittedSource(page, initial)).toBe(expected);
	await page.keyboard.type(' stays here');
	await expect.poll(() => source(page)).toBe(initial.replace('INNER_NEEDLE', 'Immediate replacement stays here'));
});

for (const kind of Object.keys(searchObjects) as Array<keyof typeof searchObjects>) {
	test(`Find reveals and edits ${kind} between repeated long-document navigations`, async ({ page }, info) => {
		test.setTimeout(60000);
		await page.setViewportSize({ width: 620, height: 740 });
		const target = searchObjects[kind].match(/[A-Z]+_NEEDLE/)![0];
		const initial = kind === 'property'
			? `${searchObjects[kind]}\n\n${longPrelude()}END_ANCHOR`
			: `${longPrelude()}BEFORE_ANCHOR\n\n${searchObjects[kind]}\n\nEND_ANCHOR`;
		await mountEditor(page, initial, { stickyTableHeaders: true });
		if (kind === 'closedCallout' && process.env.MLP_TRACE_TYPING === '1') await traceTyping(page);
		await find(page, 'END_ANCHOR');
		await find(page, target);
		await caretVisible(page);
		if (kind === 'closedCallout') await info.attach('before-replacement.json', { body: JSON.stringify(await page.locator('.cm-content').evaluate(element => ({
			text: element.textContent,
			selection: (element as any).cmTile.root.view.state.selection.toJSON(),
			headers: Array.from(element.querySelectorAll('.mlp-callout-header')).map(header => ({ text: header.textContent, expanded: header.getAttribute('aria-expanded') })),
		})), null, 2), contentType: 'application/json' });
		await page.keyboard.type('Revised value');
		await expect.poll(() => source(page)).toBe(initial.replace(target, 'Revised value'));
		await expect.poll(() => emittedSource(page, initial)).toBe(initial.replace(target, 'Revised value'));
		await find(page, 'END_ANCHOR');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type(' retained');
		const interim = initial.replace(target, 'Revised value').replace('END_ANCHOR', 'END_ANCHOR retained');
		if (kind === 'closedCallout' && process.env.MLP_TRACE_TYPING === '1' && await source(page) !== interim) console.log('FOOTER_TYPING_TRACE', JSON.stringify(await page.evaluate(() => (window as any).__footerTrace)));
		await expect.poll(() => source(page)).toBe(interim);
		await find(page, 'Revised value');
		await caretVisible(page);
		await page.keyboard.press('Backspace');
		await page.keyboard.type(target);
		await expect.poll(() => source(page)).toBe(initial.replace('END_ANCHOR', 'END_ANCHOR retained'));
	});
}

for (const widget of ['property', 'table'] as const) {
	test(`Find invoked during a ${widget} draft commits it before replacing another object`, async ({ page }) => {
		const initial = '---\nowner: Original owner\n---\n\nStart\n\n| Item | State |\n| --- | --- |\n| Original item | pending |\n\n> [!note]- Hidden details\n> TARGET_IN_CLOSED_CALLOUT\n\nEnd';
		await mountEditor(page, initial);
		await page.evaluate(() => {
			(window as any).__forwardedFind = 0;
			window.addEventListener('keydown', event => {
				if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') (window as any).__forwardedFind++;
			});
		});
		if (widget === 'property') {
			await page.getByRole('button', { name: 'Edit owner', exact: true }).dblclick();
			await page.getByRole('textbox', { name: 'Edit owner', exact: true }).fill('Changed owner');
		} else {
			await page.locator('.mlp-table td').first().focus();
			await page.keyboard.press('F2');
			await page.keyboard.type('Changed item');
		}
		await page.keyboard.press(`${mod}+f`);
		await expect(page.locator('.cm-search input[name="search"]')).toBeFocused();
		expect(await page.evaluate(() => (window as any).__forwardedFind)).toBe(0);
		await page.locator('.cm-search input[name="search"]').fill('TARGET_IN_CLOSED_CALLOUT');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Escape');
		await page.keyboard.type('Changed hidden text');
		const expected = initial.replace(widget === 'property' ? 'Original owner' : 'Original item', widget === 'property' ? 'Changed owner' : 'Changed item')
			.replace('TARGET_IN_CLOSED_CALLOUT', 'Changed hidden text');
		await expect.poll(() => source(page)).toBe(expected);
		await expect.poll(() => emittedSource(page, initial)).toBe(expected);
	});
}

test('regex Replace All updates only the capture-bearing text across properties and folded mixed objects', async ({ page }) => {
	const initial = '---\nowner: TOKEN_01\n---\n\n# TOKEN_02\n\nTOKEN_keep and TOKEN_03.\n\n> [!warning]- TOKEN_04\n> > [!note]- Inner\n> > TOKEN_05\n>\n> | Name | Value |\n> | --- | --- |\n> | TOKEN_06 | Retain |\n\n```text\nTOKEN_07\n```\n\n```mermaid\nflowchart LR\nA[TOKEN_08] --> B[Retain]\n```\n\nEnd';
	await mountEditor(page, initial);
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+f`);
	await page.locator('.cm-search input[name="search"]').fill('TOKEN_(\\d{2})');
	await page.locator('.cm-search label[aria-label="regexp"]').click();
	await page.locator('.mlp-search-toggle').click();
	await page.locator('.cm-search input[name="replace"]').fill('DONE_$1');
	await page.locator('.cm-search button[name="replaceAll"]').click();
	await expect.poll(() => source(page)).toBe(initial.replace(/TOKEN_(\d{2})/g, 'DONE_$1'));
	await page.locator('.cm-search input[name="search"]').focus();
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: 'DONE_04 callout', exact: true }).click();
	await expect(page.locator('.mlp-table td')).toHaveText(['DONE_06', 'Retain']);
	await expect(page.locator('.mlp-mermaid-wrap svg')).toContainText('DONE_08');
});

for (const activation of ['mouse', 'keyboard'] as const) test(`Select All Matches by ${activation} replaces simultaneous ranges in a property, folded callout, table, and diagram`, async ({ page }) => {
	const initial = '---\nowner: REPEATED_TOKEN\n---\n\nStart\n\n> [!note]- Folded\n> REPEATED_TOKEN\n\n| A | B |\n| --- | --- |\n| REPEATED_TOKEN | Keep |\n\n```mermaid\nflowchart LR\nA[REPEATED_TOKEN] --> B[Keep]\n```\n\nEnd';
	await mountEditor(page, initial);
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+f`);
	await page.locator('.cm-search input[name="search"]').fill('REPEATED_TOKEN');
	if (activation === 'mouse') await page.locator('.cm-search button[name="select"]').click();
	else {
		await page.locator('.cm-search button[name="select"]').focus();
		await page.keyboard.press('Enter');
	}
	await page.keyboard.press('Escape');
	await page.keyboard.type('New value');
	await expect.poll(() => source(page)).toBe(initial.replaceAll('REPEATED_TOKEN', 'New value'));
	await expect.poll(() => emittedSource(page, initial)).toBe(initial.replaceAll('REPEATED_TOKEN', 'New value'));
});

test('Find preserves an invalid numeric property draft before revealing its source', async ({ page }) => {
	const initial = '---\npriority: 3\nowner: Original owner\n---\n\nEnd';
	await mountEditor(page, initial);
	await page.getByRole('button', { name: 'Edit priority', exact: true }).dblclick();
	await page.getByRole('textbox', { name: 'Edit priority', exact: true }).fill('retain invalid priority');
	await page.keyboard.press(`${mod}+f`);
	await expect(page.locator('.cm-search input[name="search"]')).toBeFocused();
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((entry: any) => entry.type === 'preserveDraft').at(-1)?.text)).toContain('retain invalid priority');
	const requestId = await page.evaluate(() => (window as any).__posted.filter((entry: any) => entry.type === 'preserveDraft').at(-1).requestId);
	await postToWebview(page, { type: 'draftPreserved', requestId, ok: true });
	await page.locator('.cm-search input[name="search"]').fill('Original owner');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	await page.keyboard.type('Changed owner');
	await expect.poll(() => source(page)).toBe(initial.replace('Original owner', 'Changed owner'));
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((entry: any) => entry.type === 'preserveDraft').map((entry: any) => entry.text).join('\n'))).toContain('retain invalid priority');
});

for (const reverse of [false, true]) {
	test(`cross-object mouse selection ${reverse ? 'upward' : 'downward'} deletes a folded callout, table, and math together`, async ({ page }) => {
		await page.setViewportSize({ width: 800, height: 1000 });
		const block = 'START_SELECTION\n\n> [!warning]- Closed section\n> Invisible body\n> - [ ] Retained only outside selection\n\n| A | B |\n| --- | --- |\n| One | Two |\n\n$$\nx^2+y^2\n$$\n\nEND_SELECTION';
		const prefix = 'Keep before.\n\n';
		const suffix = '\n\nKeep after.';
		await mountEditor(page, prefix + block + suffix);
		await expect(page.locator('.mlp-table')).toBeVisible();
		await expect(page.locator('.mlp-math-block')).toBeVisible();
		const point = async (text: string, end: boolean) => page.locator('.cm-line', { hasText: new RegExp(`^${text}$`) }).evaluate((element, { text, end }) => {
			const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
			let node: Node | null;
			while ((node = walker.nextNode())) {
				const from = node.textContent!.indexOf(text);
				if (from < 0) continue;
				const range = document.createRange();
				range.setStart(node, from); range.setEnd(node, from + text.length);
				const box = range.getBoundingClientRect();
				return { x: end ? box.right : box.left + 0.1, y: box.top + box.height / 2 };
			}
			throw new Error('selection boundary is not drawn');
		}, { text, end });
		const top = await point('START_SELECTION', false);
		const bottom = await point('END_SELECTION', true);
		await page.mouse.move(reverse ? bottom.x : top.x, reverse ? bottom.y : top.y);
		await page.mouse.down();
		await page.mouse.move(reverse ? top.x : bottom.x, reverse ? top.y : bottom.y, { steps: 25 });
		await page.mouse.up();
		await expect.poll(() => selected(page)).toBe(block);
		await page.keyboard.press(reverse ? 'Delete' : 'Backspace');
		await expect.poll(() => source(page)).toBe(prefix + suffix);
		await page.keyboard.type('New paragraph.');
		await expect.poll(() => source(page)).toBe(prefix + 'New paragraph.' + suffix);
		await expect(page.locator('.mlp-callout-header, .mlp-table, .mlp-math-block')).toHaveCount(0);
		await caretVisible(page);
	});
}

for (const key of ['Backspace', 'Delete'] as const) {
	for (const symbol of ['🧑🏽‍💻', 'e\u0301', '🇨🇦']) {
		test(`${key} preserves Unicode boundaries for ${JSON.stringify(symbol)} next to nested task formatting`, async ({ page }) => {
			const initial = `Before\n\n> [!info]+ Tasks\n> - [ ] Parent\n>   - [ ] LEFT${symbol}RIGHT\n\nAfter`;
			await mountEditor(page, initial);
			await find(page, key === 'Backspace' ? 'RIGHT' : 'LEFT');
			await page.keyboard.press(key === 'Backspace' ? 'ArrowLeft' : 'ArrowRight');
			await page.keyboard.press(key);
			// Backward deletion intentionally peels combining accents and emoji
			// modifiers in CodeMirror; forward deletion removes a whole grapheme.
			const remaining = key === 'Backspace' ? symbol === 'e\u0301' ? 'e' : symbol === '🧑🏽‍💻' ? '🧑' : '' : '';
			await expect.poll(() => source(page)).toBe(initial.replace(symbol, remaining));
			await find(page, 'After');
			await page.keyboard.press('ArrowRight');
			await expect(page.locator('.mlp-checkbox')).toHaveCount(2);
		});
	}
}

test('nested quoted tasks retain indentation through Enter, Tab, Shift+Tab, and boundary Backspace', async ({ page }) => {
	const initial = 'Before\n\n> [!note]+ Tasks\n> - [ ] Parent\n>   - [x] Child task\n>   - [ ] Next task\n\nAfter';
	await mountEditor(page, initial);
	await find(page, 'Child task');
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Enter');
	await page.keyboard.type('New child');
	const inserted = initial.replace('>   - [x] Child task\n', '>   - [x] Child task\n>   - [ ] New child\n');
	await expect.poll(() => source(page)).toBe(inserted);
	await page.keyboard.press('Tab');
	await expect.poll(() => source(page)).toBe(inserted.replace('>   - [ ] New child', '>     - [ ] New child'));
	await page.keyboard.press('Shift+Tab');
	await expect.poll(() => source(page)).toBe(inserted);
	await find(page, 'New child');
	await page.keyboard.press('Backspace');
	await page.keyboard.press('Backspace');
	// Markdown's backward command replaces the empty task marker with its
	// equivalent continuation indentation, preserving the nesting level.
	await expect.poll(() => source(page)).toBe(inserted.replace('>   - [ ] New child', '>         '));
});

test('authoritative Undo and Redo preserve the selected object after a table source replacement', async ({ page }) => {
	const initial = 'Start\n\n> [!note]- Folded\n> Hidden task\n\n| A | B |\n| --- | --- |\n| Original | Keep |\n\nEnd';
	await mountEditor(page, initial);
	await find(page, 'Original');
	await page.keyboard.type('Revised');
	const changed = initial.replace('Original', 'Revised');
	await expect.poll(() => source(page)).toBe(changed);
	await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery)).toBeUndefined();
	await page.keyboard.press(`${mod}+z`);
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((entry: any) => entry.type === 'undo').length)).toBe(1);
	const version = await page.evaluate(() => (window as any).__posted.filter((entry: any) => entry.type === 'edit').at(-1).baseVersion + 1);
	const from = initial.indexOf('Original');
	await postToWebview(page, { type: 'externalUpdate', version: version + 1, changes: [{ from, to: from + 'Revised'.length, insert: 'Original' }] });
	await expect.poll(() => source(page)).toBe(initial);
	await page.keyboard.press(`${mod}+Shift+z`);
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((entry: any) => entry.type === 'redo').length)).toBe(1);
	await postToWebview(page, { type: 'externalUpdate', version: version + 2, changes: [{ from, to: from + 'Original'.length, insert: 'Revised' }] });
	await expect.poll(() => source(page)).toBe(changed);
	await find(page, 'End');
	await page.keyboard.press('ArrowRight');
	await expect(page.locator('.mlp-table td')).toHaveText(['Revised', 'Keep']);
	await expect(page.getByRole('button', { name: 'Folded callout', exact: true })).toHaveAttribute('aria-expanded', 'false');
});
