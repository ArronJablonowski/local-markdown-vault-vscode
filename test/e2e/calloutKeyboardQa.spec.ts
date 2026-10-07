import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mountEditor } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const errors = new Map<Page, string[]>();
test.beforeEach(({ page }) => {
	const found: string[] = [];
	errors.set(page, found);
	page.on('pageerror', error => found.push(error.message));
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

async function source(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate(element => (element as any).cmTile.root.view.state.doc.toString());
}
async function keys(page: Page, text: string): Promise<void> {
	for (const character of text) await page.keyboard.type(character);
}
async function find(page: Page, text: string): Promise<void> {
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+f`);
	await page.locator('.cm-search input[name="search"]').fill(text);
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
}
async function saved(page: Page, initial: string, expected: string): Promise<void> {
	await expect.poll(() => source(page)).toBe(expected);
	await expect.poll(() => page.evaluate(text => {
		for (const message of (window as any).__posted) if (message.type === 'edit') {
			for (const change of [...message.changes].reverse()) text = text.slice(0, change.from) + change.insert + text.slice(change.to);
		}
		return text;
	}, initial)).toBe(expected);
}

for (const theme of ['default', 'obsidian'] as const) for (const width of [520, 1100]) {
	test(`keyboard meeting callout creation, arrow correction, and EOF exit: ${theme} ${width}`, async ({ page }) => {
		await page.setViewportSize({ width, height: 760 });
		const initial = '# Meeting notes\n\n';
		await mountEditor(page, initial, { css: theme === 'obsidian'
			? readFileSync(join(__dirname, '../../media/sample-styles/obsidian-dark.css'), 'utf8') : undefined });
		await page.locator('.cm-content').focus();
		await page.keyboard.press(`${mod}+End`);
		await keys(page, '> [!warning]+ Launch review');
		await page.keyboard.press('Enter');
		await keys(page, 'We need a decison before Friday.');
		await find(page, 'decison');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('ArrowLeft');
		await keys(page, 'i');
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');
		await keys(page, 'Outside follow-up.');
		await saved(page, initial, initial + '> [!warning]+ Launch review\n> We need a decision before Friday.\n\nOutside follow-up.');
		await expect(page.locator('.cm-line', { hasText: /^Outside follow-up\.$/ })).not.toHaveClass(/mlp-callout/);
		await find(page, 'Friday');
		await keys(page, 'Monday');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('End');
		await keys(page, ' Done.');
		await saved(page, initial, initial + '> [!warning]+ Launch review\n> We need a decision before Monday.\n\nOutside follow-up. Done.');
	});
}

test('individual callout folding preserves an active table cell draft', async ({ page }) => {
	const initial = 'Before\n\n> [!note] Meeting\n>\n> | Owner | Status |\n> | --- | --- |\n> | Alex | Pending |\n\nAfter';
	await mountEditor(page, initial);
	const cell = page.locator('.mlp-table td').last();
	await cell.focus();
	await page.keyboard.press('F2');
	await keys(page, 'Reviewed');
	await page.getByRole('button', { name: 'Meeting callout', exact: true }).click();
	await expect(page.locator('.mlp-table')).toHaveCount(0);
	await saved(page, initial, initial.replace('Pending', 'Reviewed'));
	await page.getByRole('button', { name: 'Meeting callout', exact: true }).click();
	await expect(page.locator('.mlp-table td').last()).toHaveText('Reviewed');
});

test('folding with the caret inside a callout does not allow hidden-body edits', async ({ page }) => {
	const initial = 'Before\n\n> [!note] Meeting\n>\n> | Item | Status |\n> | --- | --- |\n> | Body sentinel | Keep |\n>\n> Keep this last line\n\nAfter';
	await mountEditor(page, initial);
	await page.locator('.mlp-table td').first().focus();
	await page.keyboard.press('F2');
	await keys(page, 'Body sentinel');
	await page.getByRole('button', { name: 'Meeting callout', exact: true }).click();
	const head = await page.locator('.cm-content').evaluate(element => (element as any).cmTile.root.view.state.selection.main.head);
	expect(head >= initial.indexOf('>\n') && head < initial.indexOf('\n\nAfter')).toBe(false);
	await expect(page.getByRole('button', { name: 'Meeting callout', exact: true })).toBeFocused();
	await page.keyboard.press('Space');
	await expect(page.getByRole('button', { name: 'Meeting callout', exact: true })).toHaveAttribute('aria-expanded', 'true');
	expect(await page.getByRole('button', { name: 'Meeting callout', exact: true }).evaluate(button => button.closest('.cm-line')?.textContent)).not.toMatch(/^\s*>/);
	await page.keyboard.press('Enter');
	await page.locator('.cm-content').focus();
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('End');
	await keys(page, ' Follow-up');
	expect(await source(page)).toContain('> | Body sentinel | Keep |\n>\n> Keep this last line');
});

test('nested callout header stays rendered without quote-prefix leakage after a table draft fold', async ({ page }) => {
	const initial = 'Before\n\n> [!abstract] Agenda\n> Overview\n>\n> > [!warning] Risks\n> >\n> > | Owner | Status |\n> > | --- | --- |\n> > | Alex | Pending |\n> >\n> > Last risk\n>\n> Agenda tail\n\nAfter';
	await mountEditor(page, initial);
	await page.locator('.mlp-table td').last().focus();
	await page.keyboard.press('F2');
	await keys(page, 'Reviewed');
	const header = page.getByRole('button', { name: 'Risks callout', exact: true });
	await header.click();
	await expect(header).toBeFocused();
	await page.keyboard.press('Space');
	await expect(header).toHaveAttribute('aria-expanded', 'true');
	expect(await header.evaluate(button => button.closest('.cm-line')?.textContent)).not.toMatch(/^\s*>/);
	await saved(page, initial, initial.replace('Pending', 'Reviewed'));
});

test('invalid property input prevents an individual fold without discarding the input', async ({ page }) => {
	const initial = '---\npriority: 3\n---\n\nBefore\n\n> [!note] Meeting\n> Body\n\nAfter';
	await mountEditor(page, initial);
	const cell = page.locator('.mlp-frontmatter tr', { hasText: 'priority' }).locator('td');
	await cell.focus();
	await page.keyboard.press('F2');
	await cell.locator('input').fill('unfinished value');
	await page.getByRole('button', { name: 'Meeting callout', exact: true }).click();
	await expect(cell.locator('input')).toHaveValue('unfinished value');
	await expect(cell.locator('input')).toHaveAttribute('aria-invalid', 'true');
	await expect(page.getByRole('button', { name: 'Meeting callout', exact: true })).toHaveAttribute('aria-expanded', 'true');
	await saved(page, initial, initial);
});

test('folding a later callout commits an earlier table edit and maps the header position', async ({ page }) => {
	const initial = 'Before\n\n| Owner |\n| --- |\n| Alex |\n\n> [!note] Later\n> Keep this body\n\nAfter';
	await mountEditor(page, initial);
	await page.locator('.mlp-table td').focus();
	await page.keyboard.press('F2');
	await keys(page, 'Alex and Morgan');
	await page.getByRole('button', { name: 'Later callout', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Later callout', exact: true })).toHaveAttribute('aria-expanded', 'false');
	await saved(page, initial, initial.replace('| Alex |', '| Alex and Morgan |'));
	await page.keyboard.press('Space');
	await expect(page.getByRole('button', { name: 'Later callout', exact: true })).toHaveAttribute('aria-expanded', 'true');
});

test('nested callout soft breaks, correction, and repeated Enter exit preserve both containers', async ({ page }) => {
	const initial = 'Before\n\n> [!abstract] Agenda\n> Overview\n>\n> > [!tip] Action\n> > Confirm owner';
	await mountEditor(page, initial);
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+End`);
	await page.keyboard.press('Shift+Enter');
	await keys(page, 'Confirm date');
	await page.keyboard.press('Shift+ArrowLeft');
	await page.keyboard.press('Shift+ArrowLeft');
	await page.keyboard.press('Backspace');
	await keys(page, 'te and time');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Enter');
	await keys(page, 'Independent follow-up');
	await saved(page, initial, initial + '\n> > Confirm date and time\n\nIndependent follow-up');
	await expect(page.locator('.cm-line', { hasText: /^Independent follow-up$/ })).not.toHaveClass(/mlp-callout/);
});

