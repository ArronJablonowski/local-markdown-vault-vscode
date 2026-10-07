import { expect, test, type Page } from '@playwright/test';
import { mountEditor, openSearch, postToWebview } from './harness';

const collapseLabel = 'Collapse all collapsible objects';
const expandLabel = 'Expand all collapsible objects';
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const code = (prefix: string, length = 8): string => Array.from({ length }, (_, index) => `${prefix}_${index + 1}();`).join('\n');
const fenced = (prefix: string, length = 8): string => `\`\`\`js\n${code(prefix, length)}\n\`\`\``;

async function source(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate(content => (content as any).cmTile.root.view.state.doc.toString());
}

async function editMessages(page: Page): Promise<unknown[]> {
	return page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'));
}

async function cursorAt(page: Page, text: string): Promise<void> {
	await page.locator('.cm-content').evaluate((content, target) => {
		const view = (content as any).cmTile.root.view;
		const position = view.state.doc.toString().indexOf(target);
		if (position < 0) throw new Error(`Missing cursor target: ${target}`);
		view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
		view.focus();
	}, text);
}

test.beforeEach(async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	(page as any).__foldAllErrors = errors;
});
test.afterEach(async ({ page }) => { expect((page as any).__foldAllErrors).toEqual([]); });

test('fold-all control is adjacent to the lock switch and disabled without collapsible objects', async ({ page }) => {
	await mountEditor(page, 'Before\n\n> Ordinary quote\n\n| Name | Value |\n| --- | --- |\n| Alpha | 1 |\n\n' + fenced('short', 7) + '\n\nAfter');
	const button = page.locator('.mlp-fold-all-toggle');
	await expect(button).toHaveCount(1);
	await expect(button).toBeDisabled();
	await expect(button).toHaveAttribute('title', /collapsible objects/i);
	const foldBox = await button.boundingBox();
	const lockBox = await page.locator('.mlp-editing-mode-toggle').boundingBox();
	expect(foldBox).not.toBeNull();
	expect(lockBox).not.toBeNull();
	expect(Math.abs(foldBox!.y - lockBox!.y)).toBeLessThan(8);
	expect(Math.min(Math.abs(foldBox!.x + foldBox!.width - lockBox!.x), Math.abs(lockBox!.x + lockBox!.width - foldBox!.x))).toBeLessThan(20);
});

for (const editingMode of ['editing', 'locked'] as const) {
	test(`global mouse collapse and keyboard expansion preserve source in ${editingMode} mode`, async ({ page }) => {
		const original = `Intro\n\n> [!warning]+ Review\n> Visible warning body\n\n> [!note]- Details\n> Hidden note body\n\n${fenced('long')}\n\nAfter`;
		await mountEditor(page, original, { editingMode });
		await expect(page.getByRole('button', { name: collapseLabel, exact: true })).toBeEnabled();
		await page.getByRole('button', { name: collapseLabel, exact: true }).click();
		await expect(page.getByRole('button', { name: 'Review callout', exact: true })).toHaveAttribute('aria-expanded', 'false');
		await expect(page.getByRole('button', { name: 'Details callout', exact: true })).toHaveAttribute('aria-expanded', 'false');
		await expect(page.getByRole('button', { name: 'Expand code block', exact: true })).toHaveAttribute('aria-expanded', 'false');
		await expect(page.locator('.cm-content')).not.toContainText('Visible warning body');
		await expect(page.locator('.cm-content')).not.toContainText('long_8();');
		const expand = page.getByRole('button', { name: expandLabel, exact: true });
		await expand.focus();
		await page.keyboard.press('Space');
		await expect(page.getByRole('button', { name: 'Review callout', exact: true })).toHaveAttribute('aria-expanded', 'true');
		await expect(page.getByRole('button', { name: 'Details callout', exact: true })).toHaveAttribute('aria-expanded', 'true');
		await expect(page.locator('.cm-content')).toContainText('long_8();');
		await expect(page.getByRole('button', { name: collapseLabel, exact: true })).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('button', { name: expandLabel, exact: true })).toBeFocused();
		expect(await source(page)).toBe(original);
		expect(await editMessages(page)).toEqual([]);
		await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', editingMode === 'locked' ? 'false' : 'true');
	});
}

