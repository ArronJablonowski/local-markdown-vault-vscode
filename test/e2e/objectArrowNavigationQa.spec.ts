import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mountEditor, postToWebview } from './harness';
import { largeMixedDocument } from '../fixtures/largeMixedDocument';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const theme = readFileSync(join(__dirname, '../../media/sample-styles/obsidian-dark.css'), 'utf8');
const objects = {
	table: '| Navigation heading | Detail |\n| --- | --- |\n' + Array.from({ length: 18 }, (_, n) => `| Row ${n} | Preserved **value** ${n} |`).join('\n'),
	mermaid: '```mermaid\nflowchart TD\nA[Navigation start] --> B[Review]\nB --> C[Navigation end]\n```',
	drawio: '```drawio\n<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Navigation diagram" vertex="1" parent="1"><mxGeometry x="0" y="0" width="220" height="140" as="geometry"/></mxCell></root></mxGraphModel>\n```',
	callout: '> [!note]+ Navigation panel\n> First paragraph.\n>\n> - A list entry\n>   - Nested detail\n>\n> Last paragraph.',
	collapsed: '> [!warning]- Hidden panel\n> Hidden paragraph.\n>\n> - Hidden list entry\n>\n> Last hidden paragraph.',
	math: '$$\n\\sum_{i=1}^{n} \\frac{i^2}{n} = S\n$$',
	nested: '> [!abstract]+ Nested object\n> Text before.\n>\n> | Navigation heading | Detail |\n> | --- | --- |\n> | Local | Retain |\n>\n> Text after.',
};

