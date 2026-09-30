import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

/** Parser-owned text spans exclude Markdown indentation and quote/list prefixes. */
export function indentedCodeText(state: EditorState, node: SyntaxNode): string {
	return node.getChildren('CodeText').map(part => state.sliceDoc(part.from, part.to)).join('');
}
