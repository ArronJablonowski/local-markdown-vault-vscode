import { EditorSelection } from '@codemirror/state';
import { EditorView, type Command } from '@codemirror/view';
import { parseCalloutHeader } from './callouts';
import { toggleCallout } from './calloutState';

/**
 * Returns the prefix Obsidian uses for a Shift+Enter continuation line.
 *
 * A continuation stays inside the same list item without adding another bullet,
 * number, or checkbox. Spaces replace that marker so the new line aligns with
 * the item text. Ordinary indented text keeps only its existing indentation.
 */
export function softLineBreakPrefix(line: string): string {
	const callout = parseCalloutHeader(line);
	if (callout) {
		// Keep quote markers after list containers: '- > [!note]' needs '  > '.
		return line.slice(0, callout.markerOffset).replace(/(?:[-+*]|\d+[.)])([ \t]+)/g, marker => marker.replace(/[^\t]/g, ' '));
	}
	const container = /^([ \t]*(?:>[ \t]?)*)(?:(?:[-+*]|\d+[.)])[ \t]+(?:\[[^\]\r\n]\][ \t]+)?)/.exec(line);
	if (container) {
		const outer = container[1];
		const marker = container[0].slice(outer.length);
		return outer + marker.replace(/[^\t]/g, ' ');
	}

	const quote = /^([ \t]*(?:>[ \t]?)+)/.exec(line);
	if (quote) return quote[1];
	return /^[ \t]*/.exec(line)?.[0] ?? '';
}

/** Inserts an Obsidian-style soft continuation line for every selection. */
export const insertSoftLineBreak: Command = (view) => {
	const { state } = view;
	if (state.readOnly || !state.facet(EditorView.editable)) return false;
	const headers = new Set<number>();
	const transaction = state.changeByRange((range) => {
		const line = state.doc.lineAt(range.from);
		if (parseCalloutHeader(line.text)) headers.add(line.from);
		const insert = `\n${softLineBreakPrefix(line.text)}`;
		return {
			changes: { from: range.from, to: range.to, insert },
			range: EditorSelection.cursor(range.from + insert.length),
		};
	});
	// A heading continuation must be visible even when its saved marker is '-'.
	const effects = [...headers].map(from => toggleCallout.of({ from: transaction.changes.mapPos(from, -1), collapsed: false }));
	view.dispatch(state.update(transaction, { effects, scrollIntoView: true, userEvent: 'input' }));
	return true;
};
