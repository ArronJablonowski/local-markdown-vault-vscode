import { EditorSelection } from '@codemirror/state';
import { EditorView, type Command } from '@codemirror/view';
import { parseCalloutHeader } from './callouts';
import { toggleCallout } from './calloutState';
import { ensureSyntaxTree } from '@codemirror/language';
import { indentedCodeContinuationPrefix } from './indentedCode';

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
	// Nested list containers can place several spaces between quote markers.
	// Preserve all of them instead of stopping at the first outer quote.
	const container = /^([ \t]*(?:>[ \t]*)*)(?:(?:[-+*]|\d+[.)])[ \t]+(?:\[[^\]\r\n]\][ \t]+)?)/.exec(line);
	if (container) {
		const outer = container[1];
		const marker = container[0].slice(outer.length);
		return outer + marker.replace(/[^\t]/g, ' ');
	}

	// Preserve spacing between quotes, but not a previous task's trailing
	// alignment spaces: carrying those forward can turn a table into code.
	const quote = /^([ \t]*(?:>[ \t]*(?=>))*>[ \t]?)/.exec(line);
	if (quote) return quote[1];
	return /^[ \t]*/.exec(line)?.[0] ?? '';
}

/** Inserts an Obsidian-style soft continuation line for every selection. */
export const insertSoftLineBreak: Command = (view) => {
	const { state } = view;
	if (state.readOnly || !state.facet(EditorView.editable)) return false;
	const headers = new Set<number>();
	const parseTo = state.selection.ranges.reduce((end, range) => Math.max(end, range.to), 0);
	const tree = ensureSyntaxTree(state, parseTo, 50);
	const transaction = state.changeByRange((range) => {
		const line = state.doc.lineAt(range.from);
		let prefix = softLineBreakPrefix(line.text);
		let blockCode = false;
		for (let node = tree?.resolveInner(range.from, range.from === line.to ? -1 : 1); node; node = node.parent ?? undefined) {
			if (node.name === 'InlineCode') break;
			if (node.name === 'CodeBlock' || node.name === 'FencedCode') {
				prefix = indentedCodeContinuationPrefix(state, node, range.from); blockCode = true; break;
			}
		}
		if (!blockCode && parseCalloutHeader(line.text)) headers.add(line.from);
		const insert = `\n${prefix}`;
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
