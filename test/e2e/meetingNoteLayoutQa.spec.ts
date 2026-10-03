import { expect, test, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const objects = {
	callout: '> [!warning]+ Release decision\n> Confirm the migration owner before the next review.\n>\n> > [!note]+ Follow-up\n> > - [ ] Ask Maya for the revised rollout dates.',
	table: '| Workstream | Owner | Next action |\n| --- | --- | --- |\n| Research | Maya | Share the revised findings |\n| Rollout | Leo | Confirm the readiness review |\n| Support | Priya | Update the response guide |',
	code: '```typescript\nconst agenda = ["research", "rollout", "support"];\nconst pending = agenda.filter(item => item !== "research");\nconsole.log(pending);\n```',
	highlight: 'The team agreed that ==the customer handoff needs a named owner== before **Friday afternoon**, with *support coverage* confirmed.',
};

function meetingArchive(): string {
	return '# Product working sessions\n\n' + Array.from({ length: 42 }, (_, index) => {
		const number = String(index + 1).padStart(2, '0');
		return `## Working session ${number}\n\nMaya reviewed the customer interviews, Leo described the rollout plan, and Priya summarized support readiness. `
			+ 'The discussion focused on keeping the ownership clear, recording the open questions, and following up on the decisions before the next meeting. '.repeat(3)
			+ `\n\n- [ ] Share the notes from session ${number}\n  - Confirm the open questions with the research team.\n- [x] Record the decision and its owner.\n\n`
			+ (index % 7 === 0 ? '> [!note]+ Earlier decision\n> Keep the initial rollout small and review the feedback before expanding it.\n\n' : '');
	}).join('');
}

async function documentState(page: Page) {
	return page.locator('.cm-content').evaluate(element => {
		const state = (element as any).cmTile.root.view.state;
		return { text: state.doc.toString(), head: state.selection.main.head, empty: state.selection.main.empty };
	});
}

async function hostSource(page: Page, initial: string): Promise<string> {
	return page.evaluate(text => {
		for (const message of (window as any).__posted) if (message.type === 'edit') {
			for (const change of [...message.changes].reverse()) text = text.slice(0, change.from) + change.insert + text.slice(change.to);
		}
		return text;
	}, initial);
}

async function find(page: Page, text: string): Promise<void> {
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+f`);
	await page.locator('.cm-search input[name="search"]').click();
	await page.keyboard.press(`${mod}+a`);
	await page.keyboard.type(text);
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	await expect.poll(() => page.locator('.cm-content').evaluate(element => {
		const state = (element as any).cmTile.root.view.state;
		return state.sliceDoc(state.selection.main.from, state.selection.main.to);
	})).toBe(text);
}

async function settledCaretFrames(page: Page) {
	return page.locator('.cm-content').evaluate(async element => {
		const view = (element as any).cmTile.root.view;
		const frames = [];
		for (let frame = 0; frame < 8; frame++) {
			await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
			const selection = window.getSelection();
			const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
			range?.collapse(false);
			const caret = range?.getBoundingClientRect();
			const viewport = view.scrollDOM.getBoundingClientRect();
			const main = view.state.selection.main;
			const native = selection?.focusNode && element.contains(selection.focusNode)
				? view.posAtDOM(selection.focusNode, selection.focusOffset) : null;
			frames.push({
				model: main.head, native, empty: main.empty, focused: document.activeElement === element,
				top: caret?.top, bottom: caret?.bottom, left: caret?.left, right: caret?.right,
				viewport: { top: viewport.top, bottom: viewport.bottom, left: viewport.left, right: viewport.right },
				overflow: view.scrollDOM.scrollWidth - view.scrollDOM.clientWidth,
			});
		}
		return frames;
	});
}

async function expectCaret(page: Page, expected: number): Promise<void> {
	const frames = await settledCaretFrames(page);
	for (const frame of frames) {
		expect(frame, JSON.stringify(frames)).toMatchObject({ model: expected, native: expected, empty: true, focused: true });
		expect(frame.top, JSON.stringify(frames)).toBeGreaterThanOrEqual(frame.viewport.top - 3);
		expect(frame.bottom, JSON.stringify(frames)).toBeLessThanOrEqual(frame.viewport.bottom + 3);
		expect(frame.left, JSON.stringify(frames)).toBeGreaterThanOrEqual(frame.viewport.left - 3);
		expect(frame.right, JSON.stringify(frames)).toBeLessThanOrEqual(frame.viewport.right + 3);
		expect(frame.overflow, JSON.stringify(frames)).toBeLessThanOrEqual(2);
	}
}

test.use({ screenshot: 'only-on-failure', actionTimeout: 10000 });

for (const kind of Object.keys(objects) as Array<keyof typeof objects>) {
	test(`meeting-note ${kind} boundaries preserve the caret through deletion, retyping, fonts, and narrow panes`, async ({ page }, info) => {
		test.setTimeout(90000);
		const errors: string[] = [];
		page.on('pageerror', error => errors.push(error.message));
		const before = 'The current discussion starts here.';
		const after = 'The next steps remain open for review.';
		const prefix = meetingArchive();
		const initial = `${prefix}${before}\n\n${objects[kind]}\n\n${after}\n\nMeeting adjourned.`;
		await page.setViewportSize({ width: 820, height: 720 });
		await mountEditor(page, initial, { stickyTableHeaders: true });
		for (const [index, style] of [
			{ width: 820, css: 'body { font-family: Arial; font-size: 16px; }' },
			{ width: 390, css: 'body { font-family: Georgia; font-size: 22px; line-height: 1.9; }' },
			{ width: 600, css: 'body { font-family: monospace; font-size: 14px; }' },
		].entries()) {
			await postToWebview(page, { type: 'applyCss', css: style.css });
			await page.setViewportSize({ width: style.width, height: 720 });
			await find(page, 'Working session 01');
			await find(page, after);
			await page.keyboard.press('ArrowLeft');
			await page.keyboard.press('Backspace');
			const joined = initial.replace(`\n\n${after}`, `\n${after}`);
			await expect.poll(() => documentState(page)).toEqual({ text: joined, head: initial.indexOf(after) - 1, empty: true });
			await expectCaret(page, initial.indexOf(after) - 1);
			await page.keyboard.press('Enter');
			await expect.poll(() => documentState(page)).toEqual({ text: initial, head: initial.indexOf(after), empty: true });
			await expectCaret(page, initial.indexOf(after));
			await find(page, before);
			await page.keyboard.press('ArrowRight');
			await page.keyboard.press('Delete');
			await expect.poll(() => documentState(page)).toEqual({ text: initial.replace(`${before}\n\n`, `${before}\n`), head: prefix.length + before.length, empty: true });
			await expectCaret(page, prefix.length + before.length);
			await page.keyboard.press('Enter');
			await expect.poll(() => hostSource(page, initial)).toBe(initial);
			await find(page, after);
			await page.keyboard.type('The revised actions are ready.', { delay: 8 });
			await page.keyboard.type(' temporary', { delay: 8 });
			for (const _character of ' temporary') await page.keyboard.press('Backspace');
			const replacement = 'The revised actions are ready.';
			await expect.poll(() => documentState(page)).toEqual({ text: initial.replace(after, replacement), head: initial.indexOf(after) + replacement.length, empty: true });
			await expectCaret(page, initial.indexOf(after) + replacement.length);
			await page.screenshot({ path: info.outputPath(`${kind}-font-${index}.png`) });
			await find(page, replacement);
			await page.keyboard.type(after, { delay: 8 });
			await expect.poll(() => hostSource(page, initial)).toBe(initial);
		}
		expect(errors).toEqual([]);
	});
}

test('meeting-note highlighted discussion remains editable after scrolling away and resizing while focused', async ({ page }, info) => {
	test.setTimeout(90000);
	const initial = meetingArchive() + '\n## Decision review\n\n' + objects.highlight + '\n\nNext review: Friday.';
	await page.setViewportSize({ width: 760, height: 660 });
	await mountEditor(page, initial);
	const target = 'the customer handoff needs a named owner';
	await find(page, target);
	await page.keyboard.type('the final handoff needs one accountable owner', { delay: 8 });
	let expected = initial.replace(target, 'the final handoff needs one accountable owner');
	await expect.poll(() => hostSource(page, initial)).toBe(expected);
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	for (const width of [380, 1000, 460]) {
		await page.mouse.wheel(0, -700);
		await page.setViewportSize({ width, height: 660 });
		await page.keyboard.type(' reviewed', { delay: 8 });
		const at = expected.indexOf('== before');
		expected = expected.slice(0, at + 2) + ' reviewed' + expected.slice(at + 2);
		await expect.poll(() => hostSource(page, initial)).toBe(expected);
		await expectCaret(page, at + 2 + ' reviewed'.length);
		for (const _character of ' reviewed') await page.keyboard.press('Backspace');
		expected = expected.replace('== reviewed before', '== before');
		await expect.poll(() => hostSource(page, initial)).toBe(expected);
		await expectCaret(page, expected.indexOf('== before') + 2);
	}
	await info.attach('final-caret-frames.json', { body: JSON.stringify(await settledCaretFrames(page)), contentType: 'application/json' });
	await page.screenshot({ path: info.outputPath('highlighted-meeting-review.png') });
});

async function paintedArrowPosition(page: Page) {
	await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))));
	return page.locator('.cm-content').evaluate(element => {
		const view = (element as any).cmTile.root.view;
		const selection = view.state.selection.main;
		const native = window.getSelection();
		const cursor = view.dom.querySelector('.cm-cursor-primary')?.getBoundingClientRect();
		const viewport = view.scrollDOM.getBoundingClientRect();
		return {
			head: selection.head, anchor: selection.anchor,
			native: native?.focusNode && element.contains(native.focusNode) ? view.posAtDOM(native.focusNode, native.focusOffset) : null,
			line: view.state.doc.lineAt(selection.head).text,
			cursor: cursor && { top: cursor.top, bottom: cursor.bottom, left: cursor.left, right: cursor.right },
			viewport: { top: viewport.top, bottom: viewport.bottom, left: viewport.left, right: viewport.right },
		};
	});
}

function expectArrowGeometry(position: Awaited<ReturnType<typeof paintedArrowPosition>>): void {
	expect(position.native, JSON.stringify(position)).toBe(position.head);
	expect(position.cursor, JSON.stringify(position)).toBeDefined();
	expect(position.cursor!.top, JSON.stringify(position)).toBeGreaterThanOrEqual(position.viewport.top - 3);
	expect(position.cursor!.bottom, JSON.stringify(position)).toBeLessThanOrEqual(position.viewport.bottom + 3);
	expect(position.cursor!.left, JSON.stringify(position)).toBeGreaterThanOrEqual(position.viewport.left - 3);
	expect(position.cursor!.right, JSON.stringify(position)).toBeLessThanOrEqual(position.viewport.right + 3);
}

for (const kind of ['callout', 'table', 'code'] as const) {
	test(`meeting-note arrows repeatedly cross ${kind} and select a known action for replacement`, async ({ page }, info) => {
		test.setTimeout(120000);
		const before = 'Before the decision';
		const after = 'Review Friday';
		const initial = `${meetingArchive()}${before}\n\n${objects[kind]}\n\n${after}\n\nKeep the closing notes.`;
		const beforeStart = initial.indexOf(before);
		const afterStart = initial.indexOf(after);
		await page.setViewportSize({ width: 590, height: 680 });
		await mountEditor(page, initial, { css: 'body { font-family: monospace; font-size: 16px; }' });
		await find(page, before);
		await page.keyboard.press('ArrowLeft');
		const trace: unknown[] = [];
		for (let cycle = 0; cycle < 3; cycle++) {
			for (const direction of ['ArrowDown', 'ArrowUp'] as const) {
				const target = direction === 'ArrowDown' ? afterStart : beforeStart;
				const targetLine = direction === 'ArrowDown' ? after : before;
				let arrived = false;
				for (let step = 0; step < 40; step++) {
					await page.keyboard.press(direction);
					const immediate = await documentState(page);
					expect(immediate.text).toBe(initial);
					const position = await paintedArrowPosition(page);
					trace.push({ cycle, direction, step, ...position });
					expect(position.head).toBe(immediate.head);
					expect(position.head).toBeGreaterThanOrEqual(beforeStart);
					expect(position.head).toBeLessThanOrEqual(afterStart + after.length);
					expectArrowGeometry(position);
					if (position.line === targetLine) {
						// Column zero is fixed by the starting fixture, not copied from
						// whichever selection the editor happened to produce.
						expect(position.head).toBe(target);
						arrived = true;
						break;
					}
				}
				expect(arrived, JSON.stringify(trace.slice(-5))).toBe(true);
			}
		}
		// Right/Left cross the same boundaries, ending at a known source offset.
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowLeft');
		await expectCaret(page, beforeStart);
		for (const direction of ['ArrowRight', 'ArrowLeft', 'ArrowRight'] as const) {
			const target = direction === 'ArrowRight' ? afterStart : beforeStart;
			let previous = direction === 'ArrowRight' ? beforeStart : afterStart;
			for (let step = 0; step < afterStart - beforeStart + 2 && previous !== target; step++) {
				await page.keyboard.press(direction);
				const position = await paintedArrowPosition(page);
				trace.push({ direction, step, ...position });
				expectArrowGeometry(position);
				expect(position.head).toBeGreaterThanOrEqual(beforeStart);
				expect(position.head).toBeLessThanOrEqual(afterStart);
				if (direction === 'ArrowRight') expect(position.head).toBeGreaterThan(previous);
				else expect(position.head).toBeLessThan(previous);
				previous = position.head;
			}
			expect(previous).toBe(target);
		}
		for (const _character of 'Review ') await page.keyboard.press('ArrowRight');
		for (const _character of 'Friday') await page.keyboard.press('Shift+ArrowRight');
		await expect.poll(() => page.locator('.cm-content').evaluate(element => {
			const state = (element as any).cmTile.root.view.state;
			return { from: state.selection.main.from, to: state.selection.main.to, text: state.sliceDoc(state.selection.main.from, state.selection.main.to) };
		})).toEqual({ from: afterStart + 7, to: afterStart + 13, text: 'Friday' });
		await page.keyboard.type('Monday', { delay: 8 });
		const expected = initial.replace(after, 'Review Monday');
		await expect.poll(() => hostSource(page, initial)).toBe(expected);
		await expectCaret(page, afterStart + 'Review Monday'.length);
		await info.attach('meeting-arrow-path.json', { body: JSON.stringify(trace), contentType: 'application/json' });
	});
}

test('meeting-note wrapped list arrows return to a known word and Shift-arrows replace only that word', async ({ page }, info) => {
	test.setTimeout(120000);
	const words = Array.from({ length: 36 }, (_, index) => `Action${String(index).padStart(2, '0')}`).join(' ');
	const list = '- Owner review\n  - ' + words + '\n  - Keep the follow-up date.';
	const initial = meetingArchive() + list + '\n\nMeeting adjourned.';
	await page.setViewportSize({ width: 420, height: 780 });
	await mountEditor(page, initial, { css: 'body { font-family: monospace; font-size: 16px; }' });
	await find(page, 'Action16');
	await page.keyboard.press('ArrowLeft');
	const target = initial.indexOf('Action16');
	const lineStart = initial.indexOf('  - Action00');
	const lineEnd = lineStart + ('  - ' + words).length;
	await expectCaret(page, target);
	// Derive the visual row above from the rendered words, independently of
	// the editor's selection. Fixed-width words make the intended column exact.
	const wordAbove = await page.locator('.cm-line', { hasText: 'Action00' }).evaluate(element => {
		const tokens: Array<{ word: string; left: number; top: number }> = [];
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) for (const match of node.textContent!.matchAll(/Action\d{2}/g)) {
			const range = document.createRange();
			range.setStart(node, match.index!);
			range.setEnd(node, match.index! + 1);
			const rectangle = range.getBoundingClientRect();
			tokens.push({ word: match[0], left: rectangle.left, top: rectangle.top });
		}
		const origin = tokens.find(token => token.word === 'Action16')!;
		const precedingTop = Math.max(...tokens.filter(token => token.top < origin.top - 2).map(token => token.top));
		const sameColumn = tokens.filter(token => Math.abs(token.top - precedingTop) < 2)
			.sort((left, right) => Math.abs(left.left - origin.left) - Math.abs(right.left - origin.left))[0];
		if (!sameColumn || Math.abs(sameColumn.left - origin.left) > 1) throw new Error('Wrapped fixture has no word directly above Action16.');
		return sameColumn.word;
	});
	const upTarget = initial.indexOf(wordAbove);
	const trace = [];
	for (let cycle = 0; cycle < 12; cycle++) {
		await page.keyboard.press('ArrowUp');
		const up = await paintedArrowPosition(page);
		expect(up.head, `ArrowUp must land on ${wordAbove}`).toBe(upTarget);
		expect(up.line).toBe('  - ' + words);
		expectArrowGeometry(up);
		await page.keyboard.press('ArrowDown');
		const down = await paintedArrowPosition(page);
		expect(down.head).toBe(target);
		expectArrowGeometry(down);
		trace.push({ cycle, up, down });
		for (let offset = 1; offset <= 7; offset++) {
			await page.keyboard.press('ArrowRight');
			const current = await paintedArrowPosition(page);
			expect(current.head).toBe(target + offset);
			expectArrowGeometry(current);
		}
		for (let offset = 6; offset >= 0; offset--) {
			await page.keyboard.press('ArrowLeft');
			const current = await paintedArrowPosition(page);
			expect(current.head).toBe(target + offset);
			expectArrowGeometry(current);
		}
	}
	expect(target).toBeLessThan(lineEnd);
	for (const _character of 'Action16') await page.keyboard.press('Shift+ArrowRight');
	await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Action16');
	await page.keyboard.type('Approved', { delay: 8 });
	await expect.poll(() => hostSource(page, initial)).toBe(initial.replace('Action16', 'Approved'));
	await expectCaret(page, target + 'Approved'.length);
	await info.attach('wrapped-arrow-path.json', { body: JSON.stringify(trace), contentType: 'application/json' });
});
