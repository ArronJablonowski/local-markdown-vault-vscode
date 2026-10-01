import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mountEditor } from './harness';
import { largeMixedDocument } from '../fixtures/largeMixedDocument';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const obsidian = readFileSync(join(__dirname, '../../media/sample-styles/obsidian-dark.css'), 'utf8');
const words = Array.from({ length: 42 }, (_, i) => `Review${String(i).padStart(2, '0')}`).join(' ');
test.use({ screenshot: 'only-on-failure' });

// Observe the same edits sent to the host without moving the caret or copying the document.
async function documentText(page: Page, initial: string): Promise<string> {
	const edits = await page.evaluate(() => (window as unknown as {
		__posted: Array<{ type: string; changes?: Array<{ from: number; to: number; insert: string }> }>;
	}).__posted.filter(message => message.type === 'edit'));
	for (const edit of edits) for (const change of [...edit.changes!].reverse()) {
		initial = initial.slice(0, change.from) + change.insert + initial.slice(change.to);
	}
	return initial;
}

async function goToEnd(page: Page): Promise<void> {
	await page.locator('.cm-content').focus();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
}

async function findText(page: Page, query: string): Promise<void> {
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+f`);
	const input = page.locator('.cm-search input[name="search"]');
	await input.click();
	await page.keyboard.press(`${mod}+a`);
	await page.keyboard.type(query, { delay: 1 });
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
}

async function wrappedEdges(line: Locator): Promise<number[]> {
	return line.evaluate(element => {
		const rows = new Map<number, number>();
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) for (const match of node.textContent!.matchAll(/Review\d+/g)) {
			const range = document.createRange();
			range.setStart(node, match.index!);
			range.setEnd(node, match.index! + 1);
			const rect = range.getBoundingClientRect();
			const top = Math.round(rect.top);
			rows.set(top, Math.min(rows.get(top) ?? Infinity, rect.left));
		}
		return [...rows].sort((a, b) => a[0] - b[0]).map(row => row[1]);
	});
}

async function expectWrapping(line: Locator): Promise<void> {
	await expect.poll(async () => {
		const edges = await wrappedEdges(line);
		return edges.length > 1 ? Math.max(...edges) - Math.min(...edges) : Infinity;
	}).toBeLessThan(1.5);
}

async function observeFrames(page: Page, text: string): Promise<void> {
	await page.evaluate(target => {
		const trace: Array<{ time: number; left: number; top: number; width: number; height: number; indent: string; overflow: number }> = [];
		(window as unknown as { layoutTrace: typeof trace }).layoutTrace = trace;
		const sample = (time: number) => {
			const line = Array.from(document.querySelectorAll('.cm-line')).find(row => row.textContent?.includes(target));
			const scroller = document.querySelector('.cm-scroller')!;
			if (line) {
				const rect = line.getBoundingClientRect();
				trace.push({ time, left: rect.left, top: rect.top, width: rect.width, height: rect.height, indent: getComputedStyle(line).textIndent,
					overflow: scroller.scrollWidth - scroller.clientWidth });
			}
			if (trace.length < 2000) requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
	}, text);
}

test.beforeEach(async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	(page as unknown as { layoutErrors: string[] }).layoutErrors = errors;
});
test.afterEach(async ({ page }) => {
	expect((page as unknown as { layoutErrors: string[] }).layoutErrors).toEqual([]);
});

for (const theme of ['', 'obsidian-dark.css', 'github-like.css']) {
for (const anchor of ['Final anchor', 'Final viewport anchor']) test(`large ${theme || 'default'} note keeps its ${anchor.length}-character last paragraph visible after jumping to the end`, async ({ page }, info) => {
	await page.setViewportSize({ width: 540, height: 1100 });
	await mountEditor(page, largeMixedDocument(60) + '\n' + anchor, {
		css: theme ? readFileSync(join(__dirname, '../../media/sample-styles', theme), 'utf8') : '',
	});
	await goToEnd(page);
	await observeFrames(page, anchor);
	await page.waitForTimeout(1800);
	const frames = await page.evaluate(() => (window as unknown as { layoutTrace: Array<{ top: number; height: number }> }).layoutTrace);
	await info.attach('end-navigation-frames.json', { body: JSON.stringify(frames), contentType: 'application/json' });
	await page.screenshot({ path: info.outputPath('end-navigation.png') });
	const box = await page.locator('.cm-line', { hasText: anchor }).boundingBox();
	expect(box).not.toBeNull();
	expect(box!.y).toBeGreaterThanOrEqual(0);
	expect(box!.y + box!.height).toBeLessThanOrEqual(1100);
	if (anchor.length <= 20) {
		// Protect height calibration without placing a moving noneditable widget
		// beside the native insertion point on short, actively edited prose.
		const lastLine = page.locator('.cm-line', { hasText: anchor });
		await expect(lastLine.locator('.mlp-line-measure-guard')).toHaveCount(1);
		await expect(lastLine.locator('[contenteditable="false"]')).toHaveCount(0);
	}
});
}

for (const theme of ['', obsidian]) {
	test(`large note redrafting keeps nested wrapping stable during repeated typing and resizing (${theme ? 'Obsidian' : 'default'})`, async ({ page }, info) => {
		test.setTimeout(120000);
		await page.setViewportSize({ width: 540, height: 1100 });
		const initial = largeMixedDocument(48) + `\n## Editorial review\n- Parent\n- ${words}\n\nFinal anchor`;
		await mountEditor(page, initial, { css: theme });
		await goToEnd(page);
		const line = page.locator('.cm-line', { hasText: 'Review00' });
		await expectWrapping(line);
		await observeFrames(page, 'Review00');
		for (const width of [540, 380, 800, 460]) {
			await page.setViewportSize({ width, height: 1100 });
			await findText(page, 'Review41');
			await page.keyboard.press('ArrowRight');
			for (let previous = 0; previous < [540, 380, 800, 460].indexOf(width); previous++) {
				for (let n = 0; n < ' **redraft**'.length; n++) await page.keyboard.press('ArrowRight');
			}
			await page.keyboard.type(' **redraft**', { delay: 8 });
			for (let depth = 0; depth < 2; depth++) {
				await page.keyboard.press('Tab');
				await expectWrapping(line);
			}
			for (let depth = 0; depth < 2; depth++) {
				await page.keyboard.press('Shift+Tab');
				await expectWrapping(line);
			}
			await page.locator('.cm-line', { hasText: 'Final anchor' }).click();
			await expectWrapping(line);
			await expect.poll(() => page.locator('.cm-scroller').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(2);
		}
		await expect.poll(() => documentText(page, initial)).toBe(initial.replace(words, words + ' **redraft**'.repeat(4)));
		const frames = await page.evaluate(() => (window as unknown as { layoutTrace: Array<{ width: number; height: number; overflow: number }> }).layoutTrace);
		expect(frames.length).toBeGreaterThan(20);
		expect(frames.every(frame => frame.width > 0 && frame.height > 0 && frame.overflow <= 2)).toBe(true);
		await info.attach('frame-geometry.json', { body: JSON.stringify(frames), contentType: 'application/json' });
		await page.screenshot({ path: info.outputPath('wrapped-redraft.png') });
	});
}

