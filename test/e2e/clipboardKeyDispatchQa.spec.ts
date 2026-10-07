import { expect, test, type Page } from '@playwright/test';
import { mountEditor } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Model Electron's missing default command without accessing the OS clipboard. */
async function isolateClipboardCommands(page: Page, pasteText = ''): Promise<void> {
	await page.locator('.cm-content').evaluate((content, text) => {
		const view = (content as any).cmTile.root.view;
		(window as any).__clipboardCommands = [];
		(window as any).__clipboardKeys = [];
		// Fail closed if a future test accidentally sends a trusted clipboard
		// chord to a nested control that stops before the final editor guard.
		document.addEventListener('keydown', event => {
			if ((event.metaKey || event.ctrlKey) && ['c', 'x', 'v'].includes(event.key.toLowerCase()) && event.target !== content) {
				event.preventDefault();
				event.stopImmediatePropagation();
			}
		}, true);
		document.execCommand = (command: string): boolean => {
			const data = new DataTransfer();
			if (command === 'paste') data.setData('text/plain', text);
			const event = new ClipboardEvent(command, { clipboardData: data, bubbles: true, cancelable: true });
			document.activeElement?.dispatchEvent(event);
			(window as any).__clipboardCommands.push({ command, text: data.getData('text/plain'), prevented: event.defaultPrevented });
			// Canceled clipboard events may report failure after the app handled them.
			return false;
		};
		// Runs after the shipped shortcut handler, on its same bubbling boundary.
		// Record whether the app suppressed a duplicate, then prohibit OS access
		// even on the unfixed build where Copy/Cut never invoke execCommand.
		view.dom.addEventListener('keydown', (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey) || !['c', 'x', 'v'].includes(event.key.toLowerCase())) return;
			(window as any).__clipboardKeys.push({ key: event.key.toLowerCase(), prevented: event.defaultPrevented });
			event.preventDefault();
		});
	}, pasteText);
}

async function source(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate(content => (content as any).cmTile.root.view.state.doc.toString());
}

async function commands(page: Page) {
	return page.evaluate(() => (window as any).__clipboardCommands);
}

test('trusted copy and cut execute synchronously once at the selected source', async ({ page }) => {
	const original = 'Copy **exact** source with a link [label](Note.md).';
	await mountEditor(page, original);
	await isolateClipboardCommands(page, original);
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+a`);
	await page.keyboard.press(`${mod}+c`);
	expect(await commands(page)).toEqual([{ command: 'copy', text: original, prevented: true }]);
	expect(await source(page)).toBe(original);
	await page.keyboard.press(`${mod}+x`);
	expect(await source(page)).toBe('');
	await page.keyboard.press(`${mod}+v`);
	expect(await source(page)).toBe(original);
	expect(await commands(page)).toEqual(['copy', 'cut', 'paste'].map(command => ({ command, text: original, prevented: true })));
	expect(await page.evaluate(() => (window as any).__clipboardKeys))
		.toEqual(['c', 'x', 'v'].map(key => ({ key, prevented: true })));
});

test('trusted copy and cut preserve a locked source and do not queue edits', async ({ page }) => {
	const original = 'Locked **source** remains available to Copy.';
	await mountEditor(page, original, { editingMode: 'locked' });
	await isolateClipboardCommands(page);
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+a`);
	await page.keyboard.press(`${mod}+c`);
	await page.keyboard.press(`${mod}+x`);
	expect(await commands(page)).toEqual(['copy', 'cut'].map(command => ({ command, text: original, prevented: true })));
	expect(await source(page)).toBe(original);
	expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
});

for (const editingMode of ['editing', 'locked'] as const) {
	for (const activation of ['pointer', 'keyboard'] as const) test(`whole-table ${activation} selection supports native copy and cut in ${editingMode} mode`, async ({ page }) => {
		const table = '| Item | Count |\n| --- | ---: |\n| Cable | 2 |';
		const original = `Before\n\n${table}\n\nAfter`;
		await mountEditor(page, original, { editingMode });
		await isolateClipboardCommands(page);
		await page.locator('.mlp-table td').first().click();
		await page.getByRole('button', { name: 'Table options', exact: true }).click();
		const select = page.getByRole('button', { name: 'Select entire table', exact: true });
		if (activation === 'pointer') await select.click();
		else { await select.focus(); await page.keyboard.press('Enter'); }
		// A toolbar button causes native clipboard events to target document.body.
		// The action itself must restore the source focus before either command.
		await expect(page.locator('.cm-content')).toBeFocused();
		await expect(page.locator('.mlp-table-block-selected')).toHaveCount(1);
		expect(await page.locator('.cm-content').evaluate(content => {
			const state = (content as any).cmTile.root.view.state;
			return state.sliceDoc(state.selection.main.from, state.selection.main.to);
		})).toBe(table);
		await page.keyboard.down(mod);
		await expect(page.locator('.mlp-table-block-selected')).toHaveCount(1);
		await page.keyboard.press('c');
		await page.keyboard.up(mod);
		await expect(page.locator('.mlp-table-block-selected')).toHaveCount(1);
		await page.keyboard.press(`${mod}+x`);
		expect(await commands(page)).toEqual(['copy', 'cut'].map(command => ({ command, text: table, prevented: true })));
		expect(await page.evaluate(() => (window as any).__clipboardKeys)).toEqual(['c', 'x'].map(key => ({ key, prevented: true })));
		expect(await source(page)).toBe(editingMode === 'editing' ? original.replace(table, '') : original);
	});
}

