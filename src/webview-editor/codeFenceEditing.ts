import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import type { Command } from '@codemirror/view';

interface FenceRange {
	closingLineNumber: number;
}

const MAX_FENCE_SCAN_LINES = 10_000;
const MAX_FENCE_CANDIDATES = 128;

/** Close only a parser-confirmed, top-level unfinished fence at EOF. */
function closeUnfinishedFence(view: Parameters<Command>[0], node: SyntaxNode): boolean {
	const { state } = view;
	if (node.parent?.name !== 'Document' || node.to !== state.doc.length) return false;
	const marks = node.getChildren('CodeMark');
	if (marks.length !== 1) return false;
	const opener = state.doc.lineAt(marks[0].from);
	if (!/^ {0,3}(?:`{3,}|~{3,})/.test(opener.text)) return false;
	const fence = state.sliceDoc(marks[0].from, marks[0].to);
	if (!/^(?:`{3,}|~{3,})$/.test(fence)) return false;
	const last = state.doc.line(state.doc.lines);
	const insert = (last.text.length ? '\n' : '') + fence + '\n';
	view.dispatch({
		changes: { from: state.doc.length, insert },
		selection: { anchor: state.doc.length + insert.length },
		scrollIntoView: true,
		userEvent: 'input',
	});
	return true;
}

function fencedCodeAncestor(node: SyntaxNode | null): SyntaxNode | null {
	for (let current = node; current; current = current.parent) {
		if (current.name === 'FencedCode') return current;
	}
	return null;
}

/**
 * Bounded textual fallback for caret positions where Lezer resolves an edge
 * of a decorated code line outside `FencedCode`.
 */
