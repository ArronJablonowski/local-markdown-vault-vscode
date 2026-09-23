import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
	cursorTouchesRange,
	blockCursorTouchesRange,
	setPointerDownForTesting,
	setSuppressForTesting,
	allowRevealOnce,
	protectRenderedBlockFromCaret,
	noteRevealed,
	clearRevealedForTesting,
} from './cmUtils';

const DOC = 'above\n| a | b |\n|---|---|\n| 1 | 2 |\nbelow\n';

/** Range of the table block in DOC (lines 2-4). */
function tableRange(state: EditorState): { from: number; to: number } {
	return { from: state.doc.line(2).from, to: state.doc.line(4).to };
}

function stateWithSelection(anchor: number, head = anchor): EditorState {
	return EditorState.create({ doc: DOC, selection: { anchor, head } });
}

describe('cursorTouchesRange', () => {
	beforeEach(() => {
		setPointerDownForTesting(false);
		setSuppressForTesting(false);
	});

	it('is true for a caret on a line inside the range', () => {
		const state = stateWithSelection(0);
		const { from, to } = tableRange(state);
		const inside = state.doc.line(3).from + 2;
		expect(cursorTouchesRange(stateWithSelection(inside), from, to)).toBe(true);
	});

	it('is false for a caret outside the range', () => {
		const state = stateWithSelection(0);
		const { from, to } = tableRange(state);
		expect(cursorTouchesRange(stateWithSelection(1), from, to)).toBe(false);
	});

	// Sweeping a selection across a rendered block is a copy gesture. Unrendering
	// it mid-sweep replaces the rows being selected with raw pipe text and loses
	// the selection the user was making.
	// Inline constructs must give up their source to a drag-select: dragging
	// across an image's `](url)` is how you select that URL, and it cannot be
	// selected while it is hidden. Blocks keep the copy-sweep protection, but
	// they get it from `blockCursorTouchesRange` (covered below), not here.
	it('reveals for a selection that overlaps the range', () => {
		const state = stateWithSelection(0);
		const { from, to } = tableRange(state);
		const head = state.doc.line(3).from + 2;
		expect(cursorTouchesRange(stateWithSelection(0, head), from, to)).toBe(true);
	});

	it('ignores a selection that stops short of the range', () => {
		const state = stateWithSelection(0);
		const { from } = tableRange(state);
		// Ends exactly where the range starts: adjacency, not overlap.
		expect(cursorTouchesRange(stateWithSelection(0, from), from, from + 4)).toBe(false);
	});

	it('a sweep across a block still leaves the block rendered', () => {
		// The guarantee that matters for the copy-sweep case, now enforced one
		// level up.
		const state = stateWithSelection(0);
		const { from, to } = tableRange(state);
		const head = state.doc.line(3).from + 2;
		expect(blockCursorTouchesRange(stateWithSelection(0, head), from, to)).toBe(false);
	});

	// A blank line above a table resolves to document position 0, so pressing
	// there and dragging down reads as a plain caret move whose head lands inside
	// the table — indistinguishable from a click on it. Suppressing while the
	// button is held is what keeps the block from flipping to source mid-gesture.
	// The mouse-gesture guards live in `blockCursorTouchesRange`, not here.
	// `cursorTouchesRange` also decides whether a heading shows its `#` and
	// whether `**bold**` shows its asterisks; guarding it meant clicking a
	// heading moved the caret but left the markup hidden, so the line could not
	// be edited by mouse at all.
	it('ignores the mouse-gesture guards, which are not its concern', () => {
		const state = stateWithSelection(0);
		const { from, to } = tableRange(state);
		const inside = state.doc.line(3).from + 2;
		setPointerDownForTesting(true);
		setSuppressForTesting(true);
		expect(cursorTouchesRange(stateWithSelection(inside), from, to)).toBe(true);
	});
});

