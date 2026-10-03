import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mountEditor } from './harness';
import { largeMixedDocument } from '../fixtures/largeMixedDocument';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const obsidian = readFileSync(join(__dirname, '../../media/sample-styles/obsidian-dark.css'), 'utf8');
const errors = new Map<Page, string[]>();
test.use({ screenshot: 'only-on-failure' });
test.beforeEach(({ page }) => {
	const found: string[] = [];
	errors.set(page, found);
	page.on('pageerror', error => found.push(error.message));
});
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); errors.delete(page); });

async function source(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate(element => (element as any).cmTile.root.view.state.doc.toString());
}

async function savedSource(page: Page, initial: string): Promise<string> {
	return page.evaluate(text => {
		for (const message of (window as any).__posted) {
			if (message.type !== 'edit') continue;
			for (const change of [...message.changes].reverse()) text = text.slice(0, change.from) + change.insert + text.slice(change.to);
		}
		return text;
	}, initial);
}

async function typeKeys(page: Page, text: string): Promise<void> {
	// Deliberate separate physical-style keys, not a document replacement or
	// event tracer. Non-ASCII text uses Playwright's native committed-text path.
	for (const character of text) await page.keyboard.type(character);
}

async function caretVisible(page: Page): Promise<void> {
	await expect.poll(() => page.locator('.cm-content').evaluate(element => {
		const view = (element as any).cmTile.root.view;
		const point = view.coordsAtPos(view.state.selection.main.head);
		const viewport = view.scrollDOM.getBoundingClientRect();
		return Boolean(point && point.top >= viewport.top - 2 && point.bottom <= viewport.bottom + 2
			&& point.left >= viewport.left - 2 && point.right <= viewport.right + 2);
	})).toBe(true);
}

async function expectSource(page: Page, initial: string, expected: string): Promise<void> {
	await expect.poll(() => source(page)).toBe(expected);
	await expect.poll(() => savedSource(page, initial)).toBe(expected);
	await caretVisible(page);
}

async function find(page: Page, text: string): Promise<void> {
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+f`);
	await page.locator('.cm-search input[name="search"]').fill(text);
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	await expect.poll(() => page.locator('.cm-content').evaluate(element => {
		const state = (element as any).cmTile.root.view.state;
		return state.sliceDoc(state.selection.main.from, state.selection.main.to);
	})).toBe(text);
}

for (const width of [580, 1000]) test(`meeting notes grow through individual keys, corrections, highlights, tags, and emoji at ${width}px`, async ({ page }, info) => {
	test.setTimeout(120000);
	await page.setViewportSize({ width, height: 780 });
	const initial = largeMixedDocument(14) + '\n## Meeting — launch review\n\n';
	await mountEditor(page, initial, { css: obsidian });
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+End`);
	let expected = initial;
	for (const chunk of [
		'The group agreed to ==scope one== and #planning/next with café 😀. ',
		'We need a reversible change and clear owners before the Friday review. ',
		'The decision affects the table, diagram, code sample, and follow-up tasks above.',
	]) {
		await typeKeys(page, chunk);
		expected += chunk;
		await expectSource(page, initial, expected);
	}
	await page.keyboard.press('Enter');
	await page.keyboard.press('Enter');
	expected += '\n\n';
	await typeKeys(page, '- Capture the decison');
	expected += '- Capture the decison';
	await expectSource(page, initial, expected);
	// Repair a mid-word omission with arrows and one character, then continue.
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('ArrowLeft');
	await typeKeys(page, 'i');
	expected = expected.replace('decison', 'decision');
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Tab');
	await typeKeys(page, 'Assign #owner/alex and keep the evidence 🔎');
	expected += '\n  - Assign #owner/alex and keep the evidence 🔎';
	await expectSource(page, initial, expected);
	await page.keyboard.press('Enter');
	await page.keyboard.press('Shift+Tab');
	await typeKeys(page, 'Review the final reportxx');
	await page.keyboard.press('Backspace');
	await page.keyboard.press('Backspace');
	expected += '\n- Review the final report';
	await expectSource(page, initial, expected);
	await find(page, 'scope one');
	await page.keyboard.press('ArrowLeft');
	for (let n = 0; n < 'scope one'.length; n++) await page.keyboard.press('Shift+ArrowRight');
	await typeKeys(page, 'scope two');
	expected = expected.replace('==scope one==', '==scope two==');
	await expectSource(page, initial, expected);
	await find(page, '#planning/next');
	await page.keyboard.press('ArrowRight');
	for (let n = 0; n < '#planning/next'.length; n++) await page.keyboard.press('Shift+ArrowLeft');
	await typeKeys(page, '#planning/approved');
	expected = expected.replace('#planning/next', '#planning/approved');
	await expectSource(page, initial, expected);
	await page.keyboard.press(`${mod}+End`);
	await page.screenshot({ path: info.outputPath(`meeting-notes-${width}.png`) });
});

