import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { mountEditor, postToWebview } from './harness';

const errors = new Map<Page, string[]>();
test.beforeEach(({ page }) => {
	const found: string[] = [];
	errors.set(page, found);
	page.on('pageerror', error => found.push(error.message));
});
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); errors.delete(page); });

async function source(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate(element => (element as any).cmTile.root.view.state.doc.toString());
}

async function edits(page: Page): Promise<unknown[]> {
	return page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'));
}

const displayUpdates = {
	whitespace: { type: 'setWhitespace', enabled: true },
	stickyHeaders: { type: 'setStickyTableHeaders', enabled: true },
	css: { type: 'applyCss', css: '.cm-content { color: rgb(220, 230, 240); font-size: 17px; }' },
	highlighting: { type: 'codeTokens', blocks: [] },
	vaultIndex: { type: 'vaultNotes', notes: [{ path: 'Other.md', basename: 'Other', aliases: [], headings: [], blockIds: [] }] },
};

for (const field of ['property', 'table'] as const) for (const [change, message] of Object.entries(displayUpdates)) {
	test(`${change} preserves a focused ${field} draft and its partial selection`, async ({ page }) => {
		const original = '---\nowner: Original\n---\n\nBefore\n\n| Name | State |\n| --- | --- |\n| Original | Retained |\n\nAfter';
		await mountEditor(page, original);
		const target = field === 'property'
			? page.getByRole('button', { name: 'Edit owner', exact: true })
			: page.locator('.mlp-table td').first();
		await target.focus(); await page.keyboard.press('F2');
		const input = field === 'property' ? page.getByRole('textbox', { name: 'Edit owner', exact: true }) : target;
		await input.fill('Before selected after');
		await page.keyboard.press('Home');
		for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
		for (let i = 0; i < 8; i++) await page.keyboard.press('Shift+ArrowRight');
		await postToWebview(page, message);
		await expect(input).toBeFocused();
		expect(await source(page)).toBe(original);
		await page.keyboard.insertText('CHANGED');
		await page.keyboard.press('Enter');
		await expect.poll(() => source(page)).toBe(field === 'property'
			? original.replace('owner: Original', 'owner: Before CHANGED after')
			: original.replace('| Original |', '| Before CHANGED after |'));
	});
}

for (const [name, value, edited] of [
	['text', 'Original', 'Changed'], ['number', '12', '34'], ['empty', 'null', 'Now filled'],
	['date', '2026-10-02', '2027-03-04'], ['list', '[one, two]', 'first, second'], ['tags', '[work, next]', '#done, #review'],
] as const) {
	test(`Space activates the ${name} property button and Escape cancels without edits`, async ({ page }) => {
		const original = `---\n${name}: ${value}\n---\n\nBody`;
		await mountEditor(page, original);
		const button = page.getByRole('button', { name: `Edit ${name}`, exact: true });
		await button.focus();
		await page.keyboard.press('Space');
		const input = page.getByRole('textbox', { name: `Edit ${name}`, exact: true });
		await expect(input).toBeFocused();
		await input.fill(edited);
		await input.press('Escape');
		await expect(button).toBeFocused();
		await expect(input).toHaveCount(0);
		expect(await source(page)).toBe(original);
		expect(await edits(page)).toEqual([]);
	});
}

test('a typed Space inside a property editor inserts text without restarting the field', async ({ page }) => {
	await mountEditor(page, '---\nowner: Original\n---\n\nBody');
	await page.getByRole('button', { name: 'Edit owner', exact: true }).focus();
	await page.keyboard.press('F2');
	const input = page.getByRole('textbox', { name: 'Edit owner', exact: true });
	await input.fill('Morgan'); await input.press('End'); await input.press('Space'); await page.keyboard.type('Lee');
	await expect(input).toHaveValue('Morgan Lee');
	await input.press('Enter');
	expect(await source(page)).toBe('---\nowner: Morgan Lee\n---\n\nBody');
});

