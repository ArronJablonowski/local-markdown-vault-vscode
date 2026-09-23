import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

/** Expand only container prefixes, never adjacent prose or a list marker. */
export function diagramFenceRange(state: EditorState, node: SyntaxNode): { from: number; to: number } | null {
	const first = state.doc.lineAt(node.from);
	if (state.doc.lineAt(node.to).to !== node.to || !/^[ \t>]*$/.test(state.sliceDoc(first.from, node.from))) return null;
	return { from: first.from, to: node.to };
}

/** Lezer splits nested fence text around quote marks and list indentation. */
export function diagramFenceText(state: EditorState, node: SyntaxNode): string {
	return node.getChildren('CodeText').map(part => state.sliceDoc(part.from, part.to)).join('');
}
