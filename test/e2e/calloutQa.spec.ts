import { test, expect, type Page } from '@playwright/test';
import { mountEditor } from './harness';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
test.beforeEach(async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	(page as any).__calloutErrors = errors;
});
test.afterEach(async ({ page }) => { expect((page as any).__calloutErrors).toEqual([]); });

async function source(page: Page): Promise<string> {
	await page.locator('.cm-content').focus();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
	return page.evaluate(() => {
		const data = new DataTransfer();
		document.querySelector('.cm-content')!.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
		return data.getData('text/plain');
	});
}

const mixed = 'Intro\n\n> [!warning]+ Review\n> **Important** and ==highlighted==.\n>\n> - Parent\n>   - Child\n> - [ ] Task\n>\n> | Name | Value |\n> | --- | --- |\n> | Alpha | **Bold** |\n>\n> ```mermaid\n> flowchart LR\n> A[Start] --> B[End]\n> ```\n>\n> Final details.\n\nAfter';

test('mixed callout renders a table and diagram inside a continuous tinted panel', async ({ page }) => {
	await mountEditor(page, mixed);
	await expect(page.locator('.mlp-table td').first()).toHaveText('Alpha');
	await expect(page.locator('.mlp-mermaid-wrap svg')).toBeVisible();
	await expect(page.locator('.mlp-callout-block')).toHaveCount(2);
});

const families = ['note', 'notes', 'abstract', 'summary', 'tldr', 'info', 'todo', 'tip', 'hint', 'important', 'success', 'check', 'done', 'question', 'help', 'faq', 'warning', 'caution', 'attention', 'failure', 'fail', 'missing', 'danger', 'error', 'bug', 'example', 'quote', 'cite', 'custom-type'];
for (const family of families) {
	for (const editingMode of ['editing', 'locked'] as const) {
		test(`${family} callout supports mixed content and keyboard folding in ${editingMode} mode`, async ({ page }) => {
			await mountEditor(page, mixed.replace('[!warning]+', `[!${family.toUpperCase()}]-`), { editingMode });
			const header = page.locator('.mlp-callout-header');
			await expect(header).toHaveAttribute('aria-expanded', 'false');
			await expect(page.locator('.mlp-table')).toHaveCount(0);
			await header.focus();
			await page.keyboard.press('Space');
			await expect(header).toHaveAttribute('aria-expanded', 'true');
			await expect(page.locator('.mlp-table td').first()).toHaveText('Alpha');
			await expect(page.locator('.mlp-mermaid-wrap svg')).toBeVisible();
			await header.focus();
			await page.keyboard.press('Enter');
			await expect(page.locator('.mlp-table')).toHaveCount(0);
			expect(await source(page)).toBe(mixed.replace('[!warning]+', `[!${family.toUpperCase()}]-`));
		});
	}
}

test('nested callouts fold independently and do not hide adjacent callouts', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n> [!warning]+ Outer\n> Body\n>\n> > [!tip]+ Inner\n> > Inside\n>\n> Tail\n\n> [!note] Adjacent\n> Outside\n\nAfter');
	await expect(page.locator('.cm-line', { hasText: 'Inside' })).toHaveClass(/mlp-callout-tip/);
	await expect(page.locator('.cm-line', { hasText: 'Inside' })).not.toHaveClass(/mlp-callout-warning/);
	await page.getByRole('button', { name: 'Inner callout', exact: true }).click();
	await expect(page.getByText('Inside', { exact: true })).toBeHidden();
	await expect(page.getByText('Tail', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Outer callout', exact: true }).click();
	await expect(page.getByText('Tail', { exact: true })).toBeHidden();
	await expect(page.getByRole('button', { name: 'Adjacent callout', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Outer callout', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Inner callout', exact: true })).toHaveAttribute('aria-expanded', 'false');
});

test('callout tasks strike through and quoted code copies without quote markers', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n> [!notes] Work\n> - [ ] Task\n>\n> ```js\n> const x = 1;\n> console.log(x);\n> ```\n\nAfter');
	await page.locator('.mlp-checkbox').click();
	await expect(page.locator('.mlp-line-task-complete')).toHaveCount(1);
	await page.locator('.mlp-copy-code-btn').click();
	await expect.poll(() => page.evaluate(() => (window as any).__posted.find((message: any) => message.type === 'copyCode')?.text)).toBe('const x = 1;\nconsole.log(x);');
});