test('mixed scalar property lists retain strings, nulls, numbers, booleans and Unicode across an unchanged commit', async ({ page }) => {
	const original = '---\nvalues: ["a,b", "", null, 2, false, " café 🧭 ", "[[Note|Q1, launch]]"]\n---\n\nBody';
	await mountEditor(page, original);
	await page.getByRole('button', { name: 'Edit values', exact: true }).click();
	const input = page.getByRole('textbox', { name: 'Edit values', exact: true });
	await expect(input).toBeFocused();
	await input.press('Enter');
	const actual = await source(page);
	expect(parse(actual.slice(4, actual.indexOf('\n---', 4)))).toEqual({ values: ['a,b', '', null, 2, false, ' café 🧭 ', '[[Note|Q1, launch]]'] });
	await expect(page.locator('.mlp-property-link')).toHaveText('Q1, launch');
});

test('a property link edit can be canceled twice without losing the edit or navigation buttons', async ({ page }) => {
	const original = '---\nrelated: "[[Note|Friendly note]]"\n---\n\nBody';
	await mountEditor(page, original);
	for (let attempt = 0; attempt < 2; attempt++) {
		const edit = page.getByRole('button', { name: 'Edit related', exact: true });
		await edit.press('Space');
		const input = page.getByRole('textbox', { name: 'Edit related', exact: true });
		await expect(input).toBeFocused(); await input.fill('Discard'); await input.press('Escape');
		await expect(edit).toBeFocused();
		await page.getByRole('link', { name: 'Friendly note', exact: true }).press('Enter');
	}
	expect(await source(page)).toBe(original);
	expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'openLink').length)).toBe(2);
});

const table = '| Name | Amount | State |\n| --- | ---: | :--- |\n| Zulu | 30 | open |\n| Alpha | 10 | closed |\n| Mike | 20 | review |';
const tableActions: Array<[string, string[][]]> = [
	['Insert row above selected row', [['Zulu', '30', 'open'], ['', '', ''], ['Alpha', '10', 'closed'], ['Mike', '20', 'review']]],
	['Insert row below selected row', [['Zulu', '30', 'open'], ['Alpha', '10', 'closed'], ['', '', ''], ['Mike', '20', 'review']]],
	['Delete selected row', [['Zulu', '30', 'open'], ['Mike', '20', 'review']]],
	['Move selected row up', [['Alpha', '10', 'closed'], ['Zulu', '30', 'open'], ['Mike', '20', 'review']]],
	['Move selected row down', [['Zulu', '30', 'open'], ['Mike', '20', 'review'], ['Alpha', '10', 'closed']]],
	['Insert column left of selected column', [['Zulu', '', '30', 'open'], ['Alpha', '', '10', 'closed'], ['Mike', '', '20', 'review']]],
	['Insert column right of selected column', [['Zulu', '30', '', 'open'], ['Alpha', '10', '', 'closed'], ['Mike', '20', '', 'review']]],
	['Delete selected column', [['Zulu', 'open'], ['Alpha', 'closed'], ['Mike', 'review']]],
	['Move selected column left', [['30', 'Zulu', 'open'], ['10', 'Alpha', 'closed'], ['20', 'Mike', 'review']]],
	['Move selected column right', [['Zulu', 'open', '30'], ['Alpha', 'closed', '10'], ['Mike', 'review', '20']]],
	['Sort rows ascending by selected column', [['Alpha', '10', 'closed'], ['Mike', '20', 'review'], ['Zulu', '30', 'open']]],
	['Sort rows descending by selected column', [['Zulu', '30', 'open'], ['Mike', '20', 'review'], ['Alpha', '10', 'closed']]],
];
for (const [action, expected] of tableActions) test(`keyboard table control: ${action}`, async ({ page }) => {
	await mountEditor(page, `Before\n\n> [!note]+ Inventory\n>\n${table.split('\n').map(line => '> ' + line).join('\n')}\n\nAfter`);
	await page.locator('.mlp-table tbody tr').nth(1).locator('td').nth(1).focus();
	await page.getByRole('button', { name: 'Table options', exact: true }).press('Space');
	const button = page.getByRole('button', { name: action, exact: true });
	await expect(button).toBeEnabled(); await button.press('Enter');
	await expect(page.locator('.mlp-table tbody tr')).toHaveCount(expected.length);
	for (let i = 0; i < expected.length; i++) await expect(page.locator('.mlp-table tbody tr').nth(i).locator('td')).toHaveText(expected[i]);
	const actual = await source(page);
	expect(actual.split('\n').filter(line => line.includes('|')).every(line => line.startsWith('> '))).toBe(true);
	expect(actual.startsWith('Before\n\n> [!note]+ Inventory\n>\n')).toBe(true);
	expect(actual.endsWith('\n\nAfter')).toBe(true);
});

