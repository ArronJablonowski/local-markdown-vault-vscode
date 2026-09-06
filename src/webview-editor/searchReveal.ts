import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { getSearchQuery, searchPanelOpen } from '@codemirror/search';

/**
 * Makes a search match reveal the Markdown behind it.
 *
 * `cursorTouchesRange` deliberately ignores non-empty selections, so that
 * sweeping a selection across a table is a copy rather than a request to edit
 * it. A search match is also a non-empty selection, but it means the opposite:
 * the user asked to be shown that text. Without this, jumping to a match inside
 * hidden syntax — a link's `](url)`, a table cell, a heading's `#` — selects a
 * range the rendered view does not draw, and the match appears to be nowhere.
 *
 * The two are told apart by *which command moved the selection* rather than by
 * anything about the selection itself: `findNext`/`findPrevious` set the effect
 * below, a mouse sweep does not.
 */
const setSearchSelection = StateEffect.define<boolean>();

/**
 * Whether the current selection came from a search command.
 *
 * Any transaction that changes the selection without saying so clears the flag,
 * so a match's reveal lasts exactly until the user moves on. The document
 * changing does not clear it: replacing a match leaves the selection on the
 * replacement, which should stay visible.
 */
const searchSelectionField = StateField.define<boolean>({
	create: () => false,
	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setSearchSelection)) return effect.value;
		}
		if (tr.selection) return false;
		return value;
	},
});

/** True when the selection was placed by a search command and still stands. */
export function selectionIsSearchMatch(state: EditorState): boolean {
	return state.field(searchSelectionField, false) ?? false;
}

/**
 * Runs a search command, marking whatever selection it leaves as a match.
 *
 * The command is dispatched first and the flag second, because the flag has to
 * survive the command's own selection-setting transaction — which, per the
 * field above, clears it.
 */
function markingSearchSelection(command: (view: EditorView) => boolean) {
	return (view: EditorView): boolean => {
		const handled = command(view);
		if (handled) view.dispatch({ effects: setSearchSelection.of(true) });
		return handled;
	};
}

/**
 * Marks a match found by the panel itself.
 *
 * The panel's own Enter key and next/previous buttons call `findNext` directly,
 * so they never pass through `markingSearchSelection`. Rather than reimplement
 * the panel, this watches for the shape those commands leave behind: the panel
 * is open, a query is active, and the selection moved to a range whose text is
 * exactly what is being searched for. That is precisely a match, and nothing a
 * mouse sweep produces unless it happens to select the search term — in which
 * case revealing it is the right thing anyway.
 */
const markPanelMatches = EditorView.updateListener.of((update) => {
	if (!update.selectionSet || update.docChanged) return;
	if (update.state.field(searchSelectionField, false)) return;
	if (!searchPanelOpen(update.state)) return;
	const query = getSearchQuery(update.state);
	if (!query.search) return;
	const range = update.state.selection.main;
	if (range.empty) return;
	const selected = update.state.sliceDoc(range.from, range.to);
	const matches = query.caseSensitive
		? selected === query.search
		: selected.toLowerCase() === query.search.toLowerCase();
	// A regexp query's match rarely equals its pattern, so compare against the
	// pattern only for a literal search; a regexp match still reveals via the
	// keymap path above.
	if (!query.regexp && matches) {
		update.view.dispatch({ effects: setSearchSelection.of(true) });
	}
});

/**
 * Keeps the flag honest when the panel closes.
 *
 * Closing the panel ends the search, so a still-selected match should go back
 * to behaving like any other selection rather than holding a block open.
 */
const clearOnPanelClose = EditorView.updateListener.of((update) => {
	if (!update.startState.field(searchSelectionField, false)) return;
	const wasOpen = searchPanelOpen(update.startState);
	const isOpen = searchPanelOpen(update.state);
	if (wasOpen && !isOpen) {
		update.view.dispatch({ effects: setSearchSelection.of(false) });
	}
});

export const searchRevealExtension: Extension = [searchSelectionField, markPanelMatches, clearOnPanelClose];

export { setSearchSelection, markingSearchSelection, getSearchQuery };