test('typing a callout and nested tasks at a large note end remains editable through rewrite and escape', async ({ page }, info) => {
	test.setTimeout(120000);
	if (process.env.MDLP_CALLOUT_DIAGNOSTIC) {
		const session = await page.context().newCDPSession(page);
		await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
	}
	await page.setViewportSize({ width: 660, height: 950 });
	const initial = largeMixedDocument(60) + '\n';
	await mountEditor(page, initial, { css: obsidian });
	await goToEnd(page);
	await page.locator('.cm-content').evaluate((element: any) => {
		const trace: unknown[] = [];
		(window as any).__calloutKeyTrace = trace;
		element.addEventListener('keydown', (event: KeyboardEvent) => {
			const state = element.cmTile.root.view.state;
			trace.push({ key: event.key, head: state.selection.main.head, length: state.doc.length, tail: state.doc.sliceString(Math.max(0, state.doc.length - 650)) });
		}, true);
	});
	for (const [index, text] of ['> [!warning]+ Draft review', 'Introductory **review**.', '- Parent item', 'Child item'].entries()) {
		if (index === 3) await page.keyboard.press('Tab');
		await page.keyboard.type(text, { delay: 4 });
		await page.keyboard.press('Enter');
	}
	await page.keyboard.press('Shift+Tab');
	await page.keyboard.type('[ ] Confirm draft', { delay: 4 });
	await page.keyboard.press('Enter');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Enter');
	await page.keyboard.type('Independent closing paragraph.', { delay: 4 });
	const keyTracePath = info.outputPath('callout-key-trace.json');
	writeFileSync(keyTracePath, JSON.stringify(await page.evaluate(() => (window as any).__calloutKeyTrace)));
	await info.attach('callout-key-trace', { path: keyTracePath, contentType: 'application/json' });
	const close = page.locator('.cm-line', { hasText: 'Independent closing paragraph.' });
	await expect(close).not.toHaveClass(/mlp-line-callout|mlp-line-list|mlp-line-quote/);
	await page.screenshot({ path: info.outputPath('before-fold.png') });
	await page.getByRole('button', { name: 'Draft review callout', exact: true }).click({ timeout: 10000 });
	await expect(page.getByRole('button', { name: 'Draft review callout', exact: true })).toHaveAttribute('aria-expanded', 'false');
	await expect(close).toBeVisible();
	await page.screenshot({ path: info.outputPath('after-fold.png') });
	await page.getByRole('button', { name: 'Draft review callout', exact: true }).click({ timeout: 10000 });
	const child = page.locator('.cm-line', { hasText: 'Child item' });
	await child.click();
	await page.keyboard.press('End');
	await page.keyboard.type(' with **extra details** and ==attention==.', { delay: 5 });
	await close.click();
	await expect(child.locator('.mlp-strong')).toContainText('extra details');
	await page.locator('.mlp-checkbox').last().click();
	await expect(page.locator('.cm-line', { hasText: 'Confirm draft' })).toHaveClass(/mlp-line-task-complete/);
	await expect.poll(() => documentText(page, initial)).toContain('> - [x] Confirm draft');
	await expect.poll(() => documentText(page, initial)).toContain('>   - Child item with **extra details** and ==attention==.');
	await page.screenshot({ path: info.outputPath('typed-callout-redraft.png') });
});

