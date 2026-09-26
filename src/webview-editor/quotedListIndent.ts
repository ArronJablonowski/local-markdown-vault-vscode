import { EditorView } from '@codemirror/view';
import { getIndentUnit, syntaxTree } from '@codemirror/language';
import type { ChangeSpec } from '@codemirror/state';

/** Change list depth after the quote prefix, rather than indenting the quote. */
export function indentQuotedList(view: EditorView, outdent = false): boolean {
	const { state } = view;
	if (state.readOnly || !state.facet(EditorView.editable)) return false;
	// Overlapping selections must indent each physical line only once.
	const lines = new Set<number>();
	for (const range of state.selection.ranges) {
		const first = state.doc.lineAt(range.from).number;
		const last = state.doc.lineAt(range.empty ? range.to : Math.max(range.from, range.to - 1)).number;
		for (let n = first; n <= last; n++) lines.add(n);
	}
	const changes: ChangeSpec[] = [];
	for (const n of [...lines].sort((a, b) => a - b)) {
		const line = state.doc.line(n);
		const match = /^([ \t]*(?:>[ \t]?)+)([ \t]*)(?:[-+*]|\d+[.)])(?:[ \t]+|$)/.exec(line.text);
		if (!match) return false;
		let node = syntaxTree(state).resolveInner(line.from + match[1].length + match[2].length, 1);
		while (node.name !== 'ListItem') {
			if (!node.parent || node.name === 'FencedCode' || node.name === 'CodeBlock') return false;
			node = node.parent;
		}
		const from = line.from + match[1].length;
		if (!outdent) changes.push({ from, insert: ' '.repeat(getIndentUnit(state)) });
		else {
			const remove = match[2].startsWith('\t') ? 1 : Math.min(getIndentUnit(state), match[2].length);
			if (remove) changes.push({ from, to: from + remove });
		}
	}
	if (changes.length) view.dispatch({ changes, scrollIntoView: true, userEvent: 'input.indent' });
	return true;
}