describe('blockCursorTouchesRange', () => {
	beforeEach(() => {
		setPointerDownForTesting(false);
		setSuppressForTesting(false);
		clearRevealedForTesting();
	});

	it('agrees with cursorTouchesRange when no gesture is in play', () => {
		const state = stateWithSelection(0);
		const { from, to } = tableRange(state);
		const inside = state.doc.line(3).from + 2;
		expect(blockCursorTouchesRange(stateWithSelection(inside), from, to)).toBe(true);
		expect(blockCursorTouchesRange(stateWithSelection(1), from, to)).toBe(false);
	});

	// A blank line above a table resolves to document position 0, so pressing
	// there and dragging down reads as a plain caret move whose head lands inside
	// the table — indistinguishable from a click on it. Suppressing while the
	// button is held keeps the block from flipping to source mid-gesture.
	it('is false while a mouse gesture is in progress', () => {
		const state = stateWithSelection(0);
		const { from, to } = tableRange(state);
		const inside = state.doc.line(3).from + 2;
		setPointerDownForTesting(true);
		expect(blockCursorTouchesRange(stateWithSelection(inside), from, to)).toBe(false);
	});

	it('reveals the source again once the gesture ends', () => {
		const state = stateWithSelection(0);
		const { from, to } = tableRange(state);
		const inside = state.doc.line(3).from + 2;
		setPointerDownForTesting(true);
		setPointerDownForTesting(false);
		expect(blockCursorTouchesRange(stateWithSelection(inside), from, to)).toBe(true);
	});

	it('suppresses the reveal for a caret dragged into a block', () => {
		const state = stateWithSelection(0);
		const { from, to } = tableRange(state);
		const inside = state.doc.line(3).from + 2;
		setSuppressForTesting(true);
		expect(blockCursorTouchesRange(stateWithSelection(inside), from, to)).toBe(false);
	});

	// A block already showing its source must keep showing it whatever the mouse
	// does. Applying the guards to one that is already open made it flip back to
	// its rendered form for an instant on every click inside it — visible as the
	// source flashing to a table while it was being edited.
	it('keeps a block open once its source is already showing', () => {
		const state = stateWithSelection(0);
		const { from, to } = tableRange(state);
		const inside = state.doc.line(3).from + 2;
		noteRevealed(from, to, true);
		setSuppressForTesting(true);
		expect(blockCursorTouchesRange(stateWithSelection(inside), from, to)).toBe(true);
		setPointerDownForTesting(true);
		expect(blockCursorTouchesRange(stateWithSelection(inside), from, to)).toBe(true);
	});
	it('keeps revealed source open during nonempty keyboard and mouse selections', () => {
		const state = stateWithSelection(0);
		const { from, to } = tableRange(state);
		const inside = state.doc.line(3).from + 2;
		noteRevealed(from, to, true);
		expect(blockCursorTouchesRange(stateWithSelection(inside, inside + 2), from, to)).toBe(true);
		setPointerDownForTesting(true);
		expect(blockCursorTouchesRange(stateWithSelection(inside, inside + 2), from, to)).toBe(true);
		expect(blockCursorTouchesRange(stateWithSelection(0, 1), from, to)).toBe(false);
	});

	it('stops exempting a block once it is rendered again', () => {
		const state = stateWithSelection(0);
		const { from, to } = tableRange(state);
		const inside = state.doc.line(3).from + 2;
		noteRevealed(from, to, true);
		noteRevealed(from, to, false);
		setSuppressForTesting(true);
		expect(blockCursorTouchesRange(stateWithSelection(inside), from, to)).toBe(false);
	});

	// The exemption must not leak to a block the caret is not in.
	it('does not exempt a block whose range was never revealed', () => {
		const state = stateWithSelection(0);
		const { from, to } = tableRange(state);
		const inside = state.doc.line(3).from + 2;
		noteRevealed(from + 100, to + 100, true);
		setSuppressForTesting(true);
		expect(blockCursorTouchesRange(stateWithSelection(inside), from, to)).toBe(false);
	});

	// `allowRevealOnce` is the code-mode button's way past the suppression, since
	// that button's press never reaches the block to clear the flag itself.
	it('lets allowRevealOnce lift the suppression', () => {
		const state = stateWithSelection(0);
		const { from, to } = tableRange(state);
		const inside = state.doc.line(3).from + 2;
		setSuppressForTesting(true);
		expect(blockCursorTouchesRange(stateWithSelection(inside), from, to)).toBe(false);
		allowRevealOnce();
		expect(blockCursorTouchesRange(stateWithSelection(inside), from, to)).toBe(true);
	});

	it('lets an internal keyboard control protect its rendered block', () => {
		const base = stateWithSelection(0);
		const { from, to } = tableRange(base);
		const state = stateWithSelection(base.doc.line(3).from + 2);
		setSuppressForTesting(false);
		protectRenderedBlockFromCaret();
		expect(blockCursorTouchesRange(state, from, to)).toBe(false);
	});
});