function textualFenceAroundLine(state: Parameters<Command>[0]['state'], lineNumber: number): FenceRange | undefined {
	const first = Math.max(1, lineNumber - MAX_FENCE_SCAN_LINES);
	let candidates = 0;
	for (let candidate = lineNumber; candidate >= first; candidate--) {
		const candidateLine = state.doc.line(candidate);
		const opener = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(candidateLine.text);
		if (!opener) continue;
		if (opener[1][0] === '`' && opener[2].includes('`')) continue;
		if (++candidates > MAX_FENCE_CANDIDATES) return undefined;
		const markFrom = candidateLine.from + candidateLine.text.indexOf(opener[1]);
		const parsed = fencedCodeAncestor(syntaxTree(state).resolveInner(markFrom, 1))
			?? fencedCodeAncestor(syntaxTree(state).resolveInner(markFrom, -1));
		// A previous block's closing fence looks exactly like an opener in plain
		// text. Never pair it with the next block and jump from unrelated prose.
		if (parsed?.getChildren('CodeMark')[0]?.from !== markFrom) continue;
		const fence = opener[1];
		const last = Math.min(state.doc.lines, candidate + MAX_FENCE_SCAN_LINES);
		for (let closing = candidate + 1; closing <= last; closing++) {
			const closingMatch = /^[ \t]*(`+|~+)[ \t]*$/.exec(state.doc.line(closing).text);
			if (!closingMatch || closingMatch[1][0] !== fence[0] || closingMatch[1].length < fence.length) continue;
			if (lineNumber > candidate && lineNumber < closing) return { closingLineNumber: closing };
			break;
		}
	}
	return undefined;
}

function moveAfterFencedCode(view: Parameters<Command>[0], node: SyntaxNode): boolean {
	const { state } = view;
	const marks = node.getChildren('CodeMark');
	const closingMark = marks.length >= 2 ? marks.at(-1) : undefined;
	if (!closingMark) return closeUnfinishedFence(view, node);
	const closingLine = state.doc.lineAt(closingMark.from);

	if (closingLine.number < state.doc.lines) {
		const followingLine = state.doc.line(closingLine.number + 1);
		view.dispatch({ selection: { anchor: followingLine.from }, scrollIntoView: true });
		return true;
	}

	view.dispatch({
		changes: { from: closingLine.to, insert: '\n' },
		selection: { anchor: closingLine.to + 1 },
		scrollIntoView: true,
		userEvent: 'input',
	});
	return true;
}

function moveAfterClosingLine(view: Parameters<Command>[0], closingLineNumber: number): boolean {
	const closingLine = view.state.doc.line(closingLineNumber);
	if (closingLine.number < view.state.doc.lines) {
		const followingLine = view.state.doc.line(closingLine.number + 1);
		view.dispatch({ selection: { anchor: followingLine.from }, scrollIntoView: true });
		return true;
	}
	view.dispatch({
		changes: { from: closingLine.to, insert: '\n' },
		selection: { anchor: closingLine.to + 1 },
		scrollIntoView: true,
		userEvent: 'input',
	});
	return true;
}

/** Moves an empty caret out of a fenced code block without changing its code. */
export const escapeFencedCode: Command = (view) => {
	const { state } = view;
	if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return false;
	const cursor = state.selection.main.head;
	const node = fencedCodeAncestor(syntaxTree(state).resolveInner(cursor, 1))
		?? fencedCodeAncestor(syntaxTree(state).resolveInner(cursor, -1));
	if (node) return moveAfterFencedCode(view, node);
	const textual = textualFenceAroundLine(state, state.doc.lineAt(cursor).number);
	return textual ? moveAfterClosingLine(view, textual.closingLineNumber) : false;
};

/**
 * Leaves a fenced code block when Enter is pressed on its final blank content
 * line. The first Enter after code still creates that blank line; the second
 * Enter moves to a normal Markdown line below the closing fence. This mirrors
 * the familiar Obsidian interaction without preventing intentional newlines
 * within non-empty code.
 */
export const exitFencedCodeOnBlankLine: Command = (view) => {
	const { state } = view;
	const selection = state.selection;
	if (selection.ranges.length !== 1 || !selection.main.empty) return false;

	const cursor = selection.main.head;
	const line = state.doc.lineAt(cursor);
	if (line.text.trim().length !== 0) return false;
	if (line.number === state.doc.lines) {
		const unfinished = fencedCodeAncestor(syntaxTree(state).resolveInner(cursor, -1));
		return unfinished ? closeUnfinishedFence(view, unfinished) : false;
	}

	// Typing an opening fence and Enter auto-inserts its closing fence with
	// padding. A second Enter after code must escape even when another blank
	// line remains before that fence. Never skip actual code or scan unboundedly.
	let closingNumber = line.number + 1;
	while (closingNumber < state.doc.lines && closingNumber - line.number < MAX_FENCE_SCAN_LINES
		&& state.doc.line(closingNumber).text.trim().length === 0) closingNumber++;
	const closingLine = state.doc.line(closingNumber);
	const node = fencedCodeAncestor(syntaxTree(state).resolveInner(line.from, 1));
	if (!node || state.doc.lineAt(node.to).number !== closingLine.number) {
		const textual = textualFenceAroundLine(state, line.number);
		return textual?.closingLineNumber === closingLine.number
			? moveAfterClosingLine(view, closingLine.number)
			: false;
	}

	// Verify that the following line is the parser-recognized closing CodeMark,
	// rather than fence-looking text within a longer or differently typed fence.
	const closingMark = node.getChildren('CodeMark').at(-1);
	if (!closingMark) return false;
	const beforeMark = state.sliceDoc(closingLine.from, closingMark.from);
	const afterMark = state.sliceDoc(closingMark.to, closingLine.to);
	if (!/^[ \t]*$/.test(beforeMark) || !/^[ \t]*$/.test(afterMark)) return false;

	if (closingLine.number < state.doc.lines) {
		const followingLine = state.doc.line(closingLine.number + 1);
		if (followingLine.text.length === 0) {
			view.dispatch({ selection: { anchor: followingLine.from }, scrollIntoView: true });
			return true;
		}
		view.dispatch({
			changes: { from: followingLine.from, insert: '\n' },
			selection: { anchor: followingLine.from },
			scrollIntoView: true,
			userEvent: 'input',
		});
		return true;
	}

	view.dispatch({
		changes: { from: closingLine.to, insert: '\n' },
		selection: { anchor: closingLine.to + 1 },
		scrollIntoView: true,
		userEvent: 'input',
	});
	return true;
};