for (const [kind, prefix, continuation] of [
	['paragraph', '', ''],
	['bullet', '- ', '- '],
	['task', '- [ ] ', '- [ ] '],
	['nested task', '  - [ ] ', '  - [ ] '],
	['numbered list', '1. ', '2. '],
	['quoted paragraph', '> ', '> '],
	['quoted task', '> - [ ] ', '> - [ ] '],
] as const) for (const inside of [false, true]) test(`Enter continues a ${kind} ending in highlighted meeting text, caret ${inside ? 'inside' : 'after'} closing marker`, async ({ page }) => {
	const initial = '# Meeting decisions\n\n' + prefix + 'Confirm ==launch scope==';
	await mountEditor(page, initial, { css: obsidian });
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+End`);
	if (inside) {
		await page.keyboard.press('ArrowLeft');
		await page.keyboard.press('ArrowLeft');
	}
	await page.keyboard.press('Enter');
	const continued = initial + '\n' + continuation;
	await expect.poll(() => source(page)).toBe(continued);
	await typeKeys(page, 'Assign #owner and retain the decision ✅');
	const written = continued + 'Assign #owner and retain the decision ✅';
	await expectSource(page, initial, written);
	await page.keyboard.press('Enter');
	await page.keyboard.press('Enter');
	await typeKeys(page, 'Plain meeting summary.');
	await expectSource(page, initial, written + '\n\nPlain meeting summary.');
});

for (const width of [580, 1000]) test(`arrow-only meeting corrections preserve highlight, tag, and emoji boundaries at ${width}px`, async ({ page }) => {
	await page.setViewportSize({ width, height: 780 });
	const initial = largeMixedDocument(10) + '\nDecisions: ==scope one== #launch/next 😀\n\nFollow-up: owner Alek\n\nCloseout';
	await mountEditor(page, initial, { css: obsidian });
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+End`);
	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('Home');
	for (let n = 0; n < 'Follow-up: owner Ale'.length; n++) await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Delete');
	await typeKeys(page, 'x');
	let expected = initial.replace('owner Alek', 'owner Alex');
	await expectSource(page, initial, expected);
	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('Home');
	for (let n = 0; n < 'Decisions: =='.length; n++) await page.keyboard.press('ArrowRight');
	for (let n = 0; n < 'scope one'.length; n++) await page.keyboard.press('Shift+ArrowRight');
	await typeKeys(page, 'scope two');
	expected = expected.replace('==scope one==', '==scope two==');
	await expectSource(page, initial, expected);
	for (let n = 0; n < '== '.length; n++) await page.keyboard.press('ArrowRight');
	for (let n = 0; n < '#launch/next'.length; n++) await page.keyboard.press('Shift+ArrowRight');
	await typeKeys(page, '#launch/ready');
	expected = expected.replace('#launch/next', '#launch/ready');
	await expectSource(page, initial, expected);
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Delete');
	await page.keyboard.insertText('✅');
	expected = expected.replace('#launch/ready 😀', '#launch/ready ✅');
	await expectSource(page, initial, expected);
});