for (const editingMode of ['editing', 'locked'] as const) {
	test(`second-table selection survives a redraw and preserves neighboring source in ${editingMode} mode`, async ({ page }) => {
		const first = '| First |\n| --- |\n| Preserve |';
		const second = '| Second |\n| --- |\n| Original second |';
		const original = `Before\n\n${first}\n\nBetween\n\n${second}\n\nAfter table.`;
		await mountEditor(page, original, { editingMode });
		await isolateClipboardCommands(page, 'Blocked replacement');
		await page.locator('.cm-line').last().click();
		const wrap = page.locator('.mlp-table-wrap').last();
		await wrap.locator('td').first().click();
		if (editingMode === 'editing') {
			await page.keyboard.press(`${mod}+a`);
			await page.keyboard.type('Updated second');
		}
		await wrap.getByRole('button', { name: 'Table options', exact: true }).click();
		await wrap.getByRole('button', { name: 'Select entire table', exact: true }).click();
		await expect(page.locator('.cm-content')).toBeFocused();
		const selectedTable = editingMode === 'editing' ? second.replace('Original second', 'Updated second') : second;
		const accepted = original.replace(second, selectedTable);
		expect(await source(page)).toBe(accepted);
		expect(await page.locator('.cm-content').evaluate(content => {
			const view = (content as any).cmTile.root.view;
			view.dispatch({ selection: view.state.selection });
			return view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
		})).toBe(selectedTable);
		await page.keyboard.press(`${mod}+c`);
		await page.keyboard.press(`${mod}+x`);
		expect(await commands(page)).toEqual(['copy', 'cut'].map(command => ({ command, text: selectedTable, prevented: true })));
		expect(await source(page)).toBe(editingMode === 'editing' ? accepted.replace(selectedTable, '') : accepted);
		if (editingMode === 'locked') {
			await page.keyboard.press(`${mod}+v`);
			expect(await source(page)).toBe(accepted);
			expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
		}
	});
}

for (const change of ['select-all', 'collapse-right'] as const) {
	test(`ordinary ${change} selection supersedes a previous structural table selection`, async ({ page }) => {
		const table = '| Item |\n| --- |\n| Retain |';
		const original = `Before\n\n${table}\n\nAfter table.`;
		await mountEditor(page, original);
		await isolateClipboardCommands(page);
		await page.locator('.mlp-table td').first().click();
		await page.getByRole('button', { name: 'Table options', exact: true }).click();
		await page.getByRole('button', { name: 'Select entire table', exact: true }).click();
		await expect(page.locator('.cm-content')).toBeFocused();
		await page.keyboard.press(change === 'select-all' ? `${mod}+a` : 'ArrowRight');
		const expectedCopy = await page.locator('.cm-content').evaluate(content => {
			const state = (content as any).cmTile.root.view.state;
			const selected = state.selection.main;
			return selected.empty ? state.doc.lineAt(selected.head).text : state.sliceDoc(selected.from, selected.to);
		});
		if (change === 'select-all') expect(expectedCopy).toBe(original);
		else expect(expectedCopy).not.toBe(table);
		await page.keyboard.press(`${mod}+c`);
		expect(await commands(page)).toEqual([{ command: 'copy', text: expectedCopy, prevented: true }]);
		await page.keyboard.press('Delete');
		if (change === 'select-all') expect(await source(page)).toBe('');
		else expect(await source(page)).toContain(table);
	});
}

