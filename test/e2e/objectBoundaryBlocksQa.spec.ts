import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mountEditor, postToWebview } from './harness';
import { largeMixedDocument } from '../fixtures/largeMixedDocument';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const obsidian = readFileSync(join(__dirname, '../../media/sample-styles/obsidian-dark.css'), 'utf8');
const row = (cells: string[]) => `| ${cells.join(' | ')} |`;
const objects = {
	table: [row(Array.from({ length: 10 }, (_, n) => `Boundary heading ${n}`)), row(Array(10).fill('---')),
		...Array.from({ length: 100 }, (_, r) => row(Array.from({ length: 10 }, (_, c) => `Boundary ${r}-${c} **details**<br>Second line`)))].join('\n'),
	code: '```typescript\n' + Array.from({ length: 28 }, (_, n) => `const boundaryValue${n} = ${n};`).join('\n') + '\n```',
	mermaid: '```mermaid\nerDiagram\n    BOUNDARY_NOTE ||--o{ BOUNDARY_EDIT : contains\n    BOUNDARY_NOTE {\n        string title\n        int revision\n    }\n    BOUNDARY_EDIT {\n        string author\n        string details\n    }\n```',
	drawio: '```drawio\n<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Boundary diagram" vertex="1" parent="1"><mxGeometry x="20" y="20" width="240" height="80" as="geometry"/></mxCell></root></mxGraphModel>\n```',
};

async function source(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate(content => (content as any).cmTile.root.view.state.doc.toString());
}

