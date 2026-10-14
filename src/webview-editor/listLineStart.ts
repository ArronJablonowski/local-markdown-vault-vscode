import { cursorLineBoundaryBackward, selectLineBoundaryBackward } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/** Keep Home/Shift+Home able to reach source hidden behind rendered list prefixes. */
export function listLineStart(view: EditorView, extend = false): boolean {
	const range = view.state.selection.main;
	const line = view.state.doc.lineAt(range.head);
	const prefix = /^(?:[ \t]*>[ \t]?)*[ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[[^\]\r\n]\][ \t]*)?/.exec(line.text);
	if (!prefix || view.state.selection.ranges.length !== 1) return false;
	// Preserve ordinary visual-line movement on wrapped items. Only correct the
	// boundary when it has reached the first line's hidden Markdown prefix.
	(extend ? selectLineBoundaryBackward : cursorLineBoundaryBackward)(view);
	const moved = view.state.selection.main;
	if (moved.head <= line.from + prefix[0].length) {
		view.dispatch({ selection: EditorSelection.single(extend ? moved.anchor : line.from, line.from), scrollIntoView: true });
	}
	return true;
}