for (const editingMode of ['editing', 'locked'] as const) {
	test(`native DOM whole-table selection retains structural copy and cut in ${editingMode} mode`, async ({ page }) => {
		const table = '| Item | Count |\n| --- | ---: |\n| Retain | 2 |';
		const original = `Before\n\n${table}\n\nAfter`;
		await mountEditor(page, original, { editingMode });
		await page.locator('.mlp-table').evaluate(async tableElement => {
			const first = tableElement.querySelector('th')!;
			const last = tableElement.querySelector('td:last-child')!;
			const start = first.getBoundingClientRect(), end = last.getBoundingClientRect();
			first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1,
				clientX: start.left + 4, clientY: start.top + start.height / 2 }));
			const selection = window.getSelection()!;
			const range = document.createRange(); range.selectNodeContents(tableElement);
			selection.removeAllRanges(); selection.addRange(range);
			last.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0,
				clientX: end.right - 4, clientY: end.top + end.height / 2 }));
			await new Promise(resolve => requestAnimationFrame(resolve));
		});
		await expect(page.locator('.mlp-table-block-selected')).toHaveCount(1);
		const result = await page.locator('.mlp-table-wrap').evaluate(wrap => {
			const copy = new DataTransfer(), cut = new DataTransfer();
			wrap.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: copy }));
			wrap.dispatchEvent(new ClipboardEvent('cut', { bubbles: true, cancelable: true, clipboardData: cut }));
			return { copy: copy.getData('text/plain'), cut: cut.getData('text/plain') };
		});
		expect(result).toEqual({ copy: table, cut: table });
		expect(await source(page)).toBe(editingMode === 'editing' ? original.replace(table, '') : original);
	});
}

test('table toolbar clipboard chords reach the shared shortcut boundary', async ({ page }) => {
	await mountEditor(page, 'Before\n\n| Item |\n| --- |\n| Cable |\n\nAfter');
	await page.locator('.mlp-table td').first().click();
	await page.getByRole('button', { name: 'Table options', exact: true }).click();
	for (const label of ['Select entire table', 'Table options']) {
		const observed = await page.getByRole('button', { name: label, exact: true }).evaluate(button => {
			const editor = button.closest('.cm-editor')!;
			const seen: string[] = [];
			const observer = (event: Event): void => { seen.push((event as KeyboardEvent).key); };
			editor.addEventListener('keydown', observer);
			for (const key of ['c', 'x', 'v', 'V']) {
				// Untrusted keyboard events cannot invoke the OS clipboard.
				button.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: true, shiftKey: key === 'V', bubbles: true, cancelable: true }));
			}
			editor.removeEventListener('keydown', observer);
			return seen;
		});
		expect(observed, label).toEqual(['c', 'x', 'v', 'V']);
	}
});

for (const editingMode of ['editing', 'locked'] as const) {
	for (const action of ['copy', 'cut', 'Delete', 'Backspace'] as const) {
		test(`Find owns ${action} after whole-table selection in ${editingMode} mode`, async ({ page }) => {
			const table = '| Item | Count |\n| --- | ---: |\n| Cable | 2 |';
			const original = `Before\n\n${table}\n\nAfter`;
			await mountEditor(page, original, { editingMode });
			await page.locator('.mlp-table td').first().click();
			await page.getByRole('button', { name: 'Table options', exact: true }).click();
			await page.getByRole('button', { name: 'Select entire table', exact: true }).click();
			await page.keyboard.press(`${mod}+f`);
			const field = page.locator('.cm-search input[name="search"]');
			await expect(field).toBeFocused();
			await field.fill('query remains');
			await field.press(`${mod}+a`);
			expect(await page.locator('.cm-content').evaluate(content => {
				const state = (content as any).cmTile.root.view.state;
				return state.sliceDoc(state.selection.main.from, state.selection.main.to);
			})).toBe(table);
			if (action === 'copy' || action === 'cut') {
				// Event-local data checks handler ownership without touching the OS
				// clipboard or pretending synthetic events perform native field edits.
				const result = await field.evaluate((input, command) => {
					const data = new DataTransfer();
					const event = new ClipboardEvent(command, { clipboardData: data, bubbles: true, cancelable: true });
					input.dispatchEvent(event);
					return { prevented: event.defaultPrevented, text: data.getData('text/plain') };
				}, action);
				expect(await source(page)).toBe(original);
				expect(result).toEqual({ prevented: false, text: '' });
				await expect(field).toHaveValue('query remains');
			} else {
				await field.press(action);
				expect(await source(page)).toBe(original);
				await expect(field).toHaveValue('');
			}
			await expect(field).toBeFocused();
			expect(await source(page)).toBe(original);
			expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit'))).toEqual([]);
			await field.press('Escape');
			await expect(page.locator('.cm-content')).toBeFocused();
			const resumedCopy = await page.locator('.cm-content').evaluate(content => {
				const data = new DataTransfer();
				content.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
				return data.getData('text/plain');
			});
			expect(resumedCopy).toBe(table);
		});
	}
}
