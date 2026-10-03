import { ensureSyntaxTree } from '@codemirror/language';
import type { Transaction } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { Command } from '@codemirror/view';
import { findInlineHighlightRanges } from './inlineHighlight';
import { insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown';

// Match the normal Enter behavior, including immediately leaving an empty list.
const continueMarkdownMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });
const MAX_CONTEXT_PARSE_MS = 20;

function isInsideCode(node: SyntaxNode | null): boolean {
	for (let current = node; current; current = current.parent) {
		if (current.name === 'InlineCode' || current.name === 'FencedCode' || current.name === 'CodeBlock') return true;
	}
	return false;
}

function highlightAtCaret(view: Parameters<Command>[0]) {
	const { state } = view;
	if (state.readOnly || state.selection.ranges.length !== 1 || !state.selection.main.empty) return undefined;
	const cursor = state.selection.main.head;
	const line = state.doc.lineAt(cursor);
	const relative = cursor - line.from;
	const range = findInlineHighlightRanges(line.text).find((candidate) => (
		relative >= candidate.from + 2 && relative <= candidate.to
	));
	if (!range) return undefined;
	// A distant caret can precede background parsing. Do not interpret literal
	// code as highlighted prose when its surrounding syntax is still unknown.
	const tree = ensureSyntaxTree(state, cursor, MAX_CONTEXT_PARSE_MS);
	if (!tree || isInsideCode(tree.resolveInner(cursor, -1))) return undefined;
	return { line, cursor, relative, range };
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

/** Enter leaves the highlight while retaining its enclosing list or quote. */
export const exitInlineHighlightOnEnter: Command = (view) => {
	const match = highlightAtCaret(view);
	if (!match || match.relative < match.range.to - 2) return false;
	const { state } = view;
	const insertAt = match.line.from + match.range.to;
	// A caret immediately before the closing marker first leaves that inline
	// style. Continue the surrounding Markdown from there rather than inserting
	// a plain newline that silently drops a bullet, task, number, or quote.
	// Calculate the normal command from that virtual caret, then commit against
	// the original state once, without dispatching an intermediate caret move.
	// The transaction retains the real starting selection for history consumers.
	const continuationState = state.update({ selection: { anchor: insertAt } }).state;
	let continuation: Transaction | undefined;
	continueMarkdownMarkup({ state: continuationState, dispatch: transaction => { continuation = transaction; } });
	if (continuation) {
		// A Transaction is also a transaction spec: preserve its changes, effects,
		// and annotations, and re-run the original state's normal edit filters.
		view.dispatch(state.update(continuation));
		return true;
	}
	view.dispatch({
		changes: { from: insertAt, insert: '\n' },
		selection: { anchor: insertAt + 1 },
		scrollIntoView: true,
		userEvent: 'input',
	});
	return true;
};
