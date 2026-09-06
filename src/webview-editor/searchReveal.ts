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
 * Glyphs for the find toggles, replacing the library's word labels.
 *
 * VS Code marks these three with icons rather than text, and the words wrapped
 * the panel onto a second line at the widths it usually opens at. Drawn here as
 * inline paths in the same hand-rolled style as the sidebar's own icons rather
 * than pulled from an icon font: the webview has no codicon file to reference,
 * and a whole icon dependency for three 16px glyphs is not worth its licence
 * and its bytes.
 *
 * `Aa` for case, `ab|` (a word between boundaries) for whole word, and `.*` for
 * regular expressions — the same shorthand VS Code uses.
 */
const TOGGLE_ICONS: Record<string, string> = {
	// "Aa"
	case: '<path d="M4.4 3h1.5l2.6 7H7.1l-.6-1.7H3.8L3.2 10H1.8L4.4 3zm-.2 4.2h1.9l-.95-2.7-.95 2.7z"/><path d="M12.2 5.3c-1.1 0-1.9.4-2.3 1.2l1 .5c.2-.4.6-.6 1.2-.6.7 0 1 .3 1 .8v.2l-1.5.2c-1.2.2-1.9.7-1.9 1.6 0 .8.7 1.4 1.7 1.4.7 0 1.3-.3 1.7-.8v.7h1.2V7.2c0-1.2-.8-1.9-2.1-1.9zm.9 3.2c0 .7-.5 1.2-1.3 1.2-.4 0-.7-.2-.7-.6 0-.4.3-.6.9-.7l1.1-.2v.3z"/>',
	// "ab" bracketed by word boundaries
	word: '<path d="M2 4h1v8H2V4zm11 0h1v8h-1V4z"/><path d="M5.6 6.2c-1 0-1.7.4-2 1.1l.9.4c.2-.3.6-.5 1-.5.6 0 .9.3.9.7v.2l-1.3.2c-1.1.2-1.7.6-1.7 1.4 0 .8.6 1.3 1.5 1.3.6 0 1.1-.2 1.5-.7v.6h1.1V7.9c0-1.1-.7-1.7-1.9-1.7zm.8 2.9c0 .6-.5 1-1.1 1-.4 0-.6-.2-.6-.5s.3-.5.8-.6l.9-.2v.3z"/><path d="M9.3 4.2H8.2v6.7h1.1v-.6c.3.4.8.7 1.4.7 1.2 0 2-1 2-2.5s-.8-2.4-2-2.4c-.6 0-1.1.2-1.4.6V4.2zm1.1 5.7c-.7 0-1.2-.6-1.2-1.5s.5-1.4 1.2-1.4c.7 0 1.1.5 1.1 1.4s-.4 1.5-1.1 1.5z"/>',
	// ".*"
	re: '<path d="M3.2 11.4a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2z"/><path d="M10.4 3.6v2.2l1.9-1.1.6 1.1-1.9 1.1 1.9 1.1-.6 1.1-1.9-1.1v2.2H9.1V8l-1.9 1.1L6.6 8l1.9-1.1L6.6 5.8l.6-1.1L9.1 5.8V3.6h1.3z"/>',
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
		const path = TOGGLE_ICONS[checkbox.name];
		if (!path || label.querySelector('svg')) continue;
		const name = label.textContent?.trim() ?? checkbox.name;
		label.title = name;
		label.setAttribute('aria-label', name);
		for (const node of Array.from(label.childNodes)) {
			if (node.nodeType === Node.TEXT_NODE) node.remove();
		}
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('viewBox', '0 0 16 16');
		svg.setAttribute('width', '14');
		svg.setAttribute('height', '14');
		svg.setAttribute('fill', 'currentColor');
		svg.setAttribute('aria-hidden', 'true');
		svg.innerHTML = path;
		label.appendChild(svg);
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