test('column alignment cycles through every state without changing table contents', async ({ page }) => {
	await mountEditor(page, `Before\n\n${table}\n\nAfter`);
	for (const alignment of [':---', ':--:', '---:', '---']) {
		await page.locator('.mlp-table td').first().focus();
		await page.getByRole('button', { name: 'Table options', exact: true }).press('Space');
		await page.getByRole('button', { name: 'Cycle selected column alignment', exact: true }).press('Enter');
		expect((await source(page)).split('\n')[3]).toBe(`| ${alignment} | ---: | :--- |`);
		await expect(page.locator('.mlp-table td')).toHaveText(['Zulu', '30', 'open', 'Alpha', '10', 'closed', 'Mike', '20', 'review']);
	}
});

for (const editingMode of ['editing', 'locked'] as const) test(`code copy failure recovers while folded, resized and ${editingMode}`, async ({ page }) => {
	const code = Array.from({ length: 10 }, (_, i) => `const value${i} = "café 🧭";`).join('\n');
	const original = `Before\n\n> [!example]+ Sample\n> ~~~js\n${code.split('\n').map(line => '> ' + line).join('\n')}\n> ~~~\n\nAfter`;
	await mountEditor(page, original, { editingMode });
	await page.getByRole('button', { name: 'Collapse code block', exact: true }).press('Space');
	await page.setViewportSize({ width: 320, height: 480 });
	const copy = page.getByRole('button', { name: 'Copy code block', exact: true });
	for (const ok of [false, true]) {
		await copy.press('Enter');
		const request = await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'copyCode').at(-1));
		expect(request.text).toBe(code);
		await postToWebview(page, { type: 'copyCodeResult', requestId: request.requestId, ok });
		await expect(copy).toHaveText(ok ? '✓' : '✕');
	}
	await page.getByRole('button', { name: 'Expand code block', exact: true }).press('Enter');
	await page.getByRole('button', { name: 'Sample callout', exact: true }).press('Space');
	await expect(copy).toHaveCount(0);
	await page.getByRole('button', { name: 'Sample callout', exact: true }).press('Enter');
	await expect(copy).toBeVisible();
	expect(await source(page)).toBe(original);
	expect(await edits(page)).toEqual([]);
});

test('locking a focused property commits its Unicode draft once and preserves neighboring objects', async ({ page }) => {
	await mountEditor(page, `---\nowner: Original\n---\n\nBefore\n\n${table}\n\n> [!tip]- Details\n> Keep this.\n\nAfter`);
	await page.getByRole('button', { name: 'Edit owner', exact: true }).focus(); await page.keyboard.press('F2');
	await page.getByRole('textbox', { name: 'Edit owner', exact: true }).fill('Morgan café 🧭');
	await page.getByRole('button', { name: 'Editing: select to lock the editor', exact: true }).click();
	await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
	expect(await source(page)).toContain('owner: Morgan café 🧭');
	await expect(page.getByRole('button', { name: 'Details callout', exact: true })).toHaveAttribute('aria-expanded', 'false');
	await page.getByRole('button', { name: 'Edit owner', exact: true }).focus();
	await page.keyboard.press('Space'); await page.keyboard.press('F2'); await page.keyboard.press('Enter');
	await expect(page.locator('.mlp-property-input')).toHaveCount(0);
	await expect(page.locator('.mlp-table td')).toHaveCount(9);
	await expect.poll(async () => (await edits(page)).length).toBe(1);
});

