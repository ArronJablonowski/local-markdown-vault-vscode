import type { EditorState } from '@codemirror/state';
import { foldedRanges } from '@codemirror/language';

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
