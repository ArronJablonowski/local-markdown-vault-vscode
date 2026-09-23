import type { EditorState } from '@codemirror/state';
import { selectionIsSearchMatch } from './searchReveal';

/**
 * Whether a mouse button is currently held down anywhere in the document.
 *
 * A rendered block must not give way to its source in the middle of a drag. The
 * caret is dragged *through* a block on the way to somewhere else — and because
 * a blank line above a table resolves to document position 0, a press there
 * followed by a drag downward reads as a plain caret move whose head lands
 * inside the table, indistinguishable from a click on it. Unrendering then
 * swaps the rows out from under the pointer mid-gesture. Whether the button is
 * still down is what tells the two apart: a gesture in progress is not yet a
 * decision to edit.
 *
 * Tracked here, at module scope, because `cursorTouchesRange` is called from
 * pure state-derived code (decoration builders) that has no view or event to
 * consult. Listeners are attached once, in the capture phase so nothing can
 * stop them, and only when a DOM is actually present (the unit tests run in
 * plain Node).
 */
let pointerDown = false;
// Set when a mouse gesture ends with the caret somewhere it was dragged into
// rather than aimed at. Cleared by the next press, and never set by keyboard
// motion, so it suppresses exactly that one stray reveal.
let suppressUntilNextPress = false;
// Whether the gesture in progress ever had a rendered block under the pointer.
// Latched at press and while dragging, so a sweep that starts above a table and
// ends inside it still counts as having touched one.
let pressTouchedBlock = false;
const releaseListeners = new Set<() => void>();

// `.mlp-block` is the spacing wrapper every rendered block widget sits in (see
// blockWidgetWrap.ts), so hit-testing it covers the block *and* the padding and
// toolbar strip around it. Testing the inner elements alone left thin bands —
// measured at 30px above a table and 7px below — that belonged to no block, so a
// press there was treated as unrelated to it, the protection did not apply, and
// the block flipped to source. Those bands are what "clicking near the edge"
// lands on. `.mlp-code-mode-host` covers frontmatter, whose button host is the
// outermost element inside the wrapper.
const BLOCK_SELECTOR = '.mlp-block, .mlp-code-mode-host';

/** How far outside a block's box still counts as "on" it, in CSS pixels. */
const EDGE_SLOP_PX = 3;

/**
 * Whether a viewport point lies within any rendered block currently on screen.
 *
 * Measured against each block's own box rather than asked of the event, so a
 * block being re-rendered at that instant still counts.
 */
function pointIsInsideRenderedBlock(x: number, y: number): boolean {
	for (const el of Array.from(document.querySelectorAll(BLOCK_SELECTOR))) {
		// Only wrappers that actually contain a rendered widget: `.mlp-block` also
		// wraps blocks whose source is already showing, and those must keep the
		// ordinary click-to-place-caret behavior.
		if (!el.querySelector('.mlp-table, .mlp-mermaid-wrap, .mlp-frontmatter, .mlp-frontmatter-error')) continue;
		const box = el.getBoundingClientRect();
		// A few pixels of slop: a press one pixel outside the box is the same
		// gesture as one pixel inside it, and rounding at fractional device pixel
		// ratios can put an apparently-inside click just outside.
		if (
			x >= box.left - EDGE_SLOP_PX &&
			x <= box.right + EDGE_SLOP_PX &&
			y >= box.top - EDGE_SLOP_PX &&
			y <= box.bottom + EDGE_SLOP_PX
		) {
			return true;
		}
	}
	return false;
}

/** Runs `listener` whenever a drag ends, so a view can re-evaluate its blocks. */
export function onPointerRelease(listener: () => void): () => void {
	releaseListeners.add(listener);
	return () => releaseListeners.delete(listener);
}