test('add, edit, and delete callout table rows without breaking the callout', async ({ page }) => {
	await mountEditor(page, mixed);
	await page.locator('.mlp-table td').first().click();
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: 'Table options', exact: true }).click();
	await page.getByRole('button', { name: 'Insert row below selected row', exact: true }).click();
	await expect(page.locator('.mlp-table tbody tr')).toHaveCount(2);
	const cell = page.locator('.mlp-table tbody tr').last().locator('td').first();
	await cell.focus();
	await page.keyboard.press('F2');
	await page.keyboard.type('Added');
	await page.keyboard.press('Enter');
	await expect(cell).toHaveText('Added');
	await cell.click();
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: 'Table options', exact: true }).click();
	await page.getByRole('button', { name: 'Delete selected row', exact: true }).click();
	await expect(page.locator('.mlp-table tbody tr')).toHaveCount(1);
	const result = await source(page);
	expect(result).toContain('> | Alpha | **Bold** |');
	expect(result).not.toContain('Added');
	expect(result.split('\n').filter(line => line.includes('|')).every(line => line.startsWith('> '))).toBe(true);
});

test('folding hides every mixed object and survives unrelated edits', async ({ page }) => {
	await mountEditor(page, mixed);
	await expect(page.locator('.mlp-mermaid-wrap svg')).toBeVisible();
	await page.locator('.mlp-callout-header').click();
	await expect(page.locator('.mlp-mermaid-wrap')).toBeHidden();
	await expect(page.locator('.mlp-table')).toBeHidden();
	await page.locator('.cm-line', { hasText: 'After' }).click();
	await page.keyboard.press('End');
	await page.keyboard.type(' updated');
	await expect(page.locator('.mlp-callout-header')).toHaveAttribute('aria-expanded', 'false');
	await page.locator('.mlp-callout-header').click();
	await expect(page.locator('.mlp-table')).toBeVisible();
	await expect(page.locator('.mlp-mermaid-wrap svg')).toBeVisible();
});

test('callout table cell edits preserve quote prefixes', async ({ page }) => {
	await mountEditor(page, mixed);
	const cell = page.locator('.mlp-table td').first();
	await cell.focus();
	await page.keyboard.press('F2');
	await page.keyboard.type('Updated');
	await page.keyboard.press('Enter');
	await expect(cell).toHaveText('Updated');
	await page.locator('.mlp-table-wrap .mlp-code-mode-btn').click();
	expect(await source(page)).toBe(mixed.replace('Alpha', 'Updated'));
});

test('callout paragraphs accept additions, replacement, and deletion without touching neighbors', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n> [!warning] Review\n> Original body\n\nAfter');
	await page.locator('.cm-line', { hasText: 'Original body' }).click();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await page.keyboard.type('- Added item');
	await page.keyboard.press('Enter');
	await page.keyboard.type('Second item');
	await page.keyboard.press('Shift+Home');
	await page.keyboard.type('> - Revised item');
	await page.keyboard.press('Home');
	await page.keyboard.press('Shift+End');
	await page.keyboard.press('Backspace');
	await page.keyboard.press('Backspace');
	expect(await source(page)).toBe('Intro\n\n> [!warning] Review\n> Original body\n> - Added item\n\nAfter');
});

test('Tab and Shift+Tab nest bullets inside a callout, not the quote itself', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n> [!note] List\n> - Parent\n> - Child\n\nAfter');
	await page.locator('.cm-line', { hasText: 'Child' }).click();
	await page.keyboard.press('Tab');
	await page.locator('.cm-line', { hasText: 'After' }).click();
	await expect(page.locator('.mlp-bullet-2')).toHaveCount(1);
	await page.locator('.cm-line', { hasText: 'Child' }).click();
	await page.keyboard.press('Shift+Tab');
	expect(await source(page)).toBe('Intro\n\n> [!note] List\n> - Parent\n> - Child\n\nAfter');
});

test('an empty and hostile title remain inert and malformed markers remain editable', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n> [!note] <img src=x onerror=alert(1)>\n> Body\n\n> [!] malformed\n\n> [!note]\n\nAfter');
	await expect(page.locator('.mlp-callout-title').first()).toHaveText('<img src=x onerror=alert(1)>');
	await expect(page.locator('.mlp-callout-title img')).toHaveCount(0);
	await expect(page.locator('.mlp-callout-header')).toHaveCount(2);
});

