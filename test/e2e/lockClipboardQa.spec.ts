import { expect, test, type Page, type Locator } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const table = '| Item | Count |\n| --- | ---: |\n| Cable | 2 |\n| Adapter | 1 |';
const doc = '---\nowner: Morgan\npublished: false\n---\n\n# Protected report\n\nCopy this retained paragraph.\n\n- [ ] Retain this task\n\n'
	+ table + '\n\n> [!warning]+ Review\n> Retain the warning.\n>\n> - [ ] Retain the nested task\n\n'
	+ '```js\n' + Array.from({ length: 9 }, (_, n) => `const value${n} = ${n};`).join('\n') + '\n```\n\nLast retained paragraph.';

async function source(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate(content => (content as any).cmTile.root.view.state.doc.toString());
}

async function mutations(page: Page): Promise<unknown[]> {
	return page.evaluate(() => (window as any).__posted.filter((entry: any) => ['edit', 'pasteImages', 'undo', 'redo', 'preserveDraft'].includes(entry.type)));
}

// Synthetic clipboard events exercise the shipped handlers without changing
// the system clipboard reserved for the separate native VS Code QA session.
async function clipboard(target: Locator, type: 'copy' | 'cut' | 'paste', text = '', mime = 'text/plain') {
	return target.evaluate((element, input) => {
		const data = new DataTransfer();
		if (input.text) data.setData(input.mime, input.text);
		const event = new ClipboardEvent(input.type, { bubbles: true, cancelable: true, clipboardData: data });
		element.dispatchEvent(event);
		return { prevented: event.defaultPrevented, text: data.getData('text/plain') };
	}, { type, text, mime });
}

test.beforeEach(({ page }) => page.on('pageerror', error => { throw error; }));

test('locked note rejects keyboard mutation and history commands but retains selection and copy', async ({ page }) => {
	await mountEditor(page, doc, { editingMode: 'locked' });
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+a`);
	expect((await clipboard(page.locator('.cm-content'), 'copy')).text).toBe(doc);
	for (const key of ['Backspace', 'Delete', 'Enter', 'Shift+Enter', `${mod}+Enter`, 'Tab', 'Shift+Tab', `${mod}+b`, `${mod}+i`, `${mod}+z`, `${mod}+Shift+z`]) {
		await page.keyboard.press(key);
		expect(await source(page), key).toBe(doc);
	}
	await page.keyboard.type('Blocked text');
	expect((await clipboard(page.locator('.cm-content'), 'cut')).text).toBe(doc);
	expect(await source(page)).toBe(doc);
	expect(await mutations(page)).toEqual([]);
});

for (const mime of ['text/plain', 'text/csv', 'text/tab-separated-values']) test(`locked body and table reject ${mime} paste`, async ({ page }) => {
	await mountEditor(page, doc, { editingMode: 'locked' });
	for (const target of [page.locator('.cm-content'), page.locator('.mlp-table td').first()]) {
		await target.focus();
		await clipboard(target, 'paste', mime === 'text/csv' ? 'A,B\nC,D' : 'A\tB\nC\tD', mime);
		expect(await source(page)).toBe(doc);
	}
	await expect(page.locator('.mlp-table-cell-editing')).toHaveCount(0);
	expect(await mutations(page)).toEqual([]);
});

for (const kind of ['paste', 'drop'] as const) test(`locked ${kind} of images never requests attachment writes`, async ({ page }) => {
	await mountEditor(page, doc, { editingMode: 'locked' });
	await page.locator('.cm-content').evaluate((element, type) => {
		const data = new DataTransfer();
		data.items.add(new File(['PNG test bytes'], 'lock-test.png', { type: 'image/png' }));
		const event = type === 'paste' ? new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
			: new DragEvent('drop', { dataTransfer: data, clientX: 100, clientY: 100, bubbles: true, cancelable: true });
		element.dispatchEvent(event);
	}, kind);
	await page.waitForTimeout(100);
	expect(await source(page)).toBe(doc);
	expect(await mutations(page)).toEqual([]);
});

test('locked text drop is inert and cannot delete the selected source', async ({ page }) => {
	await mountEditor(page, 'Retained first paragraph.\n\nRetained last paragraph.', { editingMode: 'locked' });
	const original = await source(page);
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+a`);
	await page.locator('.cm-line').last().evaluate(element => {
		const data = new DataTransfer(); data.setData('text/plain', 'Dropped replacement');
		const box = element.getBoundingClientRect();
		element.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, clientX: box.left + 8, clientY: box.top + 8 }));
	});
	expect(await source(page)).toBe(original);
	expect(await mutations(page)).toEqual([]);
});

