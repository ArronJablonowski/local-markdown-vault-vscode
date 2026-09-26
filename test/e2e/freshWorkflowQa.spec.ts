import { expect, test, type Locator, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
type Edit = { type: string; baseVersion: number; changes: Array<{ from: number; to: number; insert: string }> };
const errors = new Map<Page, string[]>();

test.beforeEach(({ page }) => {
	const found: string[] = [];
	errors.set(page, found);
	page.on('pageerror', error => found.push(error.message));
});
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); errors.delete(page); });

async function sourceAfterEdits(page: Page, original: string): Promise<string> {
	return page.evaluate(initial => {
		let text = initial;
		for (const message of (window as unknown as { __posted: Edit[] }).__posted) {
			if (message.type === 'edit') for (const change of [...message.changes].reverse()) {
				text = text.slice(0, change.from) + change.insert + text.slice(change.to);
			}
		}
		return text;
	}, original);
}

async function clipboard(page: Page, kind: 'copy' | 'cut', selector = '.cm-content'): Promise<string> {
	return page.locator(selector).evaluate((element, type) => {
		const data = new DataTransfer();
		element.dispatchEvent(new ClipboardEvent(type, { clipboardData: data, bubbles: true, cancelable: true }));
		return data.getData('text/plain');
	}, kind);
}

