import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

/** Parser-owned text spans exclude Markdown indentation and quote/list prefixes. */
export function indentedCodeText(state: EditorState, node: SyntaxNode): string {
	return node.getChildren('CodeText').map(part => state.sliceDoc(part.from, part.to)).join('');
}

/** Continue the parser's code container without interpreting literal code as a list. */
export function indentedCodeContinuationPrefix(state: EditorState, node: SyntaxNode, position: number): string {
	const line = state.doc.lineAt(position);
	const intersectsLine = (part: SyntaxNode) => part.from <= line.to && part.to > line.from;
	const part = node.getChildren('CodeText').find(intersectsLine) ?? node.getChildren('CodeMark').find(intersectsLine);
	if (!part) return /^[ \t]*(?:>[ \t]*)*/.exec(line.text)?.[0] ?? '';
	const codeStart = Math.max(line.from, part.from);
	// Only actual Markdown container markers precede CodeText. A literal '- '
	// or '[!note]' inside code must never change the continuation indentation.
	const container = state.sliceDoc(line.from, codeStart).replace(/(?:[-+*]|\d+[.)])([ \t]+)/g,
		marker => marker.replace(/[^\t]/g, ' '));
	return container + (/^[ \t]*/.exec(state.sliceDoc(codeStart, line.to))?.[0] ?? '');
}