test('callout display math renders, while dollar signs inside quoted code stay literal', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n> [!info] Math\n> Inline $x^2$.\n>\n> $$\n> x^2 + y^2 = z^2\n> $$\n>\n> ```text\n> $not_math$\n> ```\n\nAfter');
	await expect(page.locator('.mlp-math-inline')).toHaveCount(1);
	await expect(page.locator('.mlp-math-block math')).toHaveCount(1);
	await expect(page.locator('.mlp-math-error')).toHaveCount(0);
	await page.locator('.mlp-callout-header').click();
	await expect(page.locator('.mlp-math')).toHaveCount(0);
});

for (const editingMode of ['editing', 'locked'] as const) {
	test(`rich fixture keeps every object inside the callout in ${editingMode} mode`, async ({ page }, info) => {
		await page.setViewportSize({ width: 1000, height: 1600 });
		const text = readFileSync(join(__dirname, '../fixtures/callout-qa/mixed-objects.md'), 'utf8');
		await mountEditor(page, text, { editingMode, css: readFileSync(join(__dirname, '../../media/sample-styles/obsidian-dark.css'), 'utf8') });
		await expect(page.locator('.mlp-drawio-wrap svg')).toContainText('Local diagram');
		await expect(page.locator('.mlp-mermaid-wrap:not(.mlp-drawio-wrap) svg')).toBeVisible();
		await expect(page.locator('.mlp-math-block math')).toHaveCount(1);
		await expect(page.locator('.mlp-table td').first()).toHaveText('Alpha');
		const colors = await page.locator('.mlp-callout-warning').evaluateAll(nodes => nodes.map(node => ({ className: node.className, color: getComputedStyle(node).backgroundColor })));
		expect(new Set(colors.map(node => node.color)).size, JSON.stringify(colors)).toBe(1);
		await page.screenshot({ path: info.outputPath(`rich-callout-${editingMode}.png`) });
		await page.getByRole('button', { name: 'Mixed objects callout', exact: true }).click();
		await expect(page.locator('.mlp-table, .mlp-math, .mlp-drawio-wrap, .mlp-copy-code-btn')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Adjacent note callout', exact: true })).toBeVisible();
		expect(await source(page)).toBe(text);
	});
}

test('nested boundary fixture keeps inner tables folded and hostile titles inert', async ({ page }) => {
	await mountEditor(page, readFileSync(join(__dirname, '../fixtures/callout-qa/nested-and-boundaries.md'), 'utf8'));
	await expect(page.locator('.mlp-table')).toHaveCount(0);
	await page.getByRole('button', { name: 'Inner tip callout', exact: true }).click();
	await expect(page.locator('.mlp-table td').first()).toHaveText('Example');
	await expect(page.locator('.mlp-callout-title img')).toHaveCount(0);
	await page.getByRole('button', { name: 'Outer summary callout', exact: true }).click();
	await expect(page.locator('.mlp-table')).toHaveCount(0);
	await expect(page.getByText('Independent paragraph after all callouts.', { exact: true })).toBeVisible();
});

test('repeated source replacements, deletion, and recreation rebuild every callout object', async ({ page }) => {
	const original = readFileSync(join(__dirname, '../fixtures/callout-qa/mixed-objects.md'), 'utf8');
	await mountEditor(page, original);
	for (const word of ['Revised', 'Final']) {
		const updated = original.replaceAll('Alpha', word).replaceAll('Local diagram', `${word} diagram`).replace('A[Start]', `A[${word}]`).replace('x^2 + y^2 = z^2', 'a^2 + b^2 = c^2');
		await source(page); // Select the complete Markdown, including folded widgets.
		await page.keyboard.insertText(updated);
		await page.locator('.cm-line', { hasText: 'After the callout.' }).click();
		await expect(page.locator('.mlp-table td').first()).toHaveText(word);
		await expect(page.locator('.mlp-drawio-wrap svg')).toContainText(`${word} diagram`);
		await expect(page.locator('.mlp-mermaid-wrap:not(.mlp-drawio-wrap) svg')).toContainText(word);
		await expect(page.locator('.mlp-math-block math')).toHaveCount(1);
		expect(await source(page)).toBe(updated);
	}
	await page.keyboard.press('Backspace');
	await expect(page.locator('.mlp-callout-header, .mlp-table, .mlp-math, .mlp-drawio-wrap, .mlp-mermaid-wrap')).toHaveCount(0);
	await page.keyboard.insertText(original);
	await page.locator('.cm-line', { hasText: 'After the callout.' }).click();
	await expect(page.locator('.mlp-table td').first()).toHaveText('Alpha');
	await expect(page.locator('.mlp-mermaid-wrap:not(.mlp-drawio-wrap) svg')).toContainText('Start');
	expect(await source(page)).toBe(original);
});