test('mouse-selected locked prose and rendered table text can be copied without cut deleting it', async ({ page }) => {
	await mountEditor(page, 'Retained prose for copying.\n\n' + table + '\n\nEnd.', { editingMode: 'locked' });
	const original = await source(page);
	for (const [target, expected] of [[page.locator('.cm-line').first(), 'Retained'], [page.locator('.mlp-table td').first(), 'Cable']] as const) {
		await target.scrollIntoViewIfNeeded();
		const points = await target.evaluate((element, text) => {
			const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
			let node: Node | null;
			while ((node = walker.nextNode())) {
				const at = node.textContent?.indexOf(text) ?? -1;
				if (at < 0) continue;
				const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + text.length);
				const box = range.getBoundingClientRect();
				return { x: box.left + 1, end: box.right, y: box.top + box.height / 2 };
			}
			throw new Error('Rendered text missing');
		}, expected);
		await page.mouse.move(points.x, points.y); await page.mouse.down();
		await page.mouse.move(points.end, points.y, { steps: 12 }); await page.mouse.up();
		await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(expected);
		expect((await clipboard(target, 'copy')).text).toBe(expected);
		expect((await clipboard(target, 'cut')).text).toBe(expected);
		expect(await source(page)).toBe(original);
	}
	expect(await mutations(page)).toEqual([]);
});

test('locked links remain operable without unlocking the document', async ({ page }) => {
	const original = 'Start\n\n[Retained link](https://example.invalid/report)\n\n| Link |\n| --- |\n| [Table link](local-note.md) |\n\nEnd';
	await mountEditor(page, original, { editingMode: 'locked' });
	await page.locator('.mlp-link', { hasText: 'Retained link' }).click();
	const tableLink = page.locator('.mlp-table .mlp-link');
	await tableLink.focus(); await page.keyboard.press('Enter');
	expect(await page.evaluate(() => (window as any).__posted.filter((entry: any) => entry.type === 'openLink').map((entry: any) => entry.href)))
		.toEqual(['https://example.invalid/report', 'local-note.md']);
	await expect(page.locator('.mlp-editing-mode-toggle')).toHaveAttribute('aria-pressed', 'true');
	expect(await source(page)).toBe(original);
	expect(await mutations(page)).toEqual([]);
});

test('locked task and property controls remain visually consistent after click and keyboard attempts', async ({ page }) => {
	await mountEditor(page, doc, { editingMode: 'locked' });
	for (const checkbox of await page.locator('.mlp-checkbox').all()) {
		await checkbox.click();
		await expect(checkbox).toHaveAttribute('aria-checked', 'false');
		await checkbox.focus();
		await page.keyboard.press('Space');
		await page.keyboard.press('Enter');
		await expect(checkbox).toHaveAttribute('aria-checked', 'false');
	}
	const property = page.locator('.mlp-property-boolean input');
	await property.click();
	await expect(property).not.toBeChecked();
	await page.getByRole('button', { name: 'Edit owner', exact: true }).dblclick();
	await page.keyboard.press('F2');
	await expect(page.locator('.mlp-property-input')).toHaveCount(0);
	expect(await source(page)).toBe(doc);
	expect(await mutations(page)).toEqual([]);
});

test('locked table selection copies exact Markdown while mutation actions are hidden and cut is nonmutating', async ({ page }) => {
	await mountEditor(page, doc, { editingMode: 'locked' });
	await page.locator('.mlp-table td').first().click();
	await page.getByRole('button', { name: 'Table options', exact: true }).click();
	for (const label of ['Insert row below selected row', 'Delete selected row', 'Insert column right of selected column']) {
		const action = page.getByRole('button', { name: label, exact: true, includeHidden: true });
		await expect(action).toBeHidden();
		expect(await source(page)).toBe(doc);
	}
	await page.getByRole('button', { name: 'Select entire table', exact: true }).click();
	expect((await clipboard(page.locator('.mlp-table-wrap'), 'copy')).text).toBe(table);
	expect((await clipboard(page.locator('.mlp-table-wrap'), 'cut')).text).toBe(table);
	await page.keyboard.press('Backspace');
	await page.keyboard.press('Delete');
	await expect(page.locator('.mlp-table td')).toHaveText(['Cable', '2', 'Adapter', '1']);
	expect(await source(page)).toBe(doc);
	expect(await mutations(page)).toEqual([]);
});

