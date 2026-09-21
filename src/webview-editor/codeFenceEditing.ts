import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import type { Command } from '@codemirror/view';

function fencedCodeAncestor(node: SyntaxNode | null): SyntaxNode | null {
	for (let current = node; current; current = current.parent) {
		if (current.name === 'FencedCode') return current;
	}
	return null;
}

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
	if (line.text.trim().length !== 0 || line.number >= state.doc.lines) return false;

	const closingLine = state.doc.line(line.number + 1);
	const node = fencedCodeAncestor(syntaxTree(state).resolveInner(line.from, 1));
	if (!node || state.doc.lineAt(node.to).number !== closingLine.number) return false;

	// Verify that the following line is the parser-recognized closing CodeMark,
	// rather than fence-looking text within a longer or differently typed fence.
	const closingMark = node.getChildren('CodeMark').at(-1);
	if (!closingMark || closingMark.from !== closingLine.from || closingMark.to !== closingLine.to) return false;

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
