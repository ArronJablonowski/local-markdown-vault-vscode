import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { getSearchQuery, searchPanelOpen } from '@codemirror/search';
import { t } from '../shared/i18n';

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



export { setSearchSelection, markingSearchSelection, getSearchQuery };

/**
 * Collapses the panel's replace row until it is asked for.
 *
 * @codemirror/search renders find and replace as one flat list of controls, and
 * always shows both. VS Code shows the replace row only behind a chevron,
 * because finding is much the more common of the two and the second row is
 * noise the rest of the time. The panel is not configurable, so the row is
 * hidden with CSS (`.cm-search:not(.mlp-search-replace-open)`) and this adds the
 * chevron that toggles the class.
 *
 * Injected by watching for the panel's DOM rather than by wrapping the panel
 * itself, since `search()` gives no hook for either.
 */
const REPLACE_OPEN_CLASS = 'mlp-search-replace-open';

/**
 * Labels for the find toggles, replacing the library's words.
 *
 * VS Code marks these three with icons; the words themselves ("match case",
 * "regexp", "by word") are long enough to wrap the panel at the widths it
 * usually opens at. Drawn as short text glyphs rather than SVG paths: at 14px a
 * hand-drawn `Aa` is mostly hinting noise, while the font renders the same
 * shapes crisply and scales with the user's editor font size. They are the same
 * shorthand VS Code uses — `Aa` for case, `ab` between word boundaries for
 * whole word, `.*` for regular expressions.
 */
const TOGGLE_GLYPHS: Record<string, string> = {
	case: 'Aa',
	word: '│ab│',
	re: '.*',
};

/**
 * Swaps each toggle's text label for its glyph.
 *
 * The label keeps its accessible name through `aria-label` and `title`, so the
 * text is only removed visually — the checkbox inside it is untouched, which is
 * what the library reads on commit.
 */
function iconifyToggles(panel: HTMLElement): void {
	for (const label of Array.from(panel.querySelectorAll('label'))) {
		const checkbox = label.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
		if (!checkbox) continue;
		const glyph = TOGGLE_GLYPHS[checkbox.name];
		if (!glyph || label.querySelector('.mlp-search-glyph')) continue;
		const name = label.textContent?.trim() ?? checkbox.name;
		label.title = name;
		label.setAttribute('aria-label', name);
		for (const node of Array.from(label.childNodes)) {
			if (node.nodeType === Node.TEXT_NODE) node.remove();
		}
		const span = document.createElement('span');
		span.className = 'mlp-search-glyph';
		span.textContent = glyph;
		span.setAttribute('aria-hidden', 'true');
		label.appendChild(span);
	}
}


function decorateSearchPanel(view: EditorView, panel: HTMLElement): void {
	iconifyToggles(panel);
	if (panel.querySelector('.mlp-search-toggle')) return;
	const toggle = document.createElement('button');
	toggle.type = 'button';
	toggle.className = 'mlp-search-toggle';
	toggle.setAttribute('aria-label', t('search.toggleReplace'));
	toggle.title = t('search.toggleReplace');
	toggle.textContent = '\u203a';
	const sync = () => {
		const open = panel.classList.contains(REPLACE_OPEN_CLASS);
		toggle.setAttribute('aria-expanded', String(open));
	};
	toggle.addEventListener('click', (event) => {
		// The panel is inside the editor; without this the click also reaches the
		// document and moves the caret out of the field the user was typing in.
		event.preventDefault();
		panel.classList.toggle(REPLACE_OPEN_CLASS);
		sync();
		view.focus();
	});
	sync();
	panel.insertBefore(toggle, panel.firstChild);
}

/**
 * Watches for the search panel appearing and adds the chevron to it.
 *
 * The panel mounts and unmounts as it is opened and closed, and CodeMirror
 * rebuilds it rather than reusing one instance, so this re-checks on every
 * update rather than only once.
 */
const replaceToggle = EditorView.updateListener.of((update) => {
	const panel = update.view.dom.querySelector('.cm-search') as HTMLElement | null;
	if (panel) decorateSearchPanel(update.view, panel);
});

export const searchRevealExtension: Extension = [
	searchSelectionField,
	markPanelMatches,
	clearOnPanelClose,
	replaceToggle,
];
