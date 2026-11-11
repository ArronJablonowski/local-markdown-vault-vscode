import type { EditorState, StateEffect } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { foldedRanges, foldEffect, unfoldEffect } from '@codemirror/language';

export const CODE_PREVIEW_LINES = 6;
/** Fold after six content lines, excluding a fenced block's opening marker. */
export function codePreviewEnd(state: EditorState, from: number, to: number): number {
	return state.doc.line(Math.min(state.doc.lineAt(from).number + CODE_PREVIEW_LINES - 1, state.doc.lineAt(to).number)).to;
}
/** Find the actual mapped fold so edits before it cannot strand hidden content. */
export function existingCodeFold(state: EditorState, from: number, to: number): { from: number; to: number } | undefined {
	let found: { from: number; to: number } | undefined;
	foldedRanges(state).between(from, to, (start, end) => { if (start >= from && end === to) found = { from: start, to: end }; });
	return found;
}

interface PendingPreview {
	doc: EditorState['doc'];
	ranges: Map<string, { from: number; to: number }>;
}
const pendingPreviews = new WeakMap<EditorView, PendingPreview>();
const editingCode = (state: EditorState, from: number, to: number) => state.selection.ranges.some(range => range.from <= to && range.to >= from);

/** Rebase mapped folds after edits, but never hide a line the user is editing. */
export function codePreviewCollapsed(view: EditorView, from: number, to: number): boolean {
	const state = view.state;
	const folded = existingCodeFold(state, from, to);
	if (!folded) return false;
	if (folded.from === codePreviewEnd(state, from, to) || editingCode(state, from, to)) return true;
	let pending = pendingPreviews.get(view);
	if (pending) {
		if (pending.doc !== state.doc) { pending.doc = state.doc; pending.ranges.clear(); }
	} else {
		pending = { doc: state.doc, ranges: new Map() };
		pendingPreviews.set(view, pending);
		const scheduled = pending;
		queueMicrotask(() => {
			pendingPreviews.delete(view);
			if (!view.dom.isConnected || view.state.doc !== scheduled.doc) return;
			const effects: StateEffect<unknown>[] = [];
			for (const range of scheduled.ranges.values()) {
				const current = existingCodeFold(view.state, range.from, range.to);
				const start = codePreviewEnd(view.state, range.from, range.to);
				if (!current || current.from === start || editingCode(view.state, range.from, range.to)) continue;
				effects.push(unfoldEffect.of(current));
				// Once six or fewer lines remain, there is no content left to hide.
				if (start < range.to) effects.push(foldEffect.of({ from: start, to: range.to }));
			}
			// Dispatch after decoration construction, never reentrantly during an update.
			if (effects.length) view.dispatch({ effects });
		});
	}
	pending.ranges.set(`${from}:${to}`, { from, to });
	return true;
}