async function find(page: Page, query: string): Promise<void> {
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+f`);
	const input = page.locator('.cm-search input[name="search"]');
	await input.click();
	await page.keyboard.press(`${mod}+a`);
	await page.keyboard.type(query, { delay: 2 });
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	expect(await page.locator('.cm-content').evaluate(content => {
		const state = (content as any).cmTile.root.view.state;
		return state.sliceDoc(state.selection.main.from, state.selection.main.to);
	})).toBe(query);
}

async function caretVisible(page: Page): Promise<void> {
	await expect.poll(() => page.locator('.cm-content').evaluate(content => {
		const view = (content as any).cmTile.root.view;
		const point = view.coordsAtPos(view.state.selection.main.head);
		const viewport = view.scrollDOM.getBoundingClientRect();
		return Boolean(point && point.top >= viewport.top - 2 && point.bottom <= viewport.bottom + 2
			&& point.left >= viewport.left - 2 && point.right <= viewport.right + 2);
	})).toBe(true);
}

async function mouseReplace(page: Page, oldText: string, replacement: string): Promise<void> {
	const line = page.locator('.cm-line', { hasText: oldText });
	await line.scrollIntoViewIfNeeded();
	const points = await line.evaluate((element, target) => {
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		let text: Node | null;
		while ((text = walker.nextNode())) {
			const at = text.textContent!.indexOf(target);
			if (at < 0) continue;
			const range = document.createRange();
			range.setStart(text, at);
			range.setEnd(text, at + target.length);
			const box = range.getBoundingClientRect();
			return { x: box.left + 0.25, right: box.right, y: box.top + box.height / 2 };
		}
		throw new Error('Visible prose target was not found');
	}, oldText);
	await page.mouse.move(points.x, points.y);
	await page.mouse.down();
	await page.mouse.move(points.right, points.y, { steps: 12 });
	await page.mouse.up();
	expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(oldText);
	await page.keyboard.type(replacement, { delay: 4 });
}

async function renderedObject(page: Page, kind: keyof typeof objects): Promise<void> {
	if (kind === 'table') {
		const wrap = page.locator('.mlp-table-wrap', { hasText: 'Boundary heading 0' });
		await expect(wrap.locator('.mlp-table tbody tr')).toHaveCount(100);
		await expect(wrap.getByRole('button', { name: 'Show Markdown source', exact: true })).toHaveCount(1);
		await expect(wrap.getByRole('button', { name: 'Table options', exact: true })).toHaveCount(1);
	} else if (kind === 'code') {
		const firstLine = page.locator('.cm-line', { hasText: 'const boundaryValue0 = 0;' });
		await expect(firstLine.locator('.mlp-copy-code-btn')).toHaveCount(1);
		await expect(firstLine.locator('.mlp-collapse-code-btn')).toHaveCount(1);
	} else {
		const selector = kind === 'mermaid' ? '.mlp-mermaid-wrap' : '.mlp-drawio-wrap';
		const label = kind === 'mermaid' ? 'BOUNDARY_NOTE' : 'Boundary diagram';
		const wrap = page.locator(selector).filter({ has: page.locator('svg', { hasText: label }) });
		await expect(wrap.locator('svg')).toHaveCount(1, { timeout: 15000 });
		await expect(wrap.getByRole('button', { name: 'Switch to code mode', exact: true })).toHaveCount(1);
	}
}

test.use({ actionTimeout: 10000, screenshot: 'only-on-failure' });
test.beforeEach(({ page }) => {
	page.on('pageerror', error => { throw error; });
});

for (const kind of Object.keys(objects) as Array<keyof typeof objects>) {
	for (const placement of ['middle', 'end'] as const) {
		test(`${kind} in a large note ${placement}: repeated boundary joins and splits preserve exact source`, async ({ page }, info) => {
			test.setTimeout(120000);
			await page.setViewportSize({ width: placement === 'end' ? 560 : 960, height: 900 });
			const above = `ABOVE_${kind.toUpperCase()}_BOUNDARY`;
			const below = `BELOW_${kind.toUpperCase()}_BOUNDARY`;
			const block = `${above}\n\n${objects[kind]}\n\n${below}`;
			const initial = largeMixedDocument(36) + '\n' + block + (placement === 'middle' ? '\n\n' + largeMixedDocument(16) : '');
			await mountEditor(page, initial, { css: placement === 'end' ? obsidian : '', stickyTableHeaders: true });
			await find(page, above);
			await page.keyboard.press('ArrowRight');
			await caretVisible(page);
			for (let cycle = 0; cycle < 2; cycle++) {
				await page.keyboard.press('Delete');
				await expect.poll(() => source(page)).toBe(initial.replace(`${above}\n\n`, `${above}\n`));
				await page.keyboard.press('Delete');
				await expect.poll(() => source(page)).toBe(initial.replace(`${above}\n\n`, above));
				await page.keyboard.press('Enter');
				await page.keyboard.press('Enter');
				await expect.poll(() => source(page)).toBe(initial);
				await find(page, above);
				await page.keyboard.press('ArrowRight');
				await caretVisible(page);
			}
			await renderedObject(page, kind);
			await find(page, below);
			await page.keyboard.press('ArrowLeft');
			await page.keyboard.press('Backspace');
			await expect.poll(() => source(page)).toBe(initial.replace(`\n\n${below}`, `\n${below}`));
			await page.keyboard.press('Backspace');
			await expect.poll(() => source(page)).toBe(initial.replace(`\n\n${below}`, below));
			await page.keyboard.press('Enter');
			await page.keyboard.press('Enter');
			await expect.poll(() => source(page)).toBe(initial);
			await find(page, below);
			await page.keyboard.press('ArrowRight');
			await caretVisible(page);
			await mouseReplace(page, below, 'Revised plain boundary');
			await expect.poll(() => source(page)).toBe(initial.replace(below, 'Revised plain boundary'));
			await caretVisible(page);
			await expect(page.locator('.cm-line', { hasText: /^Revised plain boundary$/ })).not.toHaveClass(/mlp-(?:code|heading|list|quote|callout)/);
			await page.screenshot({ path: info.outputPath(`${kind}-${placement}-plain-boundary.png`) });
			// History belongs to the host: assert ordering, then deliver its minimal
			// authoritative inverse rather than invoking CodeMirror history directly.
			await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery)).toBeUndefined();
			await page.keyboard.press(`${mod}+z`);
			await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'undo').length)).toBe(1);
			const version = await page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'edit').at(-1).baseVersion + 1);
			const from = initial.indexOf(below);
			await postToWebview(page, { type: 'externalUpdate', version: version + 1, changes: [{ from, to: from + 'Revised plain boundary'.length, insert: below }] });
			await expect.poll(() => source(page)).toBe(initial);
			await page.keyboard.press(`${mod}+Shift+z`);
			await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'redo').length)).toBe(1);
			await postToWebview(page, { type: 'externalUpdate', version: version + 2, changes: [{ from, to: from + below.length, insert: 'Revised plain boundary' }] });
			await expect.poll(() => source(page)).toBe(initial.replace(below, 'Revised plain boundary'));
			await find(page, above);
			await page.keyboard.press('ArrowRight');
			await renderedObject(page, kind);
			await expect.poll(() => page.locator('.cm-scroller').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(2);
		});
	}
}

for (const kind of ['mermaid', 'drawio', 'table', 'code'] as const) {
	test(`mouse selection across a rendered ${kind} and its adjacent prose deletes only that section`, async ({ page }, info) => {
		test.setTimeout(120000);
		await page.setViewportSize({ width: 960, height: 1100 });
		const object = kind === 'table' ? objects.table.split('\n').slice(0, 5).join('\n')
			: kind === 'code' ? '```typescript\nconst selectedBoundary = 42;\n```' : objects[kind];
		const block = `SELECT_FROM_ABOVE\n\n${object}\n\nSELECT_THROUGH_BELOW`;
		const prefix = largeMixedDocument(40) + '\n';
		const suffix = '\n\nSURVIVING_PARAGRAPH';
		const initial = prefix + block + suffix;
		await mountEditor(page, initial, { css: obsidian });
		await find(page, 'SURVIVING_PARAGRAPH');
		await page.keyboard.press('ArrowRight');
		// Large-note parsing is incremental. This case exercises rendered-object
		// dragging, not coordinates captured while the initial source is parsing.
		if (kind === 'table') await expect(page.locator('.mlp-table-wrap', { hasText: 'Boundary heading 0' }).locator('tbody tr')).toHaveCount(3);
		else if (kind === 'code') await expect(page.locator('.cm-line', { hasText: 'const selectedBoundary = 42;' }).locator('.mlp-copy-code-btn')).toHaveCount(1);
		else await renderedObject(page, kind);
		await caretVisible(page);
		// Find scrolls through CodeMirror's next measure cycle. Read drag geometry
		// after that cycle instead of aiming at coordinates from the old viewport.
		await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
		const pointFor = async (target: string, end: boolean) => {
			return page.locator('.cm-line', { hasText: target }).evaluate((line, { target, end }) => {
				const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
				let node: Node | null;
				while ((node = walker.nextNode())) {
					const at = node.textContent!.indexOf(target);
					if (at < 0) continue;
					const range = document.createRange();
					range.setStart(node, at);
					range.setEnd(node, at + target.length);
					const box = range.getBoundingClientRect();
					return { x: end ? box.right : box.left + 0.25, y: box.top + box.height / 2 };
				}
				throw new Error('Selection boundary text missing');
			}, { target, end });
		};
		const start = await pointFor('SELECT_FROM_ABOVE', false);
		const finish = await pointFor('SELECT_THROUGH_BELOW', true);
		await page.screenshot({ path: info.outputPath(`${kind}-before-mouse-selection.png`) });
		expect(start.y).toBeGreaterThanOrEqual(0);
		expect(finish.y).toBeLessThanOrEqual(1100);
		await page.mouse.move(start.x, start.y);
		await page.mouse.down();
		await page.mouse.move(finish.x, finish.y, { steps: 35 });
		await page.mouse.up();
		await page.screenshot({ path: info.outputPath(`${kind}-mouse-section-selection.png`) });
		await page.keyboard.press('Backspace');
		await expect.poll(() => source(page)).toBe(prefix + suffix);
		await page.keyboard.type('Replacement section remains plain.', { delay: 5 });
		await expect.poll(() => source(page)).toBe(prefix + 'Replacement section remains plain.' + suffix);
		await caretVisible(page);
		await expect(page.locator('.cm-line', { hasText: /^Replacement section remains plain\.$/ })).not.toHaveClass(/mlp-(?:code|heading|list|quote|callout)/);
		await page.screenshot({ path: info.outputPath(`${kind}-mouse-section-replacement.png`) });
	});
}

test('collapsed code at EOF keeps its boundary editable without swallowing plain paragraphs', async ({ page }, info) => {
	test.setTimeout(120000);
	await page.setViewportSize({ width: 600, height: 900 });
	const above = 'COLLAPSED_BOUNDARY_ABOVE';
	const below = 'COLLAPSED_BOUNDARY_BELOW';
	const initial = largeMixedDocument(56) + `\n${above}\n\n${objects.code}\n\n${below}`;
	await mountEditor(page, initial, { css: obsidian });
	await find(page, above);
	await page.keyboard.press('ArrowRight');
	const firstLine = page.locator('.cm-line', { hasText: 'const boundaryValue0 = 0;' });
	await expect(firstLine.locator('.mlp-collapse-code-btn')).toHaveCount(1);
	await firstLine.getByRole('button', { name: 'Collapse code block', exact: true }).click();
	await expect(firstLine.getByRole('button', { name: 'Expand code block', exact: true })).toHaveAttribute('aria-expanded', 'false');
	await find(page, below);
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('Backspace');
	await expect.poll(() => source(page)).toBe(initial.replace(`\n\n${below}`, `\n${below}`));
	await page.keyboard.press('Enter');
	await expect.poll(() => source(page)).toBe(initial);
	await find(page, below);
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Enter');
	await page.keyboard.type('Fresh unrelated paragraph.', { delay: 6 });
	await expect.poll(() => source(page)).toBe(initial + '\n\nFresh unrelated paragraph.');
	await caretVisible(page);
	await expect(page.locator('.cm-line', { hasText: /^Fresh unrelated paragraph\.$/ })).not.toHaveClass(/mlp-(?:code|heading|list|quote|callout)/);
	await expect(firstLine.locator('.mlp-copy-code-btn')).toHaveCount(1);
	await expect(firstLine.getByRole('button', { name: 'Expand code block', exact: true })).toHaveAttribute('aria-expanded', 'false');
	await firstLine.getByRole('button', { name: 'Expand code block', exact: true }).click();
	await expect(page.locator('.cm-line', { hasText: 'const boundaryValue27 = 27;' })).toHaveCount(1);
	await expect.poll(() => source(page)).toBe(initial + '\n\nFresh unrelated paragraph.');
	await find(page, 'Fresh unrelated paragraph.');
	await page.keyboard.press('ArrowRight');
	await caretVisible(page);
	await page.screenshot({ path: info.outputPath('expanded-code-keeps-new-paragraph.png') });
});

test('initial large-note parsing does not move text during an active mouse selection', async ({ page }, info) => {
	test.setTimeout(120000);
	await page.setViewportSize({ width: 960, height: 1100 });
	const initial = largeMixedDocument(100) + '\nINITIAL_DRAG_START\n\n' + objects.drawio + '\n\nINITIAL_DRAG_END\n\nINITIAL_SURVIVOR';
	await mountEditor(page, initial, { css: obsidian });
	await find(page, 'INITIAL_SURVIVOR');
	await page.keyboard.press('ArrowRight');
	const points = await page.evaluate(() => {
		const point = (target: string, end = false) => {
			const line = Array.from(document.querySelectorAll('.cm-line')).find(el => el.textContent?.includes(target))!;
			const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
			const text = walker.nextNode()!;
			const range = document.createRange(); range.selectNode(text);
			const box = range.getBoundingClientRect();
			return { x: end ? box.right : box.left + 0.25, y: box.top + box.height / 2 };
		};
		const trace: unknown[] = [];
		(window as any).__initialDragTrace = trace;
		let dragging = false;
		const sample = (event: string) => {
			const line = Array.from(document.querySelectorAll('.cm-line')).find(el => el.textContent?.includes('INITIAL_DRAG_END'));
			const rect = line?.getBoundingClientRect();
			const view = (document.querySelector('.cm-content') as any).cmTile.root.view;
			trace.push({ event, dragging, time: performance.now(), y: rect?.top, rendered: !!document.querySelector('.mlp-drawio-wrap'),
				anchor: view.state.selection.main.anchor, head: view.state.selection.main.head });
		};
		document.addEventListener('mousedown', () => { dragging = true; sample('down'); }, true);
		document.addEventListener('mouseup', () => { sample('up'); dragging = false; }, true);
		let frames = 0;
		const tick = () => { sample('frame'); if (++frames < 180) requestAnimationFrame(tick); };
		requestAnimationFrame(tick);
		sample('before');
		return { start: point('INITIAL_DRAG_START'), end: point('INITIAL_DRAG_END', true) };
	});
	await page.mouse.move(points.start.x, points.start.y);
	await page.mouse.down();
	await page.mouse.move(points.end.x, points.end.y, { steps: 45 });
	await page.mouse.up();
	await page.screenshot({ path: info.outputPath('initial-parse-drag.png') });
	const trace = await page.evaluate(() => (window as any).__initialDragTrace) as Array<{ dragging: boolean; y: number; event: string; rendered: boolean }>;
	await info.attach('initial-parse-drag-timing.json', {
		body: JSON.stringify({ points, trace }, null, 2), contentType: 'application/json',
	});
	const heldFrames = trace.filter(frame => frame.dragging && frame.event !== 'up');
	// Require a genuinely pending parse at press time; an already-rendered note
	// cannot accidentally make this regression green without exercising deferral.
	expect(trace.find(frame => frame.event === 'down')?.rendered).toBe(false);
	expect(heldFrames.length).toBeGreaterThan(2);
	expect(Math.max(...heldFrames.map(frame => frame.y)) - Math.min(...heldFrames.map(frame => frame.y))).toBeLessThanOrEqual(2);
	await renderedObject(page, 'drawio');
	expect(await page.locator('.cm-content').evaluate(content => {
		const state = (content as any).cmTile.root.view.state;
		return state.sliceDoc(state.selection.main.from, state.selection.main.to);
	})).toBe('INITIAL_DRAG_START\n\n' + objects.drawio + '\n\nINITIAL_DRAG_END');
	await page.screenshot({ path: info.outputPath('initial-parse-after-release.png') });
	expect(await source(page)).toBe(initial);
});

for (const ending of ['mouseup', 'blur', 'pointercancel', 'missed-mouseup'] as const) {
	test(`deferred initial parsing refreshes after ${ending} without dropping an edit made during the gesture`, async ({ page }) => {
		test.setTimeout(120000);
		await page.setViewportSize({ width: 960, height: 1100 });
		const marker = 'GESTURE_EDIT_BOUNDARY';
		const initial = largeMixedDocument(80) + `\n${marker}\n\n${objects.drawio}\n\nAFTER_GESTURE`;
		await mountEditor(page, initial, { css: obsidian });
		await find(page, marker);
		await page.keyboard.press('ArrowRight');
		await caretVisible(page);
		const point = await page.locator('.cm-line', { hasText: marker }).evaluate(line => {
			const range = document.createRange(); range.selectNodeContents(line);
			const box = range.getBoundingClientRect();
			return { x: box.right - 0.25, y: box.top + box.height / 2 };
		});
		await page.mouse.move(point.x, point.y);
		await page.mouse.down();
		await page.keyboard.press('End');
		await page.keyboard.type(' revised', { delay: 5 });
		await expect.poll(() => source(page)).toBe(initial.replace(marker, marker + ' revised'));
		if (ending === 'mouseup') await page.mouse.up();
		else if (ending === 'missed-mouseup') {
			await page.evaluate(() => window.addEventListener('mouseup', event => event.stopImmediatePropagation(), { once: true, capture: true }));
			await page.mouse.up();
			await page.mouse.move(point.x + 2, point.y + 2);
		}
		else {
			await page.evaluate(type => {
				if (type === 'blur') window.dispatchEvent(new Event('blur'));
				else document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
			}, ending);
			await page.mouse.up();
		}
		await renderedObject(page, 'drawio');
		await find(page, 'AFTER_GESTURE');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type(' intact', { delay: 5 });
		await expect.poll(() => source(page)).toBe(initial.replace(marker, marker + ' revised') + ' intact');
		await caretVisible(page);
	});
}

test('reinitializing the editor during a held gesture disposes deferred presentation safely', async ({ page }) => {
	test.setTimeout(120000);
	const initial = largeMixedDocument(80) + '\nDISPOSAL_BOUNDARY\n\n' + objects.drawio + '\n\nDISPOSAL_END';
	await mountEditor(page, initial);
	await find(page, 'DISPOSAL_BOUNDARY');
	await page.keyboard.press('ArrowRight');
	const box = await page.locator('.cm-line', { hasText: 'DISPOSAL_BOUNDARY' }).boundingBox();
	await page.mouse.move(box!.x + 10, box!.y + box!.height / 2);
	await page.mouse.down();
	const replacement = 'Replacement view\n\n' + objects.drawio + '\n\nAFTER_REINIT';
	// A host re-init replaces EditorState and disposes its view plugins. This
	// lifecycle stimulus is separate from the actual keyboard/mouse edit proof.
	await postToWebview(page, {
		type: 'init', protocolVersion: 1, text: replacement, version: 42, css: '', codeTheme: 'dark-plus', remoteMedia: 'block',
		workspaceTrusted: true, diagramRenderingAllowed: true, editingMode: 'editing', vaultNotes: [], currentVaultPath: '',
	});
	await page.mouse.up();
	await renderedObject(page, 'drawio');
	await find(page, 'AFTER_REINIT');
	await page.keyboard.press('ArrowRight');
	await page.keyboard.type(' works', { delay: 4 });
	await expect.poll(() => source(page)).toBe(replacement + ' works');
	await caretVisible(page);
});

for (const [label, prefix, ending] of [['H1', '# ', ''], ['H6', '###### ', ''], ['bold', '**', '**'], ['highlight', '==', '==']] as const) {
	test(`click followed immediately by Home/Delete removes the ${label} prefix instead of text`, async ({ page }) => {
		const initial = `Before\n\n${prefix}Immediate target${ending}\n\nAfter`;
		await mountEditor(page, initial, { css: obsidian });
		// No frame wait or source-reveal assertion between the click and keys:
		// a user can legitimately press Home/Delete before the deferred paint.
		await page.locator('.cm-line', { hasText: 'Immediate target' }).click();
		await page.keyboard.press('Home');
		for (let n = 0; n < prefix.length; n++) await page.keyboard.press('Delete');
		await expect.poll(() => source(page)).toBe(`Before\n\nImmediate target${ending}\n\nAfter`);
		await caretVisible(page);
	});
}