test('Space on a property button does not scroll a long document', async ({ page }) => {
	await page.setViewportSize({ width: 500, height: 350 });
	await mountEditor(page, '---\nowner: Original\n---\n\n' + Array.from({ length: 80 }, (_, i) => `Paragraph ${i}.\n`).join('\n'));
	await page.getByRole('button', { name: 'Edit owner', exact: true }).focus();
	const before = await page.locator('.cm-scroller').evaluate(element => element.scrollTop);
	await page.keyboard.press('Space');
	await expect(page.getByRole('textbox', { name: 'Edit owner', exact: true })).toBeFocused();
	await expect.poll(() => page.locator('.cm-scroller').evaluate(element => element.scrollTop)).toBe(before);
	await page.keyboard.press('Escape');
	await expect(page.getByRole('button', { name: 'Edit owner', exact: true })).toBeFocused();
	expect(await edits(page)).toEqual([]);
});

const graphModel = (label: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="${label}" vertex="1" parent="1"><mxGeometry x="20" y="20" width="300" height="120" as="geometry"/></mxCell></root></mxGraphModel>`;
for (const kind of ['mermaid', 'drawio'] as const) for (const editingMode of ['editing', 'locked'] as const) {
	test(`${kind} controls survive keyboard activation, pan, theme updates and repeated resize in ${editingMode} mode`, async ({ page }, info) => {
		const diagram = kind === 'mermaid' ? 'flowchart LR\nA[Start review] --> B[Check controls] --> C[Finish review]'
			: `<mxfile><diagram name="One">${graphModel('First page')}</diagram><diagram name="Two">${graphModel('Second page')}</diagram></mxfile>`;
		const original = `Before\n\n> [!note]+ Diagram review\n> \`\`\`${kind}\n${diagram.split('\n').map(line => '> ' + line).join('\n')}\n> \`\`\`\n\nAfter`;
		await mountEditor(page, original, { editingMode });
		const wrap = page.locator('.mlp-mermaid-wrap');
		await expect(wrap.locator('svg')).toBeVisible();
		if (kind === 'drawio') {
			await wrap.getByRole('button', { name: 'Next page', exact: true }).press('Space');
			await expect(wrap.locator('svg')).toContainText('Second page');
			await wrap.getByRole('button', { name: 'Previous page', exact: true }).press('Enter');
			await expect(wrap.locator('svg')).toContainText('First page');
		}
		const canvas = wrap.locator('.mlp-mermaid-canvas');
		for (const width of [320, 1200, 450, 900]) {
			await page.setViewportSize({ width, height: 700 });
			await wrap.getByRole('button', { name: 'Switch to actual size (drag to pan, Ctrl+wheel to zoom)', exact: true }).press('Space');
			await wrap.getByRole('button', { name: 'Zoom in (Ctrl+wheel also works)', exact: true }).press('Enter');
			await expect(canvas).toHaveAttribute('style', /scale\(1.2\)/);
			await wrap.getByRole('button', { name: 'Zoom out', exact: true }).press('Space');
			await expect(canvas).toHaveAttribute('style', /scale\(1\)/);
			const before = await canvas.getAttribute('style');
			await wrap.locator('.mlp-mermaid').scrollIntoViewIfNeeded();
			const box = (await wrap.locator('.mlp-mermaid').boundingBox())!;
			const y = box.y + Math.min(60, box.height / 2);
			await page.mouse.move(box.x + 40, y); await page.mouse.down();
			await page.mouse.move(box.x + 80, y + 10, { steps: 8 }); await page.mouse.up();
			expect(await canvas.getAttribute('style')).not.toBe(before);
			await wrap.locator('.mlp-mermaid').dispatchEvent('wheel', { ctrlKey: true, deltaY: -100 });
			await expect(canvas).toHaveAttribute('style', /scale\(1.1\)/);
			const panned = await canvas.getAttribute('style');
			await page.evaluate(() => {
				document.body.classList.toggle('vscode-dark');
				document.body.classList.toggle('vscode-light');
			});
			await expect(wrap.locator('svg')).toBeVisible();
			await expect(canvas).toHaveAttribute('style', panned!);
			await wrap.getByRole('button', { name: 'Reset the view (fit to width)', exact: true }).press('Enter');
			await expect(canvas).not.toHaveAttribute('style', /scale/);
			await expect(wrap.locator('.mlp-mermaid-native')).toHaveCount(0);
			const controls = await wrap.locator('.mlp-mermaid-toolbar button:visible').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()));
			for (const control of controls) { expect(control.left).toBeGreaterThanOrEqual(0); expect(control.right).toBeLessThanOrEqual(width); }
			if (width === 320) await page.screenshot({ path: info.outputPath(`${kind}-${editingMode}-narrow-controls.png`) });
		}
		await page.getByRole('button', { name: 'Diagram review callout', exact: true }).press('Space');
		await expect(wrap).toHaveCount(0);
		await page.getByRole('button', { name: 'Diagram review callout', exact: true }).press('Enter');
		await expect(wrap.locator('svg')).toBeVisible();
		await wrap.locator('.mlp-code-mode-btn').press('Space');
		await expect(wrap).toHaveCount(0);
		await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', editingMode === 'editing' ? 'true' : 'false');
		expect(await source(page)).toBe(original);
		expect(await edits(page)).toEqual([]);
	});
}

