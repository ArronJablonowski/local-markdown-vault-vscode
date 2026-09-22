import type { Command } from '@codemirror/view';

// A line containing only blockquote prefixes and/or an empty list marker. The
// list portion also accepts Obsidian task markers, including custom one-letter
// task states. Deliberately exclude arbitrary text so Enter never removes note
// content while trying to leave a rendered section.
const EMPTY_SECTION_MARKUP = /^(?:[ \t]*>[ \t]*)*(?:[ \t]*(?:[-+*]|\d+[.)])[ \t]*(?:\[[^\]\r\n]\][ \t]*)?)?[ \t]*$/;

export function isEmptySectionContinuation(text: string): boolean {
	if (text.trim().length === 0) {
		// Shift+Enter uses two or more indentation spaces to continue a list item.
		// A truly empty line is already outside its section and should receive a
		// normal newline; a single hand-typed space is ordinary document content.
		return text.length >= 2;
	}
	return EMPTY_SECTION_MARKUP.test(text);
}

/**
 * Makes the second Enter after structured Markdown land on a plain line.
 *
 * CodeMirror normally exits simple lists, but nested list, task, quote, and
 * Shift+Enter continuation prefixes can keep the caret visually inside the
 * final rendered block. Removing a marker-only current line in one operation
 * guarantees that repeated Enter presses reach unrelated Markdown—even when
 * the section is the last content in the document.
 */
export const exitEmptyMarkdownSection: Command = (view) => {
	const { state } = view;
	if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return false;
	const cursor = state.selection.main.head;
	const line = state.doc.lineAt(cursor);
	if (cursor !== line.to || !isEmptySectionContinuation(line.text)) return false;

	// Keep the marker line as a blank separator and place the caret on a second,
	// plain line. Without that separator, CommonMark can parse newly typed text
	// as a lazy continuation of the preceding list item or blockquote even though
	// its visible marker has gone away.
	view.dispatch({
		changes: { from: line.from, to: line.to, insert: '\n' },
		selection: { anchor: line.from + 1 },
		scrollIntoView: true,
		userEvent: 'input',
	});
	return true;
};
