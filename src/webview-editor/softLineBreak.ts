import { EditorSelection } from '@codemirror/state';
import type { Command } from '@codemirror/view';

/**
 * Returns the prefix Obsidian uses for a Shift+Enter continuation line.
 *
 * A continuation stays inside the same list item without adding another bullet,
 * number, or checkbox. Spaces replace that marker so the new line aligns with
 * the item text. Ordinary indented text keeps only its existing indentation.
 */
export function softLineBreakPrefix(line: string): string {
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
	const transaction = state.changeByRange((range) => {
		const line = state.doc.lineAt(range.from);
		const insert = `\n${softLineBreakPrefix(line.text)}`;
		return {
			changes: { from: range.from, to: range.to, insert },
			range: EditorSelection.cursor(range.from + insert.length),
		};
	});
	view.dispatch(state.update(transaction, { scrollIntoView: true, userEvent: 'input' }));
	return true;
};