test('every table option remains visible and focusable at narrow width after repeated resize', async ({ page }, info) => {
	await mountEditor(page, `Before\n\n${table}\n\nAfter`);
	await page.locator('.mlp-table tbody tr').nth(1).locator('td').nth(1).focus();
	await page.getByRole('button', { name: 'Table options', exact: true }).press('Space');
	for (const width of [320, 1000, 380, 680]) {
		await page.setViewportSize({ width, height: 900 });
		for (const button of await page.locator('.mlp-table-toolbar button').all()) {
			await button.scrollIntoViewIfNeeded(); await button.focus();
			await expect(button).toBeFocused();
			const box = (await button.boundingBox())!;
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(width);
		}
		if (width === 320) await page.screenshot({ path: info.outputPath('table-options-narrow.png') });
	}
	expect(await source(page)).toBe(`Before\n\n${table}\n\nAfter`);
	expect(await edits(page)).toEqual([]);
});

for (const field of ['property', 'table'] as const) test(`all bundled themes preserve an active ${field} draft through repeated switches`, async ({ page }, info) => {
	const original = `---\nowner: Original\n---\n\n# Theme handoff\n\n${table}\n\n> [!note]- Folded review\n> Keep folded.\n\nAfter`;
	await mountEditor(page, original);
	const target = field === 'property' ? page.getByRole('button', { name: 'Edit owner', exact: true }) : page.locator('.mlp-table td').first();
	await target.focus(); await page.keyboard.press('F2');
	const input = field === 'property' ? page.getByRole('textbox', { name: 'Edit owner', exact: true }) : target;
	await input.fill('Unicode café 🧭 unfinished');
	await page.keyboard.press('End');
	for (let i = 0; i < 10; i++) await page.keyboard.press('Shift+ArrowLeft');
	for (const theme of ['obsidian-dark', 'github-like', 'vscode', 'obsidian-dark']) {
		await postToWebview(page, { type: 'applyCss', css: readFileSync(join(__dirname, `../../media/sample-styles/${theme}.css`), 'utf8') });
		await expect(input).toBeFocused();
		await expect(page.getByRole('button', { name: 'Folded review callout', exact: true })).toHaveAttribute('aria-expanded', 'false');
		expect(await source(page)).toBe(original);
		if (theme === 'github-like') await page.screenshot({ path: info.outputPath(`${field}-draft-github-like.png`) });
	}
	await page.keyboard.insertText('complete'); await page.keyboard.press('Enter');
	expect(await source(page)).toBe(field === 'property'
		? original.replace('owner: Original', 'owner: Unicode café 🧭 complete')
		: original.replace('| Zulu |', '| Unicode café 🧭 complete |'));
	await expect.poll(async () => (await edits(page)).length).toBe(1);
});