async function source(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate(content => (content as any).cmTile.root.view.state.doc.toString());
}
async function find(page: Page, query: string): Promise<void> {
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+f`);
	await page.locator('.cm-search input[name="search"]').fill(query);
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	await page.keyboard.press('ArrowRight');
}
async function position(page: Page) {
	// CodeMirror's queued measurement can run after another rAF callback in the
	// same frame. Observe the completed frame rather than pre-measure geometry.
	await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))));
	return page.locator('.cm-content').evaluate(content => {
		const view = (content as any).cmTile.root.view;
		const selection = view.state.selection.main;
		const side = selection.empty ? selection.assoc || 1 : selection.head > selection.anchor ? -1 : 1;
		const caret = view.coordsAtPos(selection.head, side);
		const viewport = view.scrollDOM.getBoundingClientRect();
		return { head: selection.head, anchor: selection.anchor, text: view.state.doc.lineAt(selection.head).text,
			top: caret?.top, bottom: caret?.bottom, viewportTop: viewport.top, viewportBottom: viewport.bottom,
			scrollTop: view.scrollDOM.scrollTop };
	});
}

test.beforeEach(({ page }) => page.on('pageerror', error => { throw error; }));

for (const kind of Object.keys(objects) as Array<keyof typeof objects>) {
	for (const direction of ['down', 'up'] as const) {
		test(`arrows ${direction} traverse ${kind} in a large mixed note without trapping or changing text`, async ({ page }, info) => {
			test.setTimeout(90000);
			await page.setViewportSize({ width: 780, height: 680 });
			const before = 'ARROW_BEFORE_TARGET';
			const after = 'ARROW_AFTER_TARGET';
			const doc = largeMixedDocument(24) + `\n${before}\n\n${objects[kind]}\n\n${after}\n\nUnrelated concluding paragraph.`;
			await mountEditor(page, doc, { css: theme });
			await find(page, direction === 'down' ? before : after);
			await page.keyboard.press('Home');
			const trace = [await position(page)];
			const target = direction === 'down' ? doc.indexOf(after) : doc.indexOf(before);
			const reached = () => direction === 'down' ? trace.at(-1)!.head >= target : trace.at(-1)!.head <= target + before.length;
			for (let n = 0; n < 65 && !reached(); n++) {
				await page.keyboard.press(direction === 'down' ? 'ArrowDown' : 'ArrowUp');
				const current = await position(page);
				if (current.top! < current.viewportTop - 3 || current.bottom! > current.viewportBottom + 3) {
					await page.waitForTimeout(150);
					(current as any).after150ms = await position(page);
				}
				trace.push(current);
			}
			await info.attach('arrow-trace.json', { body: JSON.stringify(trace, null, 2), contentType: 'application/json' });
			await page.screenshot({ path: info.outputPath('arrow-end.png') });
			expect(await source(page)).toBe(doc);
			expect(reached(), JSON.stringify(trace.slice(-8))).toBe(true);
			for (let n = 1; n < trace.length; n++) {
				expect(trace[n].head, `direction changed at step ${n}`).toEqual(direction === 'down'
					? Math.max(trace[n].head, trace[n - 1].head) : Math.min(trace[n].head, trace[n - 1].head));
				expect(trace[n].head).toBe(trace[n].anchor);
				expect(trace[n].top, `caret not visible at step ${n}`).toBeGreaterThanOrEqual(trace[n].viewportTop - 3);
				expect(trace[n].bottom, `caret not visible at step ${n}`).toBeLessThanOrEqual(trace[n].viewportBottom + 3);
			}
		});
	}
}

test('rendered table grid arrows retain focus at the row and column edges', async ({ page }, info) => {
	const doc = 'Before\n\n| A | B |\n| --- | --- |\n| one | two |\n| three | four |\n\nAfter';
	await mountEditor(page, doc, { css: theme });
	const cells = page.locator('.mlp-table-cell');
	await cells.first().focus();
	for (const [key, index] of [['ArrowLeft', 0], ['ArrowUp', 0], ['ArrowRight', 1], ['ArrowRight', 1],
		['ArrowDown', 3], ['ArrowDown', 5], ['ArrowDown', 5], ['ArrowLeft', 4], ['ArrowLeft', 4], ['ArrowUp', 2], ['ArrowUp', 0]] as const) {
		await page.keyboard.press(key);
		await expect(cells.nth(index)).toBeFocused();
		await expect(page.locator('.mlp-table')).toHaveCount(1);
		expect(await source(page)).toBe(doc);
	}
	await page.screenshot({ path: info.outputPath('table-grid-edge.png') });
});

for (const kind of Object.keys(objects) as Array<keyof typeof objects>) {
	test(`horizontal arrows and shifted selections cross ${kind} without entering an invisible trap`, async ({ page }, info) => {
		test.setTimeout(90000);
		const object = kind === 'table' ? '| A | B |\n| --- | --- |\n| one | two |' : objects[kind];
		const start = 'HORIZONTAL_START';
		const end = 'HORIZONTAL_END';
		const doc = largeMixedDocument(16) + `\n${start}\n\n${object}\n\n${end}\n\nSurviving paragraph.`;
		await mountEditor(page, doc, { css: theme });
		const startPos = doc.indexOf(start) + start.length;
		const endPos = doc.indexOf(end);
		await find(page, start);
		let last = startPos;
		const trace = [];
		for (let n = 0; n < endPos - startPos + 10 && last < endPos; n++) {
			await page.keyboard.press('ArrowRight');
			const current = await position(page);
			trace.push(current);
			expect(current.head, `stuck moving right: ${JSON.stringify(current)}`).toBeGreaterThan(last);
			last = current.head;
		}
		expect(last).toBe(endPos);
		await find(page, end);
		await page.keyboard.press('Home');
		for (let n = 0; n < endPos - startPos + 10; n++) {
			await page.keyboard.press('Shift+ArrowLeft');
			const current = await position(page);
			trace.push(current);
			if (current.head <= startPos) break;
		}
		const selection = await page.locator('.cm-content').evaluate(content => {
			const state = (content as any).cmTile.root.view.state;
			return { anchor: state.selection.main.anchor, head: state.selection.main.head,
				text: state.sliceDoc(state.selection.main.from, state.selection.main.to) };
		});
		expect(selection).toEqual({ anchor: endPos, head: startPos, text: doc.slice(startPos, endPos) });
		await info.attach('horizontal-arrow-trace.json', { body: JSON.stringify(trace), contentType: 'application/json' });
		expect(await source(page)).toBe(doc);
		await page.screenshot({ path: info.outputPath('horizontal-selection.png') });
	});
}

test('manual wheel scrolling after an arrow is not pulled back to the old caret', async ({ page }) => {
	const doc = Array.from({ length: 600 }, (_, n) => `Retained paragraph ${n}.\n\n`).join('') + 'WHEEL_TARGET\n\nEnd.';
	await mountEditor(page, doc, { css: theme });
	await find(page, 'WHEEL_TARGET');
	await page.keyboard.press('ArrowUp');
	const initial = await position(page);
	await page.mouse.move(500, 350);
	await page.mouse.wheel(0, -1100);
	await expect.poll(() => page.locator('.cm-scroller').evaluate(el => el.scrollTop)).toBeLessThan(initial.scrollTop - 200);
	const manual = await position(page);
	expect(manual.top).toBeGreaterThan(manual.viewportBottom);
	const scrolled = await page.locator('.cm-scroller').evaluate(el => el.scrollTop);
	await postToWebview(page, { type: 'vaultNotes', notes: [] });
	await page.waitForTimeout(180);
	expect(await page.locator('.cm-scroller').evaluate(el => el.scrollTop)).toBeCloseTo(scrolled, 0);
	expect(await source(page)).toBe(doc);
});

test('locked keyboard navigation remains nonmutating through mixed objects', async ({ page }) => {
	const doc = 'Start\n\n' + objects.table + '\n\n' + objects.callout + '\n\n' + objects.math + '\n\nFinish';
	await mountEditor(page, doc, { editingMode: 'locked', css: theme });
	await page.locator('.cm-content').click({ position: { x: 12, y: 10 } });
	for (const key of ['ArrowDown', 'PageDown', 'End', 'ArrowLeft', 'ArrowRight', 'Home', 'PageUp', 'ArrowUp']) {
		await page.keyboard.press(key);
		const current = await position(page);
		expect(current.top).toBeGreaterThanOrEqual(current.viewportTop - 3);
		expect(current.bottom).toBeLessThanOrEqual(current.viewportBottom + 3);
	}
	await page.keyboard.type('must not insert');
	expect(await source(page)).toBe(doc);
});

test('shifted downward selection keeps the whole caret visible as callout source is revealed', async ({ page }, info) => {
	await page.setViewportSize({ width: 1000, height: 776 });
	const marker = 'BEFORE_CALLOUT_1';
	const doc = largeMixedDocument(40) + `\n## Callout navigation\n\n${marker}\n\n${objects.callout}\n\nAfter\n\n` + largeMixedDocument(4);
	await mountEditor(page, doc);
	await find(page, marker);
	const word = process.platform === 'darwin' ? 'Alt' : 'Control';
	for (const key of [`${word}+ArrowLeft`, `${word}+ArrowRight`]) for (let n = 0; n < 4; n++) await page.keyboard.press(key);
	const trace = [];
	for (let n = 0; n < 16; n++) {
		await page.keyboard.press('Shift+ArrowDown');
		await page.waitForTimeout(150);
		const current = await position(page);
		const boundary = await page.locator('.cm-content').evaluate(content => {
			const view = (content as any).cmTile.root.view;
			const selection = view.state.selection.main;
			const native = window.getSelection();
			let nativeRect;
			if (native?.focusNode) {
				const range = document.createRange(); range.setStart(native.focusNode, native.focusOffset); range.collapse(true);
				const rect = range.getBoundingClientRect(); nativeRect = { top: rect.top, bottom: rect.bottom };
			}
			return { assoc: selection.assoc, minus: view.coordsAtPos(selection.head, -1), zero: view.coordsAtPos(selection.head, 0),
				plus: view.coordsAtPos(selection.head, 1), nativeRect, focusText: native?.focusNode?.textContent, focusOffset: native?.focusOffset };
		});
		trace.push({ ...current, boundary });
	}
	await info.attach('shift-down-trace.json', { body: JSON.stringify(trace), contentType: 'application/json' });
	await page.screenshot({ path: info.outputPath('shift-callout.png') });
	for (const step of trace) {
		expect(step.top, JSON.stringify(step)).toBeGreaterThanOrEqual(step.viewportTop - 2);
		expect(step.bottom, JSON.stringify(step)).toBeLessThanOrEqual(step.viewportBottom + 2);
		if (step.boundary.focusText === '> ') {
			expect(step.boundary.nativeRect!.top).toBeGreaterThanOrEqual(step.viewportTop - 2);
			expect(step.boundary.nativeRect!.bottom).toBeLessThanOrEqual(step.viewportBottom + 2);
		}
	}
	expect(await source(page)).toBe(doc);
});