async function allSource(page: Page): Promise<string> {
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${modifier}+a`);
	return clipboard(page, 'copy');
}

async function editCell(page: Page, cell: Locator, value: string): Promise<void> {
	await cell.focus();
	await page.keyboard.press('F2');
	await expect(cell).toHaveAttribute('contenteditable', 'true');
	await page.keyboard.type(value, { delay: 2 });
}

test('typing a fresh handoff preserves formatting shortcuts, list continuation, and a later mouse replacement', async ({ page }) => {
	await mountEditor(page, '');
	await page.locator('.cm-content').click();
	await page.keyboard.type('# Field handoff', { delay: 2 });
	await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
	await page.keyboard.type('Owner: ');
	await page.keyboard.press(`${modifier}+b`);
	await page.keyboard.type('Morgan');
	await page.keyboard.press(`${modifier}+b`);
	await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
	await page.keyboard.type('- Inspect power');
	await page.keyboard.press('Enter');
	await page.keyboard.type('Inspect network');
	await page.keyboard.press('Tab');
	await page.keyboard.press('Shift+Enter');
	await page.keyboard.type('Keep the backup disconnected.');
	await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
	await page.keyboard.type('Final handoff.');
	await expect.poll(() => sourceAfterEdits(page, '')).toMatch(/\n\nFinal handoff\.$/);
	const typed = await sourceAfterEdits(page, '');
	expect(typed).toContain('Owner: **Morgan**');
	expect(typed).toContain('- Inspect power\n  - Inspect network\n    Keep the backup disconnected.');
	expect(typed).toMatch(/\n\nFinal handoff\.$/);
	const line = page.locator('.cm-line').filter({ hasText: /^Final handoff\.$/ });
	await line.dblclick({ position: { x: 15, y: 8 } });
	await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Final');
	expect(await clipboard(page, 'copy')).toBe('Final');
	await page.keyboard.type('Signed');
	await expect.poll(() => sourceAfterEdits(page, '')).toBe(typed.replace('Final handoff.', 'Signed handoff.'));
});

test('locking with a focused unfinished table cell preserves the draft before read-only mode', async ({ page }) => {
	const original = 'Before\n\n| Task | State |\n| :--- | ---: |\n| Original | pending |\n\n- [ ] Confirm handoff\n\nAfter';
	await mountEditor(page, original);
	await editCell(page, page.locator('.mlp-table td').first(), 'Reviewed | approved');
	await page.getByRole('button', { name: 'Editing: select to lock the editor', exact: true }).click();
	await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
	await expect.poll(() => sourceAfterEdits(page, original)).toBe(original.replace('Original', 'Reviewed \\| approved'));
	await expect(page.locator('.mlp-table td').first()).toHaveText('Reviewed | approved');
	await page.getByRole('button', { name: 'Locked: select to edit the document', exact: true }).click();
	await page.locator('.mlp-checkbox').click();
	await expect.poll(() => sourceAfterEdits(page, original)).toBe(original.replace('Original', 'Reviewed \\| approved').replace('[ ]', '[x]'));
});

test('folding an outer callout commits its active nested table draft without erasing neighboring objects', async ({ page }) => {
	const original = 'Before\n\n> [!warning]+ Review gate\n> - [ ] Verify input\n>\n> > [!note]+ Inventory\n> >\n> > | Asset | State |\n> > | --- | --- |\n> > | Original | Keep |\n>\n> Tail inside gate.\n\nAfter';
	await mountEditor(page, original);
	await editCell(page, page.locator('.mlp-table td').first(), 'Edited draft');
	await page.getByRole('button', { name: 'Review gate callout', exact: true }).click();
	await expect(page.locator('.mlp-table')).toHaveCount(0);
	await expect.poll(() => sourceAfterEdits(page, original)).toBe(original.replace('Original', 'Edited draft'));
	await expect(page.getByRole('button', { name: 'Review gate callout', exact: true })).toHaveAttribute('aria-expanded', 'false');
	await page.getByRole('button', { name: 'Review gate callout', exact: true }).click();
	await expect(page.locator('.mlp-table td')).toHaveText(['Edited draft', 'Keep']);
	await expect(page.locator('.mlp-checkbox')).toHaveCount(1);
	await expect(page.locator('.cm-content')).toContainText('Tail inside gate.');
});

test('reordering a quoted table column preserves inline source, alignment, and the selected row', async ({ page }) => {
	const original = 'Before\n\n> [!info] Inventory\n>\n> | Name | Count |\n> | :--- | ---: |\n> | **Beta** | 2 |\n> | [Alpha](#details) | 1 |\n\n# Details\n\nAfter';
	await mountEditor(page, original);
	await page.locator('.mlp-table tbody tr').last().locator('td').last().click();
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: 'Table options', exact: true }).click();
	await page.getByRole('button', { name: 'Move selected column left', exact: true }).click();
	const expected = 'Before\n\n> [!info] Inventory\n>\n> | Count | Name |\n> | ---: | :--- |\n> | 2 | **Beta** |\n> | 1 | [Alpha](#details) |\n\n# Details\n\nAfter';
	await expect.poll(() => sourceAfterEdits(page, original)).toBe(expected);
	await expect(page.locator('.mlp-table thead th')).toHaveText(['Count', 'Name']);
	await expect(page.locator('.mlp-table tbody tr').last().locator('td')).toHaveText(['1', 'Alpha']);
	await page.locator('.mlp-table .mlp-link').click({ modifiers: [modifier] });
	await expect.poll(() => page.evaluate(() => (window as unknown as { __posted: Array<{ type: string; href?: string }> }).__posted
		.filter(message => message.type === 'openLink').at(-1)?.href)).toBe('#details');
});

test('an invalid numeric property remains recoverable while locking and unfolding a neighboring callout', async ({ page }) => {
	const original = '---\npriority: 2\n---\n\n# Review\n\n> [!tip]- Help\n> The original priority must not be destroyed.\n\nAfter';
	await mountEditor(page, original);
	await page.getByRole('button', { name: 'Edit priority', exact: true }).focus();
	await page.keyboard.press('F2');
	await page.getByRole('textbox', { name: 'Edit priority', exact: true }).fill('not-a-number');
	await page.getByRole('button', { name: 'Editing: select to lock the editor', exact: true }).click();
	await page.getByRole('button', { name: 'Help callout', exact: true }).click();
	await expect.poll(() => page.evaluate(() => (window as unknown as { __posted: Array<{ type: string; text?: string }> }).__posted
		.filter(message => message.type === 'preserveDraft').map(message => message.text).join('\n'))).toContain('not-a-number');
	expect(await sourceAfterEdits(page, original)).toBe(original);
	await expect(page.locator('.cm-content')).toContainText('The original priority must not be destroyed.');
});

test('mouse selection can cut Unicode code text, request Undo, and restore the exact original source', async ({ page }) => {
	const original = 'Before\n\n```javascript\nconst label = "caf\u00e9 \u{1F9ED}";\nconsole.log(label);\n```\n\nAfter';
	await mountEditor(page, original);
	const line = page.locator('.cm-line').filter({ hasText: 'const label' });
	const bounds = await line.evaluate(element => {
		const selected = 'caf\u00e9 \u{1F9ED}';
		const text = element.textContent ?? '';
		const start = text.indexOf(selected), end = start + selected.length;
		if (start < 0) throw new Error('the rendered code string is missing');
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		const points: { node: Node; offset: number }[] = [];
		for (const wanted of [start, end]) {
			walker.currentNode = element;
			let total = 0, node: Node | null;
			while ((node = walker.nextNode())) {
				if (wanted <= total + (node.textContent?.length ?? 0)) { points.push({ node, offset: wanted - total }); break; }
				total += node.textContent?.length ?? 0;
			}
		}
		return points.map(point => {
			const range = document.createRange(); range.setStart(point.node, point.offset); range.collapse(true);
			const rect = range.getBoundingClientRect(); return { x: rect.x, y: rect.y + rect.height / 2 };
		});
	});
	await page.mouse.move(bounds[0].x, bounds[0].y); await page.mouse.down();
	await page.mouse.move(bounds[1].x, bounds[1].y, { steps: 12 }); await page.mouse.up();
	await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('caf\u00e9 \u{1F9ED}');
	expect(await clipboard(page, 'copy')).toBe('caf\u00e9 \u{1F9ED}');
	expect(await clipboard(page, 'cut')).toBe('caf\u00e9 \u{1F9ED}');
	const changed = original.replace('caf\u00e9 \u{1F9ED}', '');
	await expect.poll(() => sourceAfterEdits(page, original)).toBe(changed);
	await page.keyboard.press(`${modifier}+z`);
	await expect.poll(() => page.evaluate(() => (window as unknown as { __posted: Array<{ type: string }> }).__posted.at(-1)?.type)).toBe('undo');
	const lastVersion = await page.evaluate(() => (window as unknown as { __posted: Edit[] }).__posted.filter(message => message.type === 'edit').at(-1)!.baseVersion + 1);
	// The browser harness is not VS Code's history service. Return the native
	// Undo response explicitly and verify the renderer, not an invented history.
	await postToWebview(page, { type: 'externalUpdate', version: lastVersion + 1, changes: [{ from: 0, to: changed.length, insert: original }] });
	expect(await allSource(page)).toBe(original);
});

test('quoted tilde-fenced code copies exact indentation while folded and after display settings change', async ({ page }) => {
	const code = ['def review():', '\tprint("first")  ', '    value = 2', '    if value:', '        print(value)', '    return value', '', 'review()'];
	const original = 'Before\n\n> [!example]+ Example\n> ~~~python\n' + code.map(line => '> ' + line).join('\n') + '\n> ~~~\n\nAfter';
	await mountEditor(page, original);
	await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
	await postToWebview(page, { type: 'setWhitespace', enabled: true });
	await postToWebview(page, { type: 'setStickyTableHeaders', enabled: true });
	await page.getByRole('button', { name: 'Copy code block', exact: true }).click();
	await expect.poll(() => page.evaluate(() => (window as unknown as { __posted: Array<{ type: string; text?: string }> }).__posted
		.filter(message => message.type === 'copyCode').at(-1)?.text)).toBe(code.join('\n'));
	await page.getByRole('button', { name: 'Expand code block', exact: true }).click();
	expect(await sourceAfterEdits(page, original)).toBe(original);
});