if (typeof document !== 'undefined') {
	document.addEventListener(
		'mousedown',
		(event) => {
			pointerDown = true;
			// Decided from the pointer's coordinates, not from `event.target`.
			// The target is unreliable here: starting a cell edit re-renders that
			// cell, so a press arriving while the DOM is being swapped can carry a
			// node already detached from the document — `closest` then finds no
			// block, the press is misread as starting outside one, and the block is
			// revealed. Because a fast click sequence keeps re-rendering, that
			// misread repeats, which is what made rapid clicking flip to source in
			// runs rather than once. Hit-testing the point has no such window.
			pressTouchedBlock = pointIsInsideRenderedBlock(event.clientX, event.clientY);
			// Cleared only when the press is *not* on a rendered block. Clearing it
			// unconditionally made the block under the caret re-render for the one
			// instant between this press and `pointerDown` taking effect — visible
			// as the source flashing back to a table on every click into it. A press
			// on a block does not need it cleared here anyway: `release` sets the
			// flag again for exactly that case, and the `</>` button lifts it
			// through `allowRevealOnce`.
			if (!pressTouchedBlock) suppressUntilNextPress = false;
		},
		true,
	);
	// `mouseup` can land outside the window; `blur` and `mouseleave` on the
	// document keep the flag from sticking in that case.
	const release = () => {
		if (!pointerDown) return;
		pointerDown = false;
		// No mouse gesture that touched a rendered block should leave that block
		// showing its source. Whether the press started inside the block (a click
		// on a cell) or outside it (a drag that swept in), the reveal is never what
		// was wanted — cells are edited in place, and the `</>` button is the way
		// to the source. So the suppression is set for *every* release, not only
		// for drags that began outside, and is lifted by the next press or by the
		// button calling `allowRevealOnce`. Keying it on where the press began was
		// the bug: whenever that was misjudged, the block flipped to source.
		// Only when the gesture actually involved a rendered block. A press on
		// ordinary text that happens to sit on a block's *source* lines (the block
		// is already revealed, so there is no widget under the pointer) must still
		// place the caret normally and keep the source open.
		suppressUntilNextPress = pressTouchedBlock;
		// Releasing changes what this function answers, but nothing about the
		// editor's *state* changed, so no decoration rebuild would be scheduled and
		// a block whose caret landed inside it during the drag would stay rendered.
		// Notify listeners so they can ask for one.
		for (const listener of releaseListeners) listener();
	};
	document.addEventListener(
		'mousemove',
		(event) => {
			if (!pointerDown || pressTouchedBlock) return;
			if (pointIsInsideRenderedBlock(event.clientX, event.clientY)) pressTouchedBlock = true;
		},
		true,
	);
	// Typing is a deliberate edit, so it lifts the suppression immediately. Left
	// standing, the refresh that follows a mouse release re-rendered the block the
	// caret was sitting in — the source the user had just opened flashed back to a
	// rendered table for a frame before the next keystroke cleared the flag.
	document.addEventListener('keydown', (event) => {
		// Typing in a rendered cell/property is not a request to reveal its source.
		// Background vault-index refreshes rebuild decorations; dropping this
		// guard let that refresh remove the field halfway through typing.
		const target = event.target;
		suppressUntilNextPress = target instanceof Element
			&& !!target.closest('.mlp-table-wrap, .mlp-frontmatter');
	}, true);
	document.addEventListener('mouseup', release, true);
	document.addEventListener('dragend', release, true);
	window.addEventListener('blur', release, true);
}

/**
 * Clears the "dragged in, don't reveal" suppression.
 *
 * The code-mode button reveals a block's source deliberately, which is exactly
 * what the suppression exists to prevent when it happens by accident. Its press
 * lands on the block, so it would normally clear the flag itself — but the
 * button stops that press from propagating, so it has to say so explicitly.
 */
export function allowRevealOnce(): void {
	suppressUntilNextPress = false;
}

/**
 * Keeps a rendered block in widget mode while an internal keyboard control
 * deliberately parks CodeMirror's document selection on that block.
 *
 * Pointer-driven controls get this protection from the global gesture guard.
 * A keyboard event clears that guard in capture phase, so controls such as an
 * editable table cell must restore it immediately before dispatching their
 * selection change. The next keydown clears it normally.
 */
export function protectRenderedBlockFromCaret(): void {
	suppressUntilNextPress = true;
}

/**
 * Block ranges whose source is currently on screen.
 *
 * Recorded as the decorations are built (`noteRevealed`), and consulted on the
 * next build so an open block is not closed by a mouse gesture inside it. Keyed
 * by range rather than held per widget because the widget does not exist while
 * the source is showing.
 */
const revealedRanges = new Set<string>();

function rangeKey(from: number, to: number): string {
	return from + ':' + to;
}

