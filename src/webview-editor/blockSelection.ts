import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { Command } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

function fencedCodeAncestor(node: SyntaxNode | null): SyntaxNode | null {
	for (let current = node; current; current = current.parent) {
		if (current.name === 'FencedCode') return current;
	}
	return null;
}

/**
 * Expands a selection of every visible code line to the surrounding fences.
 * Partial selections stay ordinary text selections and are never widened.
 */
export function fullySelectedFenceRange(state: EditorState, from: number, to: number): { from: number; to: number } | null {
	if (from >= to) return null;
	const tree = syntaxTree(state);
	const startNode = fencedCodeAncestor(tree.resolveInner(from, 1)) ?? fencedCodeAncestor(tree.resolveInner(from, -1));
	const endNode = fencedCodeAncestor(tree.resolveInner(Math.max(from, to - 1), -1))
		?? fencedCodeAncestor(tree.resolveInner(Math.max(from, to - 1), 1));
	if (!startNode || startNode.from !== endNode?.from || startNode.to !== endNode.to) return null;
	// An unfinished fence has only its opening CodeMark. Its last line is code,
	// not a hidden closing delimiter: widening would delete unselected content.
	if (startNode.getChildren('CodeMark').length < 2) return null;

	const firstLine = state.doc.lineAt(startNode.from).number;
	const lastLine = state.doc.lineAt(Math.max(startNode.from, startNode.to - 1)).number;
	if (lastLine <= firstLine + 1) return null;
	const codeFrom = state.doc.line(firstLine + 1).from;
	const codeTo = state.doc.line(lastLine - 1).to;
	if (from > codeFrom || to < codeTo) return null;
	return { from: state.doc.line(firstLine).from, to: state.doc.line(lastLine).to };
}

/** Deletes a fully selected fenced block, including its hidden fence lines. */
export const deleteFullySelectedFencedCode: Command = (view) => {
	if (view.state.selection.ranges.length !== 1) return false;
	const selection = view.state.selection.main;
	const range = fullySelectedFenceRange(view.state, selection.from, selection.to);
	if (!range) return false;
	view.dispatch({
		changes: { from: range.from, to: range.to, insert: '' },
		selection: { anchor: range.from },
		scrollIntoView: true,
		userEvent: 'delete.selection',
	});
	return true;
};
