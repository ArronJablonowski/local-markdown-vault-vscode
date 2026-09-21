import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

/**
 * The rendering the extension exists for: a block of text becoming a table, a
 * diagram, or colored code, and going back to its source when the caret
 * arrives. All of it was verified by hand before — steps 4, 5, 12, 13 and 14 of
 * the README's manual checklist.
 */
test.describe('block rendering', () => {
	test('routes ordinary heading and block anchors to the host', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n[Heading](#target-heading) [Block](#^block-1)\n\n# Target heading\n');
		const links = page.locator('.mlp-link');
		await links.nth(0).click();
		await links.nth(1).click();
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; href?: string }> }).__posted
				.filter((message) => message.type === 'openLink').map((message) => message.href)))
			.toEqual(['#target-heading', '#^block-1']);
		await expect(links.nth(0)).toHaveAttribute('role', 'link');
		await expect(links.nth(0)).toHaveAttribute('tabindex', '0');
		await links.nth(0).focus();
		await expect(links.nth(0)).toHaveCSS('outline-style', 'solid');
		await page.keyboard.press('Enter');
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; href?: string }> }).__posted
				.filter((message) => message.type === 'openLink').map((message) => message.href)))
			.toEqual(['#target-heading', '#^block-1', '#target-heading']);
	});
	test('a table renders as a real table', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter\n');
		await expect(page.locator('.mlp-table')).toHaveCount(1);
		await expect(page.locator('.mlp-table td')).toHaveCount(2);
	});

	test('a rendered table link is keyboard-operable', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n| link |\n| --- |\n| [Docs](https://example.com) |\n');
		const link = page.locator('.mlp-table .mlp-link');
		await expect(link).toHaveAttribute('role', 'link');
		await expect(link).toHaveAttribute('tabindex', '0');
		await link.focus();
		await page.keyboard.press('Enter');
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; href?: string }> }).__posted
				.filter((message) => message.type === 'openLink').at(-1),
		)).toMatchObject({ type: 'openLink', href: 'https://example.com' });
	});

	test('CRLF notes render block syntax after offset-safe normalization', async ({ page }) => {
		await mountEditor(page, [
			'# Heading',
			'',
			'| a | b |',
			'| --- | --- |',
			'| 1 | 2 |',
			'',
			'- [ ] task',
			'',
		].join('\r\n'));
		await expect(page.locator('.cm-line', { hasText: 'Heading' })).toHaveClass(/mlp-line-h1/);
		await expect(page.locator('.mlp-table td')).toHaveCount(2);
		await expect(page.locator('.mlp-checkbox')).toHaveCount(1);
	});

	test('a blank cell keeps its column', async ({ page }) => {
		// The reported failure was later columns sliding left into the gap.
		await mountEditor(page, 'Intro\n\n| a | b | c |\n| --- | --- | --- |\n| 1 |  | 3 |\n');
		const cells = page.locator('.mlp-table td');
		await expect(cells).toHaveCount(3);
		await expect(cells.nth(0)).toHaveText('1');
		await expect(cells.nth(1)).toHaveText('');
		await expect(cells.nth(2)).toHaveText('3');
	});

	test('table structural controls target the selected row and column', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n| name | score |\n| --- | --- |\n| ten | 10 |\n| two | 2 |\n\nAfter\n');
		await page.locator('.mlp-table td').first().click();
		await page.getByRole('button', { name: 'Sort rows ascending by selected column' }).click();
		await expect(page.locator('.mlp-table td').nth(0)).toHaveText('ten');
		await expect(page.locator('.mlp-table td').nth(2)).toHaveText('two');

		await page.locator('.mlp-table td').nth(1).click();
		await page.getByRole('button', { name: 'Sort rows ascending by selected column' }).click();
		await expect(page.locator('.mlp-table td').nth(0)).toHaveText('two');
		await expect(page.locator('.mlp-table td').nth(2)).toHaveText('ten');
		await page.locator('.mlp-table td').nth(1).click();
		await page.getByRole('button', { name: 'Sort rows descending by selected column' }).click();
		await expect(page.locator('.mlp-table td').nth(0)).toHaveText('ten');
		await expect(page.locator('.mlp-table td').nth(2)).toHaveText('two');

		await page.locator('.mlp-table th').nth(1).click();
		await page.getByRole('button', { name: 'Cycle selected column alignment' }).click();
		await expect(page.locator('.mlp-table th').nth(1)).toHaveCSS('text-align', 'left');
	});

	test('table controls insert relative to the selected row and column', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n| a | b |\n| --- | --- |\n| one | 1 |\n| two | 2 |\n\nAfter\n');
		const toolbar = page.getByRole('toolbar', { name: 'Table editing controls' });
		await expect(toolbar).toBeVisible();

		await page.locator('.mlp-table td').nth(2).click();
		await toolbar.getByRole('button', { name: 'Insert row above selected row' }).click();
		await expect(page.locator('.mlp-table td')).toHaveCount(6);
		await expect(page.locator('.mlp-table td').nth(0)).toHaveText('one');
		await expect(page.locator('.mlp-table td').nth(2)).toHaveText('');
		await expect(page.locator('.mlp-table td').nth(4)).toHaveText('two');

		await page.locator('.mlp-table td').nth(0).click();
		await page.getByRole('button', { name: 'Insert row below selected row' }).click();
		await expect(page.locator('.mlp-table td')).toHaveCount(8);
		await expect(page.locator('.mlp-table td').nth(0)).toHaveText('one');
		await expect(page.locator('.mlp-table td').nth(2)).toHaveText('');

		await page.locator('.mlp-table th').nth(1).click();
		await page.getByRole('button', { name: 'Insert column left of selected column' }).click();
		await expect(page.locator('.mlp-table th')).toHaveCount(3);
		await expect(page.locator('.mlp-table th').nth(0)).toHaveText('a');
		await expect(page.locator('.mlp-table th').nth(1)).toHaveText('');
		await expect(page.locator('.mlp-table th').nth(2)).toHaveText('b');

		await page.locator('.mlp-table th').first().click();
		await page.getByRole('button', { name: 'Insert column right of selected column' }).click();
		await expect(page.locator('.mlp-table th')).toHaveCount(4);
		await expect(page.locator('.mlp-table th').nth(0)).toHaveText('a');
		await expect(page.locator('.mlp-table th').nth(1)).toHaveText('');

		await page.getByRole('button', { name: 'Add a row' }).click();
		await expect(page.locator('.mlp-table td')).toHaveCount(20);
		await page.getByRole('button', { name: 'Add a column' }).click();
		await expect(page.locator('.mlp-table th')).toHaveCount(5);
	});

	test('table controls move and delete the selected row and column', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n| a | b | c |\n| --- | --- | --- |\n| one | 1 | x |\n| two | 2 | y |\n| three | 3 | z |\n\nAfter\n');

		await page.locator('.mlp-table td').nth(6).click();
		await page.getByRole('button', { name: 'Move selected row up' }).click();
		await expect(page.locator('.mlp-table td').nth(3)).toHaveText('three');
		await page.locator('.mlp-table td').nth(3).click();
		await page.getByRole('button', { name: 'Move selected row down' }).click();
		await expect(page.locator('.mlp-table td').nth(6)).toHaveText('three');

		await page.locator('.mlp-table th').nth(2).click();
		await page.getByRole('button', { name: 'Move selected column left' }).click();
		await expect(page.locator('.mlp-table th').nth(1)).toHaveText('c');
		await page.locator('.mlp-table th').nth(1).click();
		await page.getByRole('button', { name: 'Move selected column right' }).click();
		await expect(page.locator('.mlp-table th').nth(2)).toHaveText('c');

		await page.locator('.mlp-table td').nth(3).click();
		await page.getByRole('button', { name: 'Delete selected row' }).click();
		await expect(page.locator('.mlp-table td')).toHaveCount(6);
		await page.locator('.mlp-table th').nth(1).click();
		await page.getByRole('button', { name: 'Delete selected column' }).click();
		await expect(page.locator('.mlp-table th')).toHaveCount(2);
	});

	test('table cells and structural actions are operable without a pointer', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n| a | b |\n| --- | --- |\n| one | 1 |\n| two | 2 |\n\nAfter\n');
		const cells = page.locator('.mlp-table-cell');
		await cells.first().focus();
		await expect(cells.first()).toBeFocused();
		await expect(cells.first()).toHaveCSS('outline-style', 'solid');

		await page.keyboard.press('ArrowRight');
		await expect(page.locator('.mlp-table th').nth(1)).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(page.locator('.mlp-table td').nth(1)).toBeFocused();

		await page.keyboard.press('Enter');
		await expect(page.locator('.mlp-table td').nth(1)).toHaveAttribute('contenteditable', 'true');
		await page.keyboard.type('42');
		await page.keyboard.press('Enter');
		await expect(page.locator('.mlp-table td').nth(1)).toHaveText('42');
		await page.locator('.mlp-table td').first().focus();
		await page.keyboard.press('F2');
		await expect(page.locator('.mlp-table td').first()).toHaveAttribute('contenteditable', 'true');
		await page.keyboard.press('Escape');
		await expect(page.locator('.mlp-table td').first()).toHaveText('one');

		await page.locator('.mlp-table td').nth(2).focus();
		const insertAbove = page.getByRole('button', { name: 'Insert row above selected row' });
		await expect(insertAbove).toBeEnabled();
		await insertAbove.focus();
		await page.keyboard.press('Enter');
		await expect(page.locator('.mlp-table td')).toHaveCount(6);
		await expect(page.locator('.mlp-table td').nth(2)).toHaveText('');
	});

	test('keeps a keyboard-focused table mounted across editor refreshes', async ({ page }) => {
		const source = 'Intro\n\n| a | b |\n| --- | --- |\n| one | 1 |\n\nAfter\n';
		await mountEditor(page, source);
		const cells = page.locator('.mlp-table-cell');
		await cells.first().focus();

		// A real custom-editor host can park CodeMirror's document selection at the
		// widget's source position while DOM focus remains in the accessible grid.
		// The table must survive both that dispatch and later metadata refreshes.
		await postToWebview(page, { type: 'setCursor', pos: source.indexOf('| a') + 2 });
		await expect(cells.first()).toBeFocused();
		await expect(page.locator('.mlp-table')).toHaveCount(1);

		await page.keyboard.press('ArrowRight');
		await postToWebview(page, { type: 'vaultNotes', notes: [] });
		await expect(page.locator('.mlp-table th').nth(1)).toBeFocused();
		await expect(page.locator('.mlp-table')).toHaveCount(1);

		await page.keyboard.press('ArrowDown');
		await postToWebview(page, { type: 'vaultNotes', notes: [] });
		await expect(page.locator('.mlp-table td').nth(1)).toBeFocused();
		await expect(page.locator('.mlp-table')).toHaveCount(1);
	});

	test('a table directly under a bullet still renders', async ({ page }) => {
		// No blank line between the list item and the table; stock GFM would treat
		// the pipes as paragraph text.
		await mountEditor(page, '- item\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |\n\nAfter\n');
		await expect(page.locator('.mlp-table')).toHaveCount(1);
	});

	test('headings shrink from h4 through h6', async ({ page }) => {
		await mountEditor(page, 'Top\n\n#### Four\n\n##### Five\n\n###### Six\n');
		const sizeOf = async (text: string) =>
			parseFloat(
				await page
					.locator('.cm-line', { hasText: text })
					.first()
					.evaluate((el) => getComputedStyle(el).fontSize),
			);
		const four = await sizeOf('Four');
		const five = await sizeOf('Five');
		const six = await sizeOf('Six');
		expect(four).toBeGreaterThan(five);
		expect(five).toBeGreaterThan(six);
	});

	test('a task list renders checkboxes', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n- [ ] todo\n- [x] done\n');
		await expect(page.locator('.mlp-checkbox')).toHaveCount(2);
		await expect(page.locator('.mlp-checkbox-checked')).toHaveCount(1);
	});

	test('renders nested inline and YAML tags without styling headings or code', async ({ page }) => {
		await mountEditor(page, '---\ntags: [work/active, secure]\n---\n# Heading\n\nUse #work/active and `#not-code`.\n');
		await expect(page.locator('.mlp-tag')).toHaveText('#work/active');
		await expect(page.locator('.mlp-property-tag')).toHaveCount(2);
		await expect(page.locator('.mlp-property-tag').first()).toHaveText('#work/active');
		await expect(page.locator('.cm-line', { hasText: 'Heading' }).locator('.mlp-tag')).toHaveCount(0);
		await expect(page.locator('.mlp-inline-code')).toHaveText('#not-code');
	});

	test('task checkboxes work with pointer and keyboard input', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n- [ ] todo\n');
		const checkbox = page.getByRole('checkbox');
		await expect(checkbox).toHaveAttribute('tabindex', '0');
		await checkbox.click();
		await expect(page.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
		await page.getByRole('checkbox').focus();
		await page.keyboard.press('Space');
		await expect(page.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
	});

	test('a fenced code block is colorized from the host tokens', async ({ page }) => {
		// Highlighting is computed on the host (Shiki) and arrives as offsets into
		// the document, so what this drives is the webview's half of it.
		const doc = 'Intro\n\n```python\nx = 1\n```\n';
		await mountEditor(page, doc);
		const codeStart = doc.indexOf('x = 1');
		await postToWebview(page, {
			type: 'codeTokens',
			blocks: [
				{
					from: doc.indexOf('```python'),
					to: doc.length,
					tokens: [{ from: codeStart, to: codeStart + 5, style: 'color:#569cd6' }],
				},
			],
		});
		const colored = page.locator('.cm-content [style*="569cd6"], .cm-content [style*="86, 156, 214"]');
		await expect(colored.first()).toBeVisible({ timeout: 5000 });
	});

	test('a CSS theme sent by the host reaches the document', async ({ page }) => {
		await mountEditor(page, '# Themed\n\nBody\n');
		await postToWebview(page, { type: 'applyCss', css: 'h1 { color: rgb(1, 2, 3); }' });
		const style = page.locator('#mlp-user-css');
		await expect(style).toHaveCount(1);
		const css = await style.evaluate((el) => el.textContent ?? '');
		expect(css).toContain('rgb(1, 2, 3)');
	});

	test('an external edit from the host is applied', async ({ page }) => {
		await mountEditor(page, '# One\n');
		await postToWebview(page, {
			type: 'externalUpdate',
			version: 1,
			changes: [{ from: 2, to: 5, insert: 'Two' }],
		});
		await expect(page.locator('.cm-content')).toContainText('Two');
	});
});
