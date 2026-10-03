import { EditorView } from '@codemirror/view';
import { Prec, type EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';

const ATX_MARK_RE = /^#{2,6}$/;
const MAX_CONTEXT_PARSE_MS = 20;
const MAX_FRONTMATTER_SCAN_CHARACTERS = 64 * 1024;

function mayBeFrontmatter(state: EditorState, position: number): boolean {
	if (!/^---\r?\n/.test(state.sliceDoc(0, Math.min(5, state.doc.length)))) return false;
	// Frontmatter has no Markdown syntax-tree node. An unfinished or oversized
	// header is ambiguous, so retain literal typing rather than inventing spaces.
	const prefix = state.sliceDoc(3, Math.min(position, MAX_FRONTMATTER_SCAN_CHARACTERS));
	return !/\n---\r?\n/.test(prefix);
}

/**
 * Complete level 2–6 heading markers with a space in ordinary Markdown.
 * A single hash remains literal so typing a line-start hashtag is possible;
 * level-one headings use an explicit space, as in `# Meeting notes`.
 */
export const headingSpaceInputHandler = Prec.high(
	EditorView.inputHandler.of((view, from, to, text) => {
		if (from !== to || text.length !== 1 || text === ' ' || text === '#') return false;
		const { state } = view;
		if (view.compositionStarted || view.composing || state.readOnly ||
			state.selection.ranges.length !== 1 || !state.selection.main.empty) return false;
		const line = state.doc.lineAt(from);
		if (from - line.from < 2 || from - line.from > 6) return false;
		const prefix = state.sliceDoc(line.from, from);
		if (!ATX_MARK_RE.test(prefix) || mayBeFrontmatter(state, from)) return false;
		// A distant cursor can precede background parsing. Only format when the
		// parser reaches it within a small typing budget and confirms prose.
		const tree = ensureSyntaxTree(state, from, MAX_CONTEXT_PARSE_MS);
		if (!tree) return false;
		for (let node = tree.resolveInner(from, -1); node; node = node.parent!) {
			if (/Code|HTML|Comment|ProcessingInstruction/.test(node.name)) return false;
		}
		view.dispatch({
			changes: { from, to, insert: ' ' + text },
			selection: { anchor: from + 1 + text.length },
			userEvent: 'input.type',
		});
		return true;
	}),
);