test('typing and deleting across the short-line guard threshold preserves source and caret at large EOF', async ({ page }) => {
	test.setTimeout(120000);
	const prefix = largeMixedDocument(60) + '\n';
	const originalLine = '**bold** boundary!';
	expect(originalLine.length).toBe(18);
	await mountEditor(page, prefix + originalLine, { css: obsidian });
	await goToEnd(page);
	let lineText = originalLine;
	const check = async () => {
		await expect.poll(() => page.locator('.cm-content').evaluate((element: any) => {
			const state = element.cmTile.root.view.state;
			return { source: state.doc.toString(), head: state.selection.main.head, empty: state.selection.main.empty };
		})).toEqual({ source: prefix + lineText, head: prefix.length + lineText.length, empty: true });
		await expect(page.locator('.cm-line', { hasText: 'boundary!' }).locator('.mlp-line-measure-guard')).toHaveCount(lineText.length <= 20 ? 1 : 0);
	};
	await check();
	for (let cycle = 0; cycle < 4; cycle++) {
		for (const character of 'ABC') {
			await page.keyboard.type(character);
			lineText += character;
			await check();
		}
		for (let deleted = 0; deleted < 3; deleted++) {
			await page.keyboard.press('Backspace');
			lineText = lineText.slice(0, -1);
			await check();
		}
	}
});

test('mouse paragraph replacement between mixed objects retains layout and exact surrounding Markdown', async ({ page }, info) => {
	test.setTimeout(120000);
	await page.setViewportSize({ width: 760, height: 1000 });
	const original = 'Editorial selection begins here. This paragraph will be rewritten through mouse selection.';
	const middle = '\n## Focused redraft\n\n' + original + '\n\n> [!note] Redraft boundary\n> Keep this adjacent note.\n\n';
	const initial = largeMixedDocument(24) + middle + largeMixedDocument(24);
	await mountEditor(page, initial, { css: obsidian });
	await findText(page, original);
	const line = page.locator('.cm-line', { hasText: original });
	await line.scrollIntoViewIfNeeded();
	const endpoints = await line.evaluate(el => {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		const node = walker.nextNode()!;
		const start = document.createRange(); start.setStart(node, 0); start.setEnd(node, 1);
		const end = document.createRange(); end.setStart(node, node.textContent!.length - 1); end.setEnd(node, node.textContent!.length);
		const a = start.getBoundingClientRect(); const b = end.getBoundingClientRect();
		return { x1: a.left, y1: a.top + a.height / 2, x2: b.right, y2: b.top + b.height / 2 };
	});
	await page.mouse.move(endpoints.x1, endpoints.y1);
	await page.mouse.down();
	await page.mouse.move(endpoints.x2, endpoints.y2, { steps: 25 });
	await page.mouse.up();
	await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(original);
	await page.keyboard.type('Revised assessment: **ready** after *manual review*.', { delay: 6 });
	await page.keyboard.press('Enter');
	await page.keyboard.press('Enter');
	await page.keyboard.type('- Verify local behavior', { delay: 6 });
	await page.keyboard.press('Enter');
	await page.keyboard.press('Tab');
	await page.keyboard.type('Review child evidence', { delay: 6 });
	await page.getByRole('button', { name: 'Redraft boundary callout', exact: true }).click();
	const replacement = 'Revised assessment: **ready** after *manual review*.\n\n- Verify local behavior\n  - Review child evidence';
	await expect.poll(() => documentText(page, initial)).toBe(initial.replace(original, replacement));
	await expect(page.locator('.cm-line', { hasText: 'Review child evidence' })).toHaveClass(/mlp-line-list/);
	await page.keyboard.press(`${mod}+z`);
	await expect.poll(() => page.evaluate(() => (window as unknown as { __posted: Array<{ type: string }> }).__posted.some(message => message.type === 'undo'))).toBe(true);
	await page.screenshot({ path: info.outputPath('mouse-redraft-middle.png') });
});

