import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import type { Command } from '@codemirror/view';
import { findInlineHighlightRanges } from './inlineHighlight';

function isInsideCode(node: SyntaxNode | null): boolean {
	for (let current = node; current; current = current.parent) {
		if (current.name === 'InlineCode' || current.name === 'FencedCode' || current.name === 'CodeBlock') return true;
	}
	return false;
}

function highlightAtCaret(view: Parameters<Command>[0]) {
	const { state } = view;
	if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return undefined;
	const cursor = state.selection.main.head;
	const line = state.doc.lineAt(cursor);
	const relative = cursor - line.from;
	if (isInsideCode(syntaxTree(state).resolveInner(cursor, -1))) return undefined;
	const range = findInlineHighlightRanges(line.text).find((candidate) => (
		relative >= candidate.from + 2 && relative <= candidate.to
	));
	return range ? { line, cursor, relative, range } : undefined;
}

/** Escape moves the caret past the closing `==` without modifying the note. */
export const escapeInlineHighlight: Command = (view) => {
	const match = highlightAtCaret(view);
	if (!match) return false;
	view.dispatch({
		selection: { anchor: match.line.from + match.range.to },
		scrollIntoView: true,
	});
	return true;
};

/** Enter at the end of highlighted text starts a normal line after the marker. */
export const exitInlineHighlightOnEnter: Command = (view) => {
	const match = highlightAtCaret(view);
	if (!match || match.relative < match.range.to - 2) return false;
	const insertAt = match.line.from + match.range.to;
	view.dispatch({
		changes: { from: insertAt, insert: '\n' },
		selection: { anchor: insertAt + 1 },
		scrollIntoView: true,
		userEvent: 'input',
	});
	return true;
};