for (const [style, yaml, expected] of [
	['literal', 'summary: |\n  First line.\n  Second café 🧭 line.\n', 'First line.\nSecond café 🧭 line.\n'],
	['literal strip', 'summary: |-\n  First line.\n  Second café 🧭 line.\n', 'First line.\nSecond café 🧭 line.'],
	['quoted escaped', 'summary: "First line.\\nSecond café 🧭 line."\n', 'First line.\nSecond café 🧭 line.'],
] as const) test(`${style} multiline property is not flattened by opening and committing it`, async ({ page }) => {
	const original = `---\n${yaml}owner: Retained\n---\n\nBody`;
	await mountEditor(page, original);
	await page.getByRole('button', { name: 'Edit summary', exact: true }).focus(); await page.keyboard.press('F2');
	const input = page.getByRole('textbox', { name: 'Edit summary', exact: true });
	await input.press('Enter');
	const actual = await source(page);
	expect(parse(actual.slice(4, actual.indexOf('\n---', 4)))).toEqual({ summary: expected, owner: 'Retained' });
});

for (const action of ['Enter', 'Lock', 'Save', 'Cancel', 'Clear'] as const) test(`multiline property ${action} preserves the intended line breaks and neighboring fields`, async ({ page }) => {
	const original = '---\nsummary: |-\n  First line.\n  Second line.\nowner: Retained\n---\n\nBody';
	await mountEditor(page, original);
	await page.getByRole('button', { name: 'Edit summary', exact: true }).focus(); await page.keyboard.press('F2');
	const input = page.getByRole('textbox', { name: 'Edit summary', exact: true });
	await expect(input).toHaveValue('First line.\nSecond line.');
	await input.fill('Edited café 🧭'); await input.press('End'); await input.press('Shift+Enter'); await page.keyboard.type('Added next line.');
	await expect(input).toHaveValue('Edited café 🧭\nAdded next line.');
	if (action === 'Cancel') await input.press('Escape');
	else if (action === 'Lock') await page.getByRole('button', { name: 'Editing: select to lock the editor', exact: true }).click();
	else if (action === 'Save') await input.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
	else {
		if (action === 'Clear') await input.fill('');
		await input.press('Enter');
	}
	const actual = await source(page);
	expect(parse(actual.slice(4, actual.indexOf('\n---', 4)))).toEqual({
		summary: action === 'Cancel' ? 'First line.\nSecond line.' : action === 'Clear' ? '' : 'Edited café 🧭\nAdded next line.', owner: 'Retained',
	});
	if (action === 'Cancel') { expect(actual).toBe(original); expect(await edits(page)).toEqual([]); }
	else await expect.poll(async () => (await edits(page)).length).toBe(1);
	if (action === 'Lock') await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
	if (action === 'Save') await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'save').length)).toBe(1);
});

for (const [yaml, expected] of [['null', null], ['""', ''], ['"First\\rSecond"', 'First\rSecond']] as const) {
	test(`opening and accepting property ${yaml} preserves its original scalar value`, async ({ page }) => {
		await mountEditor(page, `---\nvalue: ${yaml}\n---\n\nBody`);
		await page.getByRole('button', { name: 'Edit value', exact: true }).focus(); await page.keyboard.press('F2');
		await page.getByRole('textbox', { name: 'Edit value', exact: true }).press('Enter');
		const actual = await source(page);
		expect(parse(actual.slice(4, actual.indexOf('\n---', 4)))).toEqual({ value: expected });
	});
}

test('editing a neighboring list value preserves embedded CR and LF in untouched strings', async ({ page }) => {
	await mountEditor(page, '---\nvalues: ["First\\nSecond", "Alpha\\rBravo", "tail"]\n---\n\nBody');
	await page.getByRole('button', { name: 'Edit values', exact: true }).focus(); await page.keyboard.press('F2');
	const input = page.getByRole('textbox', { name: 'Edit values', exact: true });
	await input.press('End');
	for (let i = 0; i < 4; i++) await input.press('Shift+ArrowLeft');
	await page.keyboard.type('edited'); await input.press('Enter');
	const actual = await source(page);
	expect(parse(actual.slice(4, actual.indexOf('\n---', 4)))).toEqual({ values: ['First\nSecond', 'Alpha\rBravo', 'edited'] });
});