test('repeated heading and inline delimiter edits do not leave stale formatting on neighboring lines', async ({ page }, info) => {
	test.setTimeout(120000);
	await page.setViewportSize({ width: 580, height: 900 });
	const initial = largeMixedDocument(48) + '\nAnchor before\n\nDraft target\n\nAnchor after';
	await mountEditor(page, initial, { css: obsidian });
	await goToEnd(page);
	const target = page.locator('.cm-line', { hasText: 'Draft target' });
	for (let level = 1; level <= 6; level++) {
		await target.click();
		await page.keyboard.press('Home');
		await page.keyboard.type('#'.repeat(level) + ' ', { delay: 20 });
		await page.locator('.cm-line', { hasText: 'Anchor after' }).click();
		await expect(target).toHaveClass(new RegExp(`mlp-line-h${level}`));
		await target.click();
		await page.keyboard.press('Home');
		for (let i = 0; i <= level; i++) await page.keyboard.press('Delete');
		await expect.poll(() => documentText(page, initial)).toBe(initial);
		await expect(target).not.toHaveClass(/mlp-line-h[1-6]/);
	}
	for (const delimiter of ['**', '*', '~~', '==', '`']) {
		await target.click();
		await page.keyboard.press('Home');
		await page.keyboard.type(delimiter, { delay: 15 });
		await page.keyboard.press('End');
		await page.keyboard.type(delimiter, { delay: 15 });
		await page.locator('.cm-line', { hasText: 'Anchor after' }).click();
		await expect(page.locator('.cm-line', { hasText: 'Anchor after' })).not.toHaveClass(/mlp-line-code|mlp-line-h[1-6]/);
		await target.click();
		await page.keyboard.press('Home');
		for (let i = 0; i < delimiter.length; i++) await page.keyboard.press('Delete');
		await page.keyboard.press('End');
		for (let i = 0; i < delimiter.length; i++) await page.keyboard.press('Backspace');
	}
	await expect.poll(() => documentText(page, initial)).toBe(initial);
	await page.screenshot({ path: info.outputPath('delimiter-redraft.png') });
});

for (const theme of ['', obsidian]) test(`folded callouts hide quote markers without adding an extra header row (${theme ? 'Obsidian' : 'default'})`, async ({ page }, info) => {
	await page.setViewportSize({ width: 760, height: 1000 });
	const initial = largeMixedDocument(32) + '\n> [!warning]+ Fold review\n> Body content\n>\n> > [!tip]+ Nested notes\n> > Child content\n\nTrailing paragraph with sufficient length.';
	await mountEditor(page, initial, { css: theme });
	await goToEnd(page);
	for (const title of ['Nested notes', 'Fold review']) {
		const button = page.getByRole('button', { name: `${title} callout`, exact: true });
		await button.click();
		await expect(button).toHaveAttribute('aria-expanded', 'false');
		const headerLine = button.locator('xpath=ancestor::div[contains(@class,"cm-line")][1]');
		await expect(headerLine).not.toContainText('>');
		const box = await button.boundingBox();
		const line = await headerLine.boundingBox();
		expect(box!.y - line!.y).toBeLessThanOrEqual(13);
		await button.focus();
		await page.keyboard.press('Enter');
		await expect(button).toHaveAttribute('aria-expanded', 'true');
		await page.keyboard.press('Space');
		await expect(button).toHaveAttribute('aria-expanded', 'false');
		await expect(headerLine).not.toContainText('>');
		await button.click();
	}
	expect(await documentText(page, initial)).toBe(initial);
	await page.screenshot({ path: info.outputPath('nested-folded-headers.png') });
});
