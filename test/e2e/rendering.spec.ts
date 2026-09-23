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
		await expect(page.locator('.mlp-table thead th')).toHaveCount(2);
		await expect(page.locator('.mlp-table thead th').first()).toHaveAttribute('scope', 'col');
		await expect(page.locator('.mlp-table thead th').first()).toHaveCSS('position', 'sticky');
		await expect(page.locator('.mlp-table td')).toHaveCount(2);
	});

	test('wide tables scroll horizontally without squeezing columns or the editor', async ({ page }) => {
		await page.setViewportSize({ width: 640, height: 720 });
		await mountEditor(page, 'Intro\n\n| First column with a long heading | Second column with a long heading | Third column with a long heading | Fourth column with a long heading |\n| --- | --- | --- | --- |\n| first readable value | second readable value | third readable value | fourth readable value |\n\nAfter\n');
		const viewport = page.locator('.mlp-table-viewport');
		await expect(viewport).toHaveClass(/mlp-table-scrollable/);
		const before = await viewport.evaluate((element) => ({
			clientWidth: element.clientWidth,
			scrollWidth: element.scrollWidth,
			columnWidth: element.querySelector('th')!.getBoundingClientRect().width,
		}));
		expect(before.scrollWidth).toBeGreaterThan(before.clientWidth);
		expect(before.columnWidth).toBeGreaterThan(180);
		await viewport.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
		await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
		const editor = await page.locator('.cm-scroller').evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
		expect(editor.scrollWidth).toBeLessThanOrEqual(editor.clientWidth + 2);
	});

	test('bare HTML line breaks in table cells render as lines, but active HTML stays inert', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n| Details |\n| --- |\n| First<br>Second |\n| <img src=x onerror=alert(1)> |\n\nAfter\n');
		await expect(page.locator('.mlp-table tbody tr').first().locator('br')).toHaveCount(1);
		await expect(page.locator('.mlp-table tbody tr').first()).toHaveText('FirstSecond');
		await expect(page.locator('.mlp-table tbody tr').nth(1)).toContainText('<img src=x onerror=alert(1)>');
		await expect(page.locator('.mlp-table tbody img')).toHaveCount(0);
	});

	test('a long table keeps its header at the top while its rows scroll', async ({ page }) => {
		const rows = Array.from({ length: 45 }, (_, index) => `| Row ${index + 1} | Value ${index + 1} |`).join('\n');
		await mountEditor(page, `${'Before\n\n'.repeat(18)}| Name | Value |\n| --- | --- |\n${rows}\n\nAfter\n`);
		await page.evaluate(() => {
			const scroller = document.querySelector('.cm-scroller') as HTMLElement;
			const table = document.querySelector('.mlp-table') as HTMLElement;
			const scrollerTop = scroller.getBoundingClientRect().top;
			scroller.scrollTop += table.getBoundingClientRect().top - scrollerTop + 80;
		});
		await page.waitForTimeout(50);
		const bounds = await page.evaluate(() => {
			const scroller = document.querySelector('.cm-scroller')!.getBoundingClientRect();
			const header = document.querySelector('.mlp-table thead th')!.getBoundingClientRect();
			const table = document.querySelector('.mlp-table')!.getBoundingClientRect();
			return { scrollerTop: scroller.top, headerTop: header.top, headerBottom: header.bottom, tableBottom: table.bottom };
		});
		expect(Math.abs(bounds.headerTop - bounds.scrollerTop)).toBeLessThanOrEqual(2);
		expect(bounds.headerBottom).toBeLessThan(bounds.tableBottom);
	});

	test('a wide long table keeps its header sticky while scrolling vertically', async ({ page }) => {
		await page.setViewportSize({ width: 640, height: 720 });
		const rows = Array.from({ length: 45 }, (_, index) => `| Row ${index + 1} with detail | Value ${index + 1} with long detail | Another ${index + 1} value with detail |`).join('\n');
		await mountEditor(page, `${'Before\n\n'.repeat(18)}| First long heading | Second long heading | Third long heading |\n| --- | --- | --- |\n${rows}\n\nAfter\n`);
		await expect(page.locator('.mlp-table-viewport')).toHaveClass(/mlp-table-scrollable/);
		await page.evaluate(() => {
			const scroller = document.querySelector('.cm-scroller') as HTMLElement;
			const table = document.querySelector('.mlp-table') as HTMLElement;
			scroller.scrollTop += table.getBoundingClientRect().top - scroller.getBoundingClientRect().top + 80;
		});
		await expect(page.locator('.mlp-table-sticky-header')).not.toHaveAttribute('hidden');
		const bounds = await page.evaluate(() => ({
			scrollerTop: document.querySelector('.cm-scroller')!.getBoundingClientRect().top,
			headerTop: document.querySelector('.mlp-sticky-table thead th')!.getBoundingClientRect().top,
		}));
		expect(Math.abs(bounds.headerTop - bounds.scrollerTop)).toBeLessThanOrEqual(2);
		const viewport = page.locator('.mlp-table-viewport');
		for (const offset of [120, 10000, 0]) {
			await viewport.evaluate((element, left) => { element.scrollLeft = left; }, offset);
			await expect.poll(() => page.evaluate(() => {
				const original = Array.from(document.querySelectorAll('.mlp-table thead th'));
				const sticky = Array.from(document.querySelectorAll('.mlp-sticky-table thead th'));
				return Math.max(...original.map((cell, index) => Math.abs(cell.getBoundingClientRect().left - sticky[index].getBoundingClientRect().left)));
			})).toBeLessThanOrEqual(2);
		}
		const header = await page.locator('.mlp-table-sticky-clip').boundingBox();
		expect(header).not.toBeNull();
		await page.mouse.move(header!.x + 80, header!.y + 10);
		await page.mouse.wheel(100, 0);
		await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
		await expect.poll(() => page.evaluate(() => {
			const body = document.querySelector('.mlp-table-viewport')!;
			const header = document.querySelector('.mlp-table-sticky-clip')!;
			return Math.abs(body.scrollLeft - header.scrollLeft);
		})).toBeLessThanOrEqual(1);
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

	test('table options start closed and support keyboard dismissal and contextual actions', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n| a | b |\n| --- | --- |\n| one | 1 |\n\nAfter\n');
		const options = page.getByRole('button', { name: 'Table options', exact: true });
		const toolbar = page.getByRole('toolbar', { name: 'Table editing controls' });
		await expect(options).toHaveAttribute('aria-expanded', 'false');
		await expect(toolbar).toBeHidden();
		await options.press('Enter');
		await expect(toolbar).toBeVisible();
		await expect(toolbar.getByText('Select a table cell to enable row and column actions.')).toBeVisible();
		await expect(toolbar.getByRole('button', { name: 'Delete selected row' })).toBeDisabled();
		await options.press('Tab');
		await expect(toolbar.locator('button').first()).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(toolbar.getByRole('button', { name: 'Select entire table' })).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(toolbar).toBeHidden();
		await expect(options).toBeFocused();
		await page.locator('.mlp-table td').first().focus();
		await options.press('Space');
		await expect(toolbar.getByRole('button', { name: 'Delete selected row' })).toBeEnabled();
		await expect(toolbar.getByText('Select a table cell to enable row and column actions.')).toBeHidden();
		await page.locator('.mlp-table-wrap').screenshot({ path: test.info().outputPath('table-options.png') });
		await page.locator('.cm-line', { hasText: /^After$/ }).click();
		await expect(toolbar).toBeHidden();
	});

	test('table structural controls target the selected row and column', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n| name | score |\n| --- | --- |\n| ten | 10 |\n| two | 2 |\n\nAfter\n');
		await page.locator('.mlp-table td').first().click();
		await page.getByRole('button', { name: 'Table options', exact: true }).click();
		await page.getByRole('button', { name: 'Sort rows ascending by selected column' }).click();
		await expect(page.locator('.mlp-table td').nth(0)).toHaveText('ten');
		await expect(page.locator('.mlp-table td').nth(2)).toHaveText('two');

		await page.locator('.mlp-table td').nth(1).click();
		await page.getByRole('button', { name: 'Table options', exact: true }).click();
		await page.getByRole('button', { name: 'Sort rows ascending by selected column' }).click();
		await expect(page.locator('.mlp-table td').nth(0)).toHaveText('two');
		await expect(page.locator('.mlp-table td').nth(2)).toHaveText('ten');
		await page.locator('.mlp-table td').nth(1).click();
		await page.getByRole('button', { name: 'Table options', exact: true }).click();
		await page.getByRole('button', { name: 'Sort rows descending by selected column' }).click();
		await expect(page.locator('.mlp-table td').nth(0)).toHaveText('ten');
		await expect(page.locator('.mlp-table td').nth(2)).toHaveText('two');

		await page.locator('.mlp-table th').nth(1).click();
		await page.getByRole('button', { name: 'Table options', exact: true }).click();
		await page.getByRole('button', { name: 'Cycle selected column alignment' }).click();
		await expect(page.locator('.mlp-table th').nth(1)).toHaveCSS('text-align', 'left');
	});

	test('table controls insert relative to the selected row and column', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n| a | b |\n| --- | --- |\n| one | 1 |\n| two | 2 |\n\nAfter\n');
		const toolbar = page.getByRole('toolbar', { name: 'Table editing controls' });
		await expect(toolbar).toBeHidden();

		await page.locator('.mlp-table td').nth(2).click();
		await page.getByRole('button', { name: 'Table options', exact: true }).click();
		await toolbar.getByRole('button', { name: 'Insert row above selected row' }).click();
		await expect(page.locator('.mlp-table td')).toHaveCount(6);
		await expect(page.locator('.mlp-table td').nth(0)).toHaveText('one');
		await expect(page.locator('.mlp-table td').nth(2)).toHaveText('');
		await expect(page.locator('.mlp-table td').nth(4)).toHaveText('two');

		await page.locator('.mlp-table td').nth(0).click();
		await page.getByRole('button', { name: 'Table options', exact: true }).click();
		await page.getByRole('button', { name: 'Insert row below selected row' }).click();
		await expect(page.locator('.mlp-table td')).toHaveCount(8);
		await expect(page.locator('.mlp-table td').nth(0)).toHaveText('one');
		await expect(page.locator('.mlp-table td').nth(2)).toHaveText('');

		await page.locator('.mlp-table th').nth(1).click();
		await page.getByRole('button', { name: 'Table options', exact: true }).click();
		await page.getByRole('button', { name: 'Insert column left of selected column' }).click();
		await expect(page.locator('.mlp-table th')).toHaveCount(3);
		await expect(page.locator('.mlp-table th').nth(0)).toHaveText('a');
		await expect(page.locator('.mlp-table th').nth(1)).toHaveText('');
		await expect(page.locator('.mlp-table th').nth(2)).toHaveText('b');

		await page.locator('.mlp-table th').first().click();
		await page.getByRole('button', { name: 'Table options', exact: true }).click();
		await page.getByRole('button', { name: 'Insert column right of selected column' }).click();
		await expect(page.locator('.mlp-table th')).toHaveCount(4);
		await expect(page.locator('.mlp-table th').nth(0)).toHaveText('a');
		await expect(page.locator('.mlp-table th').nth(1)).toHaveText('');

		await page.getByRole('button', { name: 'Add a row' }).click();
		await expect(page.locator('.mlp-table td')).toHaveCount(20);
		await page.getByRole('button', { name: 'Add a column' }).click();
		await expect(page.locator('.mlp-table th')).toHaveCount(5);
	});

	test('mouse-selected table text can be copied without entering cell editing', async ({ page }) => {
		await mountEditor(page, 'Before\n\n| Name | Value |\n| --- | --- |\n| Alpha | Bravo |\n\nAfter\n');
		const cell = page.locator('.mlp-table td').first();
		const box = await cell.boundingBox();
		expect(box).not.toBeNull();
		await page.mouse.move(box!.x + 8, box!.y + box!.height / 2);
		await page.mouse.down();
		await page.mouse.move(box!.x + box!.width - 8, box!.y + box!.height / 2, { steps: 8 });
		await page.mouse.up();

		expect((await page.evaluate(() => window.getSelection()?.toString() ?? '')).trim()).toBe('Alpha');
		await expect(cell).not.toHaveAttribute('contenteditable', 'true');
	});

	test('an entire rendered table can be selected, copied as Markdown, and deleted', async ({ page }) => {
		const tableSource = '| Name | Value |\n| --- | --- |\n| Alpha | Bravo |';
		await mountEditor(page, `Before\n\n${tableSource}\n\nAfter\n`);
		const selectTable = page.getByRole('button', { name: 'Select entire table' });
		await page.getByRole('button', { name: 'Table options', exact: true }).click();
		await selectTable.click();
		await expect(page.locator('.mlp-table-wrap')).toHaveClass(/mlp-table-block-selected/);

		await page.evaluate(() => {
			document.addEventListener('copy', (event) => {
				(window as unknown as { __copiedTable?: string }).__copiedTable = event.clipboardData?.getData('text/plain') ?? '';
			}, { once: true });
		});
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c');
		await expect.poll(() => page.evaluate(() => (window as unknown as { __copiedTable?: string }).__copiedTable)).toBe(tableSource);

		await page.keyboard.press('Backspace');
		await expect(page.locator('.mlp-table')).toHaveCount(0);
		await expect(page.locator('.cm-content')).toContainText('Before');
		await expect(page.locator('.cm-content')).toContainText('After');
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; changes?: Array<{ insert: string }> }> }).__posted
				.filter((message) => message.type === 'edit').at(-1)?.changes?.[0]?.insert,
		)).toBe('');
	});

	test('table controls move and delete the selected row and column', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n| a | b | c |\n| --- | --- | --- |\n| one | 1 | x |\n| two | 2 | y |\n| three | 3 | z |\n\nAfter\n');

		await page.locator('.mlp-table td').nth(6).click();
		await page.getByRole('button', { name: 'Table options', exact: true }).click();
		await page.getByRole('button', { name: 'Move selected row up' }).click();
		await expect(page.locator('.mlp-table td').nth(3)).toHaveText('three');
		await page.locator('.mlp-table td').nth(3).click();
		await page.getByRole('button', { name: 'Table options', exact: true }).click();
		await page.getByRole('button', { name: 'Move selected row down' }).click();
		await expect(page.locator('.mlp-table td').nth(6)).toHaveText('three');

		await page.locator('.mlp-table th').nth(2).click();
		await page.getByRole('button', { name: 'Table options', exact: true }).click();
		await page.getByRole('button', { name: 'Move selected column left' }).click();
		await expect(page.locator('.mlp-table th').nth(1)).toHaveText('c');
		await page.locator('.mlp-table th').nth(1).click();
		await page.getByRole('button', { name: 'Table options', exact: true }).click();
		await page.getByRole('button', { name: 'Move selected column right' }).click();
		await expect(page.locator('.mlp-table th').nth(2)).toHaveText('c');

		await page.locator('.mlp-table td').nth(3).click();
		await page.getByRole('button', { name: 'Table options', exact: true }).click();
		await page.getByRole('button', { name: 'Delete selected row' }).click();
		await expect(page.locator('.mlp-table td')).toHaveCount(6);
		await page.locator('.mlp-table th').nth(1).click();
		await page.getByRole('button', { name: 'Table options', exact: true }).click();
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
		await page.getByRole('button', { name: 'Table options', exact: true }).press('Enter');
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
		await expect(page.locator('.cm-line', { hasText: 'todo' })).toHaveCSS('text-decoration-line', 'none');
		await expect(page.locator('.cm-line', { hasText: 'done' })).toHaveCSS('text-decoration-line', 'line-through');
	});

	test('checking and unchecking a task updates its Obsidian-style strikethrough', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n- [ ] Toggle me\n');
		const taskLine = page.locator('.cm-line', { hasText: 'Toggle me' });
		const checkbox = page.getByRole('checkbox');

		await expect(taskLine).toHaveCSS('text-decoration-line', 'none');
		await checkbox.click();
		await expect(taskLine).toHaveCSS('text-decoration-line', 'line-through');
		await page.getByRole('checkbox').click();
		await expect(taskLine).toHaveCSS('text-decoration-line', 'none');
	});

	test('treats every non-empty Obsidian task status as completed', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n- [ ] Open\n- [x] Done\n- [?] Question\n- [-] Canceled\n');
		await expect(page.locator('.mlp-checkbox')).toHaveCount(4);
		await expect(page.locator('.mlp-checkbox-checked')).toHaveCount(3);
		await expect(page.locator('.mlp-line-task-complete')).toHaveCount(3);
		await page.locator('.mlp-checkbox').nth(2).click();
		await expect(page.locator('.mlp-checkbox').nth(2)).toHaveAttribute('aria-checked', 'false');
		await expect(page.locator('.mlp-line-task-complete')).toHaveCount(2);
	});

	test('renders Obsidian highlight syntax and reveals its markers at the caret', async ({ page }) => {
		await mountEditor(page, 'Before ==highlighted text== after.\n\n`==literal code==`\n');
		await page.locator('.mlp-inline-code').click();
		await expect(page.locator('.mlp-highlight')).toHaveText('highlighted text');
		await expect(page.locator('.cm-content')).not.toContainText('==highlighted text==');
		await expect(page.locator('.mlp-highlight')).toHaveCount(1);
		await page.locator('.mlp-highlight').click();
		await expect(page.locator('.cm-content')).toContainText('==highlighted text==');
	});

	test('nested bullet levels use solid, hollow, and square markers', async ({ page }) => {
		await mountEditor(page, '- Top\n  - Child\n    - Grandchild\n\nAfter\n');
		await page.locator('.cm-line', { hasText: 'After' }).click();

		const bullets = page.locator('.mlp-bullet');
		await expect(bullets).toHaveCount(3);
		await expect(bullets.nth(0)).toHaveText('•');
		await expect(bullets.nth(1)).toHaveText('◦');
		await expect(bullets.nth(2)).toHaveText('▪');
		await expect(bullets.nth(0)).toHaveClass(/mlp-bullet-1/);
		await expect(bullets.nth(1)).toHaveClass(/mlp-bullet-2/);
		await expect(bullets.nth(2)).toHaveClass(/mlp-bullet-3/);
	});

	test('changes a bullet marker automatically when Tab creates a sub-bullet', async ({ page }) => {
		await mountEditor(page, '- Parent\n- Child\n\nAfter\n');
		await page.locator('.cm-line', { hasText: 'Child' }).click();
		await page.keyboard.press('Tab');
		await page.locator('.cm-line', { hasText: 'After' }).click();

		const bullets = page.locator('.mlp-bullet');
		await expect(bullets).toHaveCount(2);
		await expect(bullets.nth(0)).toHaveText('•');
		await expect(bullets.nth(1)).toHaveText('◦');
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

	test('code blocks with eight or more lines can be collapsed and expanded', async ({ page }) => {
		const sevenLines = Array.from({ length: 7 }, (_, index) => `tiny ${index + 1}`).join('\n');
		const eightLines = Array.from({ length: 8 }, (_, index) => `short ${index + 1}`).join('\n');
		const nineLines = Array.from({ length: 9 }, (_, index) => `long ${index + 1}`).join('\n');
		await mountEditor(page, `\`\`\`text\n${sevenLines}\n\`\`\`\n\n\`\`\`text\n${eightLines}\n\`\`\`\n\n\`\`\`text\n${nineLines}\n\`\`\`\n`);

		const collapse = page.getByRole('button', { name: 'Collapse code block' });
		await expect(collapse).toHaveCount(2);
		await expect(collapse.first()).toHaveAttribute('aria-expanded', 'true');
		await collapse.first().click();
		await expect(page.getByRole('button', { name: 'Expand code block' })).toHaveAttribute('aria-expanded', 'false');
		await expect(page.locator('.cm-content')).not.toContainText('short 8');
		await expect(page.locator('.cm-content')).toContainText('long 9');

		await page.getByRole('button', { name: 'Expand code block' }).press('Enter');
		await expect(page.getByRole('button', { name: 'Collapse code block' })).toHaveCount(2);
		await expect(page.locator('.cm-content')).toContainText('short 8');
	});

	test('an unfinished eight-line fence folds in locked mode without losing its final line', async ({ page }) => {
		const code = Array.from({ length: 8 }, (_, index) => `unfinished ${index + 1}`).join('\n');
		await mountEditor(page, `\`\`\`text\n${code}`, { editingMode: 'locked' });
		await page.getByRole('button', { name: 'Collapse code block' }).press('Enter');
		await expect(page.locator('.cm-content')).not.toContainText('unfinished 8');
		await page.getByRole('button', { name: 'Expand code block' }).press('Space');
		await expect(page.locator('.cm-content')).toContainText('unfinished 8');
		await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
	});

	test('large code stays folded after scrolling and unrelated edits, and copies all hidden lines', async ({ page }) => {
		const code = Array.from({ length: 200 }, (_, index) => `code line ${index + 1}`).join('\n');
		await mountEditor(page, `Before\n\n\`\`\`text\n${code}\n\`\`\`\n\nAfter\n\n${'paragraph\n\n'.repeat(200)}`);
		await page.getByRole('button', { name: 'Collapse code block' }).click();
		await expect(page.locator('.cm-content')).not.toContainText('code line 2');
		await page.locator('.cm-line', { hasText: /^After$/ }).click();
		await page.keyboard.press('End');
		await page.keyboard.type(' edited');
		// Finish the caret's scheduled scroll-to-view before testing a separate
		// user scroll; otherwise the pending layout can undo this scroll.
		await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
		await page.locator('.cm-scroller').evaluate((element) => { element.scrollTop = element.scrollHeight; });
		await expect.poll(() => page.locator('.cm-scroller').evaluate((element) => element.scrollTop)).toBeGreaterThan(500);
		await page.setViewportSize({ width: 800, height: 500 });
		await page.locator('.cm-scroller').evaluate((element) => { element.scrollTop = 0; });
		await expect(page.getByRole('button', { name: 'Expand code block' })).toBeVisible();
		await expect(page.locator('.cm-content')).not.toContainText('code line 2');
		await page.getByRole('button', { name: 'Copy code block', exact: true }).click();
		await expect.poll(() => page.evaluate(() => (window as unknown as { __posted: Array<{ type: string; text?: string }> }).__posted.find((message) => message.type === 'copyCode')?.text)).toBe(code);
		await page.getByRole('button', { name: 'Expand code block' }).press('Space');
		await expect(page.locator('.cm-content')).toContainText('code line 2');
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