test('table mutation controls follow Lock and Edit without hiding source, selection, or scrolling controls', async ({ page }, info) => {
	await mountEditor(page, 'Before\n\n' + table + '\n\nAfter');
	const wrap = page.locator('.mlp-table-wrap');
	const toggle = page.locator('.mlp-editing-mode-toggle');
	for (let cycle = 0; cycle < 2; cycle++) {
		await page.locator('.mlp-table td').first().focus();
		await page.getByRole('button', { name: 'Table options', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Insert row below selected row', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Add a row', exact: true })).toBeVisible();
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-pressed', 'true');
		await page.getByRole('button', { name: 'Table options', exact: true }).click();
		await expect(wrap.locator('.mlp-table-toolbar button:visible')).toHaveCount(1);
		for (const button of await wrap.locator('.mlp-table-mutation-btn, .mlp-table-add-btn').all()) await expect(button).toBeHidden();
		await expect(wrap.locator('.mlp-table-options-hint')).toBeHidden();
		await expect(wrap.locator('.mlp-code-mode-btn')).toBeVisible();
		await expect(wrap.locator('.mlp-table-viewport')).toBeVisible();
		const select = page.getByRole('button', { name: 'Select entire table', exact: true });
		await select.focus();
		for (const key of ['Home', 'End', 'ArrowDown', 'ArrowUp']) {
			await page.keyboard.press(key);
			await expect(select).toBeFocused();
		}
		if (cycle === 0) await page.screenshot({ path: info.outputPath('table-options-locked.png') });
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	}
	expect(await source(page)).toBe('Before\n\n' + table + '\n\nAfter');
	expect(await mutations(page)).toEqual([]);
	await page.locator('.mlp-table td').first().focus();
	await page.getByRole('button', { name: 'Table options', exact: true }).click();
	await page.screenshot({ path: info.outputPath('table-options-unlocked.png') });
});

test('locked source reveal, diagram/code controls and callout folding do not unlock or edit content', async ({ page }, info) => {
	await mountEditor(page, doc + '\n\n```mermaid\nflowchart LR\nA --> B\n```', { editingMode: 'locked' });
	const original = await source(page);
	const callout = page.getByRole('button', { name: 'Review callout', exact: true });
	await callout.click(); await expect(callout).toHaveAttribute('aria-expanded', 'false');
	await callout.click(); await expect(callout).toHaveAttribute('aria-expanded', 'true');
	await page.getByRole('button', { name: 'Collapse code block', exact: true }).first().click();
	await page.locator('.mlp-copy-code-btn').first().click();
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((entry: any) => entry.type === 'copyCode').length)).toBe(1);
	await page.locator('.mlp-table-wrap .mlp-code-mode-btn').click();
	await page.keyboard.press('Backspace');
	await page.keyboard.type('Do not insert into table source');
	await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
	expect(await source(page)).toBe(original);
	expect(await mutations(page)).toEqual([]);
	await page.screenshot({ path: info.outputPath('locked-source.png') });
});

test('locking pending table and property drafts preserves accepted edits before preventing later changes', async ({ page }) => {
	await mountEditor(page, doc);
	await page.locator('.mlp-table td').first().click();
	await page.keyboard.press(`${mod}+a`);
	await page.keyboard.type('Saved replacement');
	await page.locator('.mlp-editing-mode-toggle').click();
	await expect(page.locator('.mlp-editing-mode-toggle')).toHaveAttribute('aria-pressed', 'true');
	expect(await source(page)).toBe(doc.replace('| Cable |', '| Saved replacement |'));
	await page.locator('.mlp-table td').first().dblclick();
	await page.keyboard.type('Must not save');
	expect(await source(page)).toBe(doc.replace('| Cable |', '| Saved replacement |'));
	await page.locator('.mlp-editing-mode-toggle').click();
	await page.getByRole('button', { name: 'Edit owner', exact: true }).dblclick();
	await page.keyboard.type('Saved owner');
	await page.locator('.mlp-editing-mode-toggle').click();
	expect(await source(page)).toBe(doc.replace('| Cable |', '| Saved replacement |').replace('Morgan', 'Saved owner'));
	await expect(page.locator('.mlp-property-input')).toHaveCount(0);
	await expect(page.locator('#mlp-recovery-notice')).toHaveCount(0);
});

test('locked search can find and select but replacement cannot change the note', async ({ page }) => {
	await mountEditor(page, doc, { editingMode: 'locked' });
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+f`);
	await page.locator('.cm-search input[name="search"]').fill('Retain');
	await page.locator('.mlp-search-toggle').click();
	await page.locator('.cm-search input[name="replace"]').fill('Overwrite');
	await page.getByRole('button', { name: 'all', exact: true }).click();
	await page.getByRole('button', { name: 'replace all', exact: true }).click();
	expect(await source(page)).toBe(doc);
	expect(await mutations(page)).toEqual([]);
});

test('locked document accepts an authoritative external update without enabling local edits', async ({ page }) => {
	await mountEditor(page, 'External baseline', { editingMode: 'locked' });
	await postToWebview(page, { type: 'externalUpdate', changes: [{ from: 0, to: 'External baseline'.length, insert: 'External replacement' }], version: 1 });
	await expect.poll(() => source(page)).toBe('External replacement');
	await page.locator('.cm-content').focus();
	await page.keyboard.type('Local attempt');
	expect(await source(page)).toBe('External replacement');
	await expect(page.locator('.mlp-editing-mode-toggle')).toHaveAttribute('aria-pressed', 'true');
	expect(await mutations(page)).toEqual([]);
});