test('changing highlight delimiters one key at a time preserves the caret and adjacent emoji', async ({ page }, info) => {
	const initial = largeMixedDocument(8) + '\n## Meeting detail\n\nDecision ==review scope== 😀 remains open.\n\nKeep this tail.';
	await mountEditor(page, initial, { css: obsidian });
	await find(page, 'review scope');
	await page.keyboard.press('ArrowLeft');
	const before = initial.indexOf('review scope');
	await page.keyboard.press('Backspace');
	let expected = initial.slice(0, before - 1) + initial.slice(before);
	await expectSource(page, initial, expected);
	await typeKeys(page, '=');
	expected = initial;
	await expectSource(page, initial, expected);
	await find(page, 'review scope');
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Delete');
	const after = initial.indexOf('review scope') + 'review scope'.length;
	expected = initial.slice(0, after) + initial.slice(after + 1);
	await expectSource(page, initial, expected);
	await typeKeys(page, '=');
	await expectSource(page, initial, initial);
	await page.keyboard.press('ArrowRight');
	await typeKeys(page, ' safely');
	expected = initial.replace('== 😀', '== safely 😀');
	await expectSource(page, initial, expected);
	await page.screenshot({ path: info.outputPath('highlight-delimiter-redraft.png') });
});

for (const [kind, prefix] of [['paragraph', ''], ['bullet', '- '], ['nested bullet', '- Parent action\n  - ']] as const) {
	test(`a real mouse drag selects operator checklist in a ${kind}, before and after source focus`, async ({ page }, info) => {
		await page.setViewportSize({ width: 1000, height: 780 });
		const target = 'operator checklist';
		const initial = '# Release planning meeting\n\nWe discussed ==launch scope== and #release/next 😀.\n\n'
			+ prefix + 'Review the operator checklist before Friday.\n\nKeep the final decision.';
		await mountEditor(page, initial, { css: obsidian });
		for (const phase of ['rendered', 'already focused']) {
			const line = page.locator('.cm-line', { hasText: target });
			if (phase === 'already focused') {
				await line.click();
				await page.keyboard.press('ArrowRight');
			}
			const points = await line.evaluate((element, target) => {
				const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
				let node: Node | null;
				while ((node = walker.nextNode())) {
					const from = node.textContent!.indexOf(target);
					if (from < 0) continue;
					const range = document.createRange();
					range.setStart(node, from); range.setEnd(node, from + target.length);
					const box = range.getBoundingClientRect();
					return { x: box.left + 0.25, end: box.right - 0.25, y: box.top + box.height / 2 };
				}
				throw new Error('Meeting-note selection target is missing');
			}, target);
			await page.mouse.move(points.x, points.y);
			await page.mouse.down();
			await page.mouse.move(points.end, points.y, { steps: 20 });
			await page.mouse.up();
			expect(await page.evaluate(() => window.getSelection()?.toString()), `${kind}: ${phase} native selection`).toBe(target);
			expect(await page.locator('.cm-content').evaluate(element => {
				const state = (element as any).cmTile.root.view.state;
				return state.sliceDoc(state.selection.main.from, state.selection.main.to);
			}), `${kind}: ${phase} source selection`).toBe(target);
			expect(await source(page)).toBe(initial);
		}
		await page.screenshot({ path: info.outputPath(`mouse-selected-${kind.replaceAll(' ', '-')}.png`) });
	});
}

for (const prefix of ['- [ ] ', '> - [ ] ']) test(`a distant meeting highlight continues ${JSON.stringify(prefix)} after arrow navigation`, async ({ page }) => {
	const initial = largeMixedDocument(14) + '\n## Latest decision\n\n' + prefix + 'Confirm ==final scope==';
	await mountEditor(page, initial, { css: obsidian });
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+End`);
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('Enter');
	await typeKeys(page, 'Assign the owner');
	await expectSource(page, initial, initial + '\n' + prefix + 'Assign the owner');
});
