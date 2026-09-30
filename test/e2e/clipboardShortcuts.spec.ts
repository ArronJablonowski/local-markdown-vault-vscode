import { expect, test, type Page } from '@playwright/test';
import { mountEditor } from './harness';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

async function source(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate(content => {
		return (content as HTMLElement & { cmTile: { root: { view: { state: { doc: { toString(): string } } } } } }).cmTile.root.view.state.doc.toString();
	});
}

async function mountWithHostClipboardBoundary(page: Page, text: string, locked = false): Promise<void> {
	// A secure test origin enables the real browser clipboard, not a paste-event stub.
	await page.route('https://clipboard-qa.invalid/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }));
	await page.goto('https://clipboard-qa.invalid/');
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	await mountEditor(page, text, { editingMode: locked ? 'locked' : 'editing' });
	await page.evaluate(() => {
		(window as any).__forwardedClipboardKeys = [];
		(window as any).__forwardedSelectAll = [];
		(window as any).__nativeClipboardEvents = [];
		// This models VS Code's Electron boundary: forwarded keys lose browser default
		// behavior and are replayed asynchronously after subsequent editor actions.
		window.addEventListener('keydown', event => {
			if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') (window as any).__forwardedSelectAll.push(event.key);
			if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && ['c', 'x', 'v'].includes(event.key.toLowerCase())) {
				(window as any).__forwardedClipboardKeys.push(event.key);
				event.preventDefault();
			}
		});
		for (const kind of ['copy', 'cut', 'paste']) document.addEventListener(kind, () => (window as any).__nativeClipboardEvents.push(kind), true);
	});
}

async function selectPrefixWithMouse(page: Page, prefix: string): Promise<void> {
	const point = await page.locator('.cm-line').first().evaluate((line, length) => {
		const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
		const text = walker.nextNode()!;
		const range = document.createRange();
		range.setStart(text, 0);
		range.setEnd(text, length);
		const box = range.getBoundingClientRect();
		return { x: box.x, right: box.right, y: box.y + box.height / 2 };
	}, prefix.length);
	await page.mouse.move(point.x + 0.25, point.y);
	await page.mouse.down();
	await page.mouse.move(point.right, point.y, { steps: 10 });
	await page.mouse.up();
	expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(prefix);
}

test.describe('native clipboard shortcuts stay inside the webview', () => {
	// Native clipboard state is shared by tabs; keep this file's gestures sequential.
	test.describe.configure({ mode: 'serial' });

	test('mouse copy followed immediately by deletion preserves exactly the copied prefix', async ({ page }) => {
		const original = 'Mouse selection target: preserve copied evidence precisely.';
		const prefix = 'Mouse selection tar';
		await mountWithHostClipboardBoundary(page, original);
		await selectPrefixWithMouse(page, prefix);
		await page.keyboard.press(`${modifier}+c`);
		await page.keyboard.press('Backspace');
		await expect.poll(() => source(page)).toBe(original.slice(prefix.length));
		await page.keyboard.press('Home');
		await page.keyboard.press(`${modifier}+v`);
		await expect.poll(() => source(page)).toBe(original);
		expect(await page.evaluate(() => (window as any).__forwardedClipboardKeys)).toEqual([]);
		expect(await page.evaluate(() => (window as any).__nativeClipboardEvents)).toEqual(['copy', 'paste']);
	});

	test('cut and immediate paste use browser clipboard events without losing prose', async ({ page }) => {
		const original = 'Local evidence stays intact.';
		await mountWithHostClipboardBoundary(page, original);
		await selectPrefixWithMouse(page, 'Local evidence');
		await page.keyboard.press(`${modifier}+x`);
		await expect.poll(() => source(page)).toBe(' stays intact.');
		await page.keyboard.press(`${modifier}+v`);
		await expect.poll(() => source(page)).toBe(original);
		expect(await page.evaluate(() => (window as any).__forwardedClipboardKeys)).toEqual([]);
		expect(await page.evaluate(() => (window as any).__nativeClipboardEvents)).toEqual(['cut', 'paste']);
	});

	test('copy and paste remain local inside Find and an editable table cell', async ({ page }) => {
		const original = 'Copied evidence\n\n| Item | State |\n| --- | --- |\n| Original | Keep |';
		await mountWithHostClipboardBoundary(page, original);
		await selectPrefixWithMouse(page, 'Copied evidence');
		await page.keyboard.press(`${modifier}+c`);
		await page.keyboard.press(`${modifier}+f`);
		const search = page.locator('.cm-search input[name="search"]');
		await search.click();
		await page.keyboard.press(`${modifier}+a`);
		await page.keyboard.press(`${modifier}+v`);
		await expect(search).toHaveValue('Copied evidence');
		await page.keyboard.press('Escape');
		const cell = page.locator('.mlp-table tbody td').first();
		await cell.click();
		await page.keyboard.press(`${modifier}+a`);
		await page.keyboard.press(`${modifier}+v`);
		await expect(cell).toHaveText('Copied evidence');
		await page.keyboard.press('Enter');
		await expect.poll(() => source(page)).toBe(original.replace('Original', 'Copied evidence'));
		expect(await page.evaluate(() => (window as any).__forwardedClipboardKeys)).toEqual([]);
	});

	test('locked documents allow copy but never mutate on cut or paste', async ({ page }) => {
		const original = 'Locked evidence remains intact.';
		await mountWithHostClipboardBoundary(page, original, true);
		await selectPrefixWithMouse(page, 'Locked evidence');
		await page.keyboard.press(`${modifier}+c`);
		await page.keyboard.press(`${modifier}+x`);
		await page.keyboard.press(`${modifier}+v`);
		await expect.poll(() => source(page)).toBe(original);
		expect(await page.evaluate(() => (window as any).__forwardedClipboardKeys)).toEqual([]);
		expect(await page.evaluate(() => (window as any).__nativeClipboardEvents)).toContain('copy');
	});

	test('property Select All replaces complete multi-character values without host replay', async ({ page }) => {
		const original = '---\ntitle: Original report\n---\n\nBody remains intact.';
		await mountWithHostClipboardBoundary(page, original);
		const cell = page.locator('.mlp-frontmatter tr', { hasText: 'title' }).locator('td');
		await cell.dblclick();
		const input = cell.locator('input');
		for (const replacement of ['Revised local report', 'Final accurate report']) {
			await page.keyboard.press(`${modifier}+a`);
			for (const character of replacement) await page.keyboard.type(character, { delay: 3 });
			await expect(input).toHaveValue(replacement);
		}
		await page.keyboard.press('Enter');
		await expect.poll(() => source(page)).toBe(original.replace('Original report', 'Final accurate report'));
		expect(await page.evaluate(() => (window as any).__forwardedSelectAll)).toEqual([]);
		await page.getByRole('button', { name: 'Editing: select to lock the editor', exact: true }).click();
		await cell.dblclick();
		await expect(input).toHaveCount(0);
		await expect.poll(() => source(page)).toBe(original.replace('Original report', 'Final accurate report'));
	});
});