test('task continuation, nesting, outdenting, and exit keep exact quote and checkbox markers', async ({ page }) => {
	const initial = 'Before\n\n> [!todo] Actions\n> - [ ] Confirm owner';
	await mountEditor(page, initial);
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+End`);
	await page.keyboard.press('Enter');
	await page.keyboard.press('Tab');
	await keys(page, 'Schedule review');
	await page.keyboard.press('Shift+Tab');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Enter');
	await keys(page, 'Outside summary');
	await saved(page, initial, initial + '\n> - [ ] Schedule review\n\nOutside summary');
	await page.getByRole('checkbox').first().click();
	await saved(page, initial, initial.replace('[ ] Confirm', '[x] Confirm') + '\n> - [ ] Schedule review\n\nOutside summary');
});

for (const nested of [false, true]) test(`arrows traverse collapsed ${nested ? 'nested' : 'plain'} callouts without entering invisible lines`, async ({ page }) => {
	const initial = nested
		? 'Before\n\n> [!note]- Outer\n> Hidden outer\n>\n> > [!tip]- Inner\n> > Hidden inner\n\nAfter'
		: 'Before\n\n> [!note]- Outer\n> Hidden outer\n> Hidden last\n\nAfter';
	await mountEditor(page, initial);
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+Home`);
	for (const direction of ['ArrowDown', 'ArrowUp']) {
		for (let count = 0; count < 8; count++) {
			await page.keyboard.press(direction);
			const head = await page.locator('.cm-content').evaluate(element => (element as any).cmTile.root.view.state.selection.main.head);
			expect(head > initial.indexOf('> Hidden outer') && head < initial.indexOf('\n\nAfter')).toBe(false);
		}
	}
	await saved(page, initial, initial);
});

test('long meeting callout supports distant Find, arrow revisions, boundary edits, and visible caret', async ({ page }) => {
	await page.setViewportSize({ width: 560, height: 720 });
	const initial = '# Long meeting\n\n> [!note] Discussion\n' + Array.from({ length: 180 }, (_, index) =>
		`> Item ${index}: Discuss owners and dependencies before approving the next release.`).join('\n') + '\n> Tail sentinel\n\nAfter sentinel';
	await mountEditor(page, initial);
	await find(page, 'Tail sentinel');
	await page.keyboard.press('ArrowRight');
	for (let count = 0; count < 8; count++) await page.keyboard.press('ArrowLeft');
	await keys(page, 'revised ');
	await page.keyboard.press('End');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('End');
	await keys(page, ' updated');
	await saved(page, initial, initial.replace('Tail sentinel', 'Tail revised sentinel').replace('After sentinel', 'After sentinel updated'));
	await expect.poll(() => page.locator('.cm-content').evaluate(element => {
		const view = (element as any).cmTile.root.view;
		const caret = view.coordsAtPos(view.state.selection.main.head);
		const box = view.scrollDOM.getBoundingClientRect();
		return !!caret && caret.top >= box.top - 2 && caret.bottom <= box.bottom + 2;
	})).toBe(true);
});
