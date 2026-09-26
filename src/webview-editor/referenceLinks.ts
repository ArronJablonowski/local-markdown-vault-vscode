import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';
import { markdownDestination } from '../shared/markdownDestination';

// Syntax-tree identity invalidates definitions after edits without retaining old documents.
const cache = new WeakMap<Tree, Map<string, string>>();
const normalize = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase();

/** Bounded, parser-backed lookup; never interprets definitions inside code. */
export function referenceLinkTarget(state: EditorState, node: SyntaxNode): string | undefined {
	const marks = node.getChildren('LinkMark');
	if (marks.length < 2) return undefined;
	const labelNode = node.getChild('LinkLabel');
	const label = labelNode ? state.sliceDoc(labelNode.from + 1, labelNode.to - 1) : '';
	const key = normalize(label || state.sliceDoc(marks[0].to, marks[1].from));
	if (!key || key.length > 999 || key.startsWith('^')) return undefined;
	const tree = syntaxTree(state);
	let definitions = cache.get(tree);
	if (!definitions) {
		definitions = new Map();
		const cursor = tree.cursor();
		let remaining = 100_000;
		do {
			if (cursor.name !== 'LinkReference') continue;
			const id = cursor.node.getChild('LinkLabel');
			const url = cursor.node.getChild('URL');
			if (!id || !url || id.to - id.from > 1001 || url.to - url.from > 4096) continue;
			const name = normalize(state.sliceDoc(id.from + 1, id.to - 1));
			if (!definitions.has(name)) {
				const raw = state.sliceDoc(url.from, url.to);
				definitions.set(name, markdownDestination(raw));
			}
		} while (--remaining > 0 && cursor.next());
		cache.set(tree, definitions);
	}
	return definitions.get(key);
}