/**
 * Records whether the block at [from, to] is showing its source this build.
 *
 * Called by the decoration builders for every block they consider, so the set
 * tracks the document as it is now rather than accumulating stale ranges.
 */
export function noteRevealed(from: number, to: number, revealed: boolean): void {
	const key = rangeKey(from, to);
	if (revealed) revealedRanges.add(key);
	else revealedRanges.delete(key);
}

/** Test seam: clears the remembered reveal state. */
export function clearRevealedForTesting(): void {
	revealedRanges.clear();
}

/** Test seam: drives the post-gesture suppression without a real pointer. */
export function setSuppressForTesting(value: boolean): void {
	suppressUntilNextPress = value;
}

/** Test seam: lets unit tests drive the drag state without a real pointer. */
export function setPointerDownForTesting(value: boolean): void {
	pointerDown = value;
	if (!value) suppressUntilNextPress = false;
}

/**
 * `cursorTouchesRange`, plus the mouse-gesture guards that only *block widgets*
 * want.
 *
 * The guards are deliberately not part of `cursorTouchesRange` itself. That
 * function also decides whether a heading shows its `#`, whether `**bold**`
 * shows its asterisks, and so on for every inline construct — and suppressing
 * those after a mouse gesture meant clicking a heading moved the caret there
 * but left the markup hidden, so the line could not be edited by mouse at all.
 * Only a block that replaces its whole source with a rendered widget has the
 * problem these guards exist for.
 */
export function blockCursorTouchesRange(state: EditorState, from: number, to: number): boolean {
	const touching = cursorTouchesRange(state, from, to);
	if (!touching) return false;
	// Once source is open, selecting text inside it is an edit, not a drag
	// across a rendered widget. Keep it open before applying gesture guards.
	if (revealedRanges.has(rangeKey(from, to))) return true;
	// Sweeping a selection across a block is a copy, not a request to edit it:
	// unrendering mid-sweep replaces the rows being selected with pipe text and
	// loses the selection. Inline constructs want the opposite (a drag across an
	// image's `](url)` is how that URL gets selected), which is why this lives
	// here rather than in `cursorTouchesRange`. A search match is the exception —
	// it is a non-empty selection that explicitly asks to be shown.
	if (!selectionIsSearchMatch(state) && state.selection.ranges.some((range) => !range.empty)) {
		return false;
	}
	// These guards apply only to a block that is still rendered, never to the
	// source already being edited (handled above).
	// A gesture still in progress has not resolved into anything yet.
	if (pointerDown) return false;
	// The gesture touched a rendered block, so its caret is not a request to
	// edit that block's source — see `suppressUntilNextPress`.
	if (suppressUntilNextPress) return false;
	return true;
}

/**
 * True if the caret sits on a line spanned by [from, to] — the condition that
 * makes a rendered block (table, diagram, frontmatter) give way to its source.
 *
 * A selection counts when it actually overlaps [from, to] — dragging across an
 * image's `](url)` is a request to select that text, so the source has to be
 * there to select. A selection that merely *ends* on one of the range's lines
 * without covering any of it does not: that is a sweep passing through, and
 * revealing on it would reflow the text under the pointer mid-drag.
 *
 * The whole-block protection this used to provide — a sweep across a table is a
 * copy, not a request to edit it — lives in `blockCursorTouchesRange`, which is
 * what every block widget consults. Applying it here as well meant no inline
 * construct could ever be selected by mouse.
 *
 * Still deliberately excluded: any caret position while the mouse is down, a
 * drag in progress that has not resolved into anything yet. See `pointerDown`.
 */
export function cursorTouchesRange(state: EditorState, from: number, to: number): boolean {
	const startLine = state.doc.lineAt(Math.min(from, state.doc.length)).number;
	const endLine = state.doc.lineAt(Math.min(to, state.doc.length)).number;
	for (const range of state.selection.ranges) {
		if (range.empty) {
			const headLine = state.doc.lineAt(range.head).number;
			if (headLine >= startLine && headLine <= endLine) return true;
			continue;
		}
		// A non-empty selection reveals only what it actually covers. Touching at a
		// single point (`range.to === from`) is adjacency, not overlap.
		if (range.from < to && range.to > from) return true;
	}
	return false;
}