test('mixed individual fold states keep the global action synchronized', async ({ page }) => {
	await mountEditor(page, `Intro\n\n> [!note] First\n> First body\n\n${fenced('other')}\n\nAfter`);
	await page.getByRole('button', { name: 'First callout', exact: true }).click();
	await expect(page.getByRole('button', { name: collapseLabel, exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
	await expect(page.getByRole('button', { name: expandLabel, exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'First callout', exact: true }).click();
	await expect(page.getByRole('button', { name: collapseLabel, exact: true })).toBeVisible();
	await page.getByRole('button', { name: collapseLabel, exact: true }).click();
	await page.getByRole('button', { name: expandLabel, exact: true }).click();
	await expect(page.getByRole('button', { name: 'Collapse code block', exact: true })).toBeVisible();
});

test('nested hidden callouts and their long code are expanded by the same global action', async ({ page }) => {
	const quotedCode = fenced('nested').split('\n').map(line => `> > ${line}`).join('\n');
	const original = `Intro\n\n> [!warning]- Outer\n> Outer body\n>\n> > [!tip]- Inner\n> > Inner body\n> >\n${quotedCode}\n>\n> Outer tail\n\nAfter`;
	await mountEditor(page, original);
	// The hidden code is initially expanded, so a mixed tree first offers Collapse.
	await page.getByRole('button', { name: collapseLabel, exact: true }).click();
	await page.getByRole('button', { name: expandLabel, exact: true }).click();
	await expect(page.getByRole('button', { name: 'Outer callout', exact: true })).toHaveAttribute('aria-expanded', 'true');
	await expect(page.getByRole('button', { name: 'Inner callout', exact: true })).toHaveAttribute('aria-expanded', 'true');
	await expect(page.locator('.cm-content')).toContainText('nested_8();');
	await page.getByRole('button', { name: collapseLabel, exact: true }).click();
	await page.getByRole('button', { name: 'Outer callout', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Inner callout', exact: true })).toHaveAttribute('aria-expanded', 'false');
	await page.getByRole('button', { name: 'Inner callout', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Expand code block', exact: true })).toBeVisible();
	expect(await source(page)).toBe(original);
	expect(await editMessages(page)).toEqual([]);
});

test('global folding includes long indented code and preserves short code and plain quotes', async ({ page }) => {
	const original = `Intro\n\n${code('indented').split('\n').map(line => `    ${line}`).join('\n')}\n\n${fenced('short', 7)}\n\n> Plain quote stays visible\n\nAfter`;
	await mountEditor(page, original);
	await page.getByRole('button', { name: collapseLabel, exact: true }).click();
	await expect(page.getByRole('button', { name: 'Expand code block', exact: true })).toHaveCount(1);
	await expect(page.locator('.cm-content')).not.toContainText('indented_8();');
	await expect(page.locator('.cm-content')).toContainText('short_7();');
	await expect(page.locator('.cm-content')).toContainText('Plain quote stays visible');
	await page.getByRole('button', { name: expandLabel, exact: true }).click();
	await expect(page.locator('.cm-content')).toContainText('indented_8();');
	expect(await source(page)).toBe(original);
});

test('table and diagram objects outside a callout remain unchanged during global folding', async ({ page }) => {
	const original = 'Intro\n\n> [!info] Foldable\n> Body\n\n| Name | Count |\n| --- | ---: |\n| Retain | 2 |\n\n```mermaid\nflowchart LR\nA --> B\nB --> C\nC --> D\nD --> E\nE --> F\nF --> G\nG --> H\n```\n\nAfter';
	await mountEditor(page, original);
	await expect(page.locator('.mlp-mermaid-wrap svg')).toBeVisible();
	await page.getByRole('button', { name: collapseLabel, exact: true }).click();
	await expect(page.locator('.mlp-table')).toBeVisible();
	await expect(page.locator('.mlp-mermaid-wrap svg')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Expand code block', exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: expandLabel, exact: true })).toBeVisible();
	expect(await source(page)).toBe(original);
	expect(await editMessages(page)).toEqual([]);
});

test('callout-like text inside code does not become an extra fold target', async ({ page }) => {
	const original = 'Intro\n\n```text\n> [!warning]- Not a callout\n> Literal body\n```\n\n    > [!note] Also literal\n\n`> [!tip] Inline literal`\n\nAfter';
	await mountEditor(page, original);
	await expect(page.locator('.mlp-callout-header')).toHaveCount(0);
	await expect(page.locator('.mlp-fold-all-toggle')).toBeDisabled();
	expect(await source(page)).toBe(original);
});

test('document additions and removal update global availability and do not reuse stale targets', async ({ page }) => {
	let text = 'Intro\n\nAfter';
	await mountEditor(page, text);
	await expect(page.locator('.mlp-fold-all-toggle')).toBeDisabled();
	const callout = '\n\n> [!note] Added\n> Added body';
	await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from: text.length, to: text.length, insert: callout }] });
	text += callout;
	await expect(page.getByRole('button', { name: collapseLabel, exact: true })).toBeEnabled();
	await page.getByRole('button', { name: collapseLabel, exact: true }).click();
	await postToWebview(page, { type: 'externalUpdate', version: 2, changes: [{ from: 0, to: text.length, insert: 'Replacement plain text' }] });
	await expect(page.locator('.mlp-fold-all-toggle')).toBeDisabled();
	await expect(page.locator('.mlp-callout-header')).toHaveCount(0);
	expect(await source(page)).toBe('Replacement plain text');
	expect(await editMessages(page)).toEqual([]);
});

test('global folds include objects beyond the rendered viewport', async ({ page }) => {
	const original = `Intro\n\n> [!note] Near\n> Near body\n\n${'A long document paragraph.\n\n'.repeat(180)}${fenced('far')}\n\n> [!tip] Distant\n> Distant body\n\nEnd sentinel`;
	await mountEditor(page, original);
	await expect(page.getByRole('button', { name: 'Distant callout', exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: collapseLabel, exact: true }).click();
	await page.locator('.cm-scroller').evaluate(scroller => { scroller.scrollTop = scroller.scrollHeight; });
	await expect(page.getByRole('button', { name: 'Distant callout', exact: true })).toHaveAttribute('aria-expanded', 'false');
	await expect(page.getByRole('button', { name: 'Expand code block', exact: true })).toBeVisible();
	await expect(page.locator('.cm-content')).not.toContainText('far_8();');
	await page.getByRole('button', { name: expandLabel, exact: true }).click();
	await cursorAt(page, 'End sentinel');
	await expect(page.getByRole('button', { name: 'Distant callout', exact: true })).toHaveAttribute('aria-expanded', 'true');
	expect(await source(page)).toBe(original);
});

test('collapsing from a hidden body moves the cursor outside the body and lets arrows resume editing', async ({ page }) => {
	const original = 'Intro\n\n> [!note] Review\n> Body to hide\n> Last hidden body\n\nAfter';
	await mountEditor(page, original);
	await cursorAt(page, 'Body to hide');
	await page.keyboard.press('ArrowRight');
	await page.getByRole('button', { name: collapseLabel, exact: true }).click();
	const head = await page.locator('.cm-content').evaluate(content => (content as any).cmTile.root.view.state.selection.main.head);
	expect(head >= original.indexOf('> Body to hide') && head <= original.indexOf('Last hidden body') + 'Last hidden body'.length).toBe(false);
	await expect(page.getByRole('button', { name: 'Review callout', exact: true })).toHaveAttribute('aria-expanded', 'false');
	await page.locator('.cm-content').focus();
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('End');
	await page.keyboard.type(' Revised');
	expect(await source(page)).toContain('Body to hide\n> Last hidden body');
	expect(await source(page)).toContain(' Revised');
});

test('folding a callout commits its in-progress table cell before removing the widget', async ({ page }) => {
	const original = 'Intro\n\n> [!note] Table review\n>\n> | Item | Value |\n> | --- | --- |\n> | Original | Keep |\n\nAfter';
	await mountEditor(page, original);
	const cell = page.locator('.mlp-table td').first();
	await cell.focus();
	await page.keyboard.press('F2');
	await page.keyboard.type('Retained draft');
	await page.getByRole('button', { name: collapseLabel, exact: true }).click();
	await expect(page.locator('.mlp-table')).toHaveCount(0);
	expect(await source(page)).toBe(original.replace('Original', 'Retained draft'));
	await page.getByRole('button', { name: expandLabel, exact: true }).click();
	await expect(page.locator('.mlp-table td').first()).toHaveText('Retained draft');
	expect(await source(page)).toBe(original.replace('Original', 'Retained draft'));
});

test('an invalid property draft blocks global folding without losing the draft', async ({ page }) => {
	const original = '---\npriority: 3\n---\n\nIntro\n\n> [!note] Review\n> Keep body visible\n\nAfter';
	await mountEditor(page, original);
	const priority = page.locator('.mlp-frontmatter tr', { hasText: 'priority' }).locator('td');
	await priority.focus();
	await page.keyboard.press('F2');
	await priority.locator('input').fill('unsaved invalid priority');
	await page.getByRole('button', { name: collapseLabel, exact: true }).click();
	await expect(priority.locator('input')).toHaveValue('unsaved invalid priority');
	await expect(priority.locator('input')).toHaveAttribute('aria-invalid', 'true');
	await expect(page.getByRole('button', { name: 'Review callout', exact: true })).toHaveAttribute('aria-expanded', 'true');
	expect(await source(page)).toBe(original);
	expect(await editMessages(page)).toEqual([]);
});

test('unrelated arrow-key edits keep every fold state and undo remains a text-only operation', async ({ page }) => {
	const original = `Intro\n\n> [!note] Review\n> Body\n\n${fenced('long')}\n\nAfter`;
	await mountEditor(page, original);
	await page.getByRole('button', { name: collapseLabel, exact: true }).click();
	await page.locator('.cm-line', { hasText: /^After$/ }).click();
	await page.keyboard.press('End');
	await page.keyboard.type(' updated');
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('ArrowRight');
	await expect(page.getByRole('button', { name: expandLabel, exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Expand code block', exact: true })).toBeVisible();
	await page.keyboard.press(`${mod}+z`);
	// The harness acknowledges edits but does not own VS Code's undo stack.
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'undo').length)).toBe(1);
	const hostVersion = await page.evaluate(() => Math.max(...(window as any).__posted.filter((message: any) => message.type === 'edit').map((message: any) => message.baseVersion)) + 2);
	await postToWebview(page, { type: 'externalUpdate', version: hostVersion, changes: [{ from: original.length, to: original.length + ' updated'.length, insert: '' }] });
	expect(await source(page)).toBe(original);
	await expect(page.getByRole('button', { name: expandLabel, exact: true })).toBeVisible();
});

test('Find-selected text does not reopen objects immediately after global folding', async ({ page }) => {
	const original = `Intro\n\n> [!note] Search review\n> Search target inside callout\n\n${fenced('search_code')}\n\nAfter`;
	await mountEditor(page, original);
	await openSearch(page);
	await page.locator('.cm-search input[name="search"]').fill('Search target');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: collapseLabel, exact: true }).click();
	await expect(page.getByRole('button', { name: 'Search review callout', exact: true })).toHaveAttribute('aria-expanded', 'false');
	await expect(page.locator('.cm-content')).not.toContainText('Search target inside callout');
	await expect(page.locator('.cm-content')).not.toContainText('search_code_8();');
	await expect(page.getByRole('button', { name: expandLabel, exact: true })).toBeVisible();
	expect(await source(page)).toBe(original);
	expect(await editMessages(page)).toEqual([]);
});

test('global expansion clears a mapped code fold after the code is shortened below eight lines', async ({ page }) => {
	const original = `Intro\n\n${fenced('shortened')}\n\nAfter`;
	await mountEditor(page, original);
	await page.getByRole('button', { name: collapseLabel, exact: true }).click();
	const from = original.indexOf('shortened_2();');
	const to = original.indexOf('shortened_8();');
	await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from, to, insert: '' }] });
	await expect(page.getByRole('button', { name: expandLabel, exact: true })).toBeEnabled();
	await page.getByRole('button', { name: expandLabel, exact: true }).click();
	await expect(page.locator('.cm-content')).toContainText('shortened_1();');
	await expect(page.locator('.cm-content')).toContainText('shortened_8();');
	await expect(page.locator('.mlp-fold-all-toggle')).toBeDisabled();
	expect(await source(page)).toBe(original.slice(0, from) + original.slice(to));
	expect(await editMessages(page)).toEqual([]);
});
