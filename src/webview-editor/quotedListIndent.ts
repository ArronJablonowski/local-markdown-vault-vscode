import { EditorView } from '@codemirror/view';
import { getIndentUnit, syntaxTree } from '@codemirror/language';
import type { ChangeSpec } from '@codemirror/state';

/** Change list depth after the quote prefix, rather than indenting the quote. */
export function indentQuotedList(view: EditorView, outdent = false): boolean {
	return indentList(view, outdent, true);
}

/** Apply the editor's full tab width while retaining legacy one-level outdents. */
export function indentMarkdownList(view: EditorView, outdent = false): boolean {
	return indentList(view, outdent, false);
}

function indentList(view: EditorView, outdent: boolean, quotedOnly: boolean): boolean {
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
		const match = /^((?:[ \t]*>[ \t]?)*)([ \t]*)(?:[-+*]|\d+[.)])(?:[ \t]+|$)/.exec(line.text);
		if (!match || quotedOnly && !match[1]) return false;
		let node = syntaxTree(state).resolveInner(line.from + match[1].length + match[2].length, 1);
		while (node.name !== 'ListItem') {
			if (!node.parent || node.name === 'FencedCode' || node.name === 'CodeBlock') return false;
			node = node.parent;
		}
		// A first item has no preceding sibling to become its parent. Four
		// spaces there would turn the bullet into literal Markdown code.
		let previous = node.prevSibling;
		while (previous && previous.name !== 'ListItem') previous = previous.prevSibling;
		if (!previous) {
			let previousList = node.parent?.prevSibling;
			while (previousList?.name === 'QuoteMark') previousList = previousList.prevSibling;
			if (previousList?.name === 'BulletList' || previousList?.name === 'OrderedList') previous = previousList.lastChild;
		}
		if (!outdent && !previous) return true;
		const from = line.from + match[1].length;
		if (!outdent) changes.push({ from, insert: ' '.repeat(getIndentUnit(state)) });
		else {
			let remove = match[2].startsWith('\t') ? 1 : Math.min(getIndentUnit(state), match[2].length);
			for (let parent = node.parent; parent; parent = parent.parent) {
				if (parent.name !== 'ListItem') continue;
				const parentLine = state.doc.lineAt(parent.from).text;
				const parentIndent = /^((?:[ \t]*>[ \t]?)*)([ \t]*)(?:[-+*]|\d+[.)])(?:[ \t]+|$)/.exec(parentLine)?.[2];
				if (parentIndent !== undefined && match[2].startsWith(parentIndent)) {
					remove = match[2].length - parentIndent.length;
				}
				break;
			}
			if (remove) changes.push({ from, to: from + remove });
		}
	}
	if (changes.length) view.dispatch({ changes, scrollIntoView: true, userEvent: 'input.indent' });
	return true;
}
