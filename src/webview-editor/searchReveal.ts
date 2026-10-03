import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { getSearchQuery, openSearchPanel, searchPanelOpen, SearchQuery, setSearchQuery } from '@codemirror/search';
import { forceParsing } from '@codemirror/language';
import { t } from '../shared/i18n';
import { commitActiveDraft, preserveUncommittedDraft } from './activeDraft';

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
 * CodeMirror marks panel navigation and Select All Matches transactions with
 * `select.search`, including regular-expression queries. Use that provenance
 * rather than comparing selected text with the query: a regex pattern is not
 * its matched text, and re-evaluating it would duplicate potentially costly
 * work. Any unrelated selection transaction clears the flag. The document
 * changing does not clear it: replacing a match leaves the selection on the
 * replacement, which should stay visible.
 */
const searchSelectionField = StateField.define<boolean>({
	create: () => false,
	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setSearchSelection)) return effect.value;
		}
		// Typing a replacement supplies an explicit new caret as well as changes.
		// Retain its Find provenance while parsing catches up with that source.
		if (tr.selection) return tr.isUserEvent('select.search') || value && tr.docChanged;
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

/** Publish parsed source before Find transfers its selection back to the DOM. */
const settleSearchParsing = EditorView.updateListener.of(update => {
	if (!update.transactions.some(tr => tr.selection && tr.isUserEvent('select.search'))) return;
	const upto = Math.max(...update.state.selection.ranges.map(range => range.to));
	// forceParsing commits the parser's tree as well as advancing its context.
	// Publishing it now avoids postponing source/preview redraw to the first
	// typed character. A timed-out parse retains its late-parser fallback:
	// Find provenance survives replacement typing, so later ancestors open.
	forceParsing(update.view, upto, 50);
});

/**
 * Keeps the selected source visible when the panel closes.
 * The next selection-changing user action clears the search flag normally.
 */
const scrollOnPanelClose = EditorView.updateListener.of((update) => {
	if (!update.startState.field(searchSelectionField, false)) return;
	const wasOpen = searchPanelOpen(update.startState);
	const isOpen = searchPanelOpen(update.state);
	if (wasOpen && !isOpen) {
		// Revealing a search match and then closing the panel can change the
		// measured heights of thousands of preview blocks. Keep the match in view
		// after those decorations change instead of retaining an obsolete pixel
		// scroll offset from before the panel closed.
		// Do not hide selected syntax during the input-to-editor focus handoff:
		// Chromium can remap that disappearing DOM selection onto another block.
		update.view.dispatch({ scrollIntoView: true });
	}
});



export { setSearchSelection, markingSearchSelection, getSearchQuery };

/** Keep ephemeral Find/Replace UI across an authoritative full-document sync. */
export function preserveSearchPanel(view: EditorView): () => void {
	const query = getSearchQuery(view.state);
	const open = searchPanelOpen(view.state);
	const panel = view.dom.querySelector('.cm-search');
	const expanded = panel?.classList.contains(REPLACE_OPEN_CLASS) ?? false;
	const active = view.root.activeElement;
	const controls = panel ? Array.from(panel.querySelectorAll<HTMLElement>('input, button')) : [];
	const focusedIndex = controls.indexOf(active as HTMLElement);
	const caret = active instanceof HTMLInputElement && active.type === 'text'
		? { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection } : undefined;
	return () => {
		if (open) openSearchPanel(view);
		view.dispatch({ effects: setSearchQuery.of(query) });
		const restored = view.dom.querySelector('.cm-search');
		if (!restored) return;
		restored.classList.toggle(REPLACE_OPEN_CLASS, expanded);
		restored.querySelector('.mlp-search-toggle')?.setAttribute('aria-expanded', String(expanded));
		if (focusedIndex < 0) {
			// Mounting CodeMirror's panel selects its input. Restore the previous
			// focus owner when the user was typing in the note or another control.
			if (active instanceof HTMLElement && active.isConnected) active.focus();
			return;
		}
		const control = restored.querySelectorAll<HTMLElement>('input, button')[focusedIndex];
		control?.focus();
		if (control instanceof HTMLInputElement && caret?.start !== null && caret?.start !== undefined) {
			control.setSelectionRange(caret.start, caret.end, caret.direction ?? undefined);
		}
	};
}

/** Opens Find without deferring a focus change into the first typed query. */
export function openSearchPanelFocused(view: EditorView): boolean {
	const handled = openSearchPanel(view);
	if (!handled) return false;
	const focusPanel = (): boolean => {
		const panel = view.dom.querySelector<HTMLElement>('.cm-search');
		if (!panel) return false;
		// Finish the one-time DOM rearrangement before moving keyboard focus.
		decorateSearchPanel(view, panel);
		const input = panel.querySelector<HTMLInputElement>('input[name="search"]');
		if (input && view.root.activeElement !== input) {
			input.focus();
			input.select();
		}
		return true;
	};
	if (focusPanel()) return true;
	// Older panel implementations can mount asynchronously. Never refocus a
	// field after the user has already started typing elsewhere in the panel.
	view.requestMeasure({
		read: () => view.root.activeElement === view.contentDOM,
		write: shouldFocus => {
			if (shouldFocus) focusPanel();
		},
	});
	return true;
}

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
 * Groups the panel's flat run of controls into a find row and a replace row.
 *
 * The library emits every control as a sibling with a bare `<br>` between the
 * two halves, and leaves them to wrap. Wrapping cannot be trusted to break in
 * that one place: when the row runs short of width — a zoomed-in editor, a
 * narrow pane — flex breaks it wherever it happens to run out, which put the
 * find toggles on the replace line. Moving each half into its own element makes
 * the split structural, so the rows hold whatever the width.
 *
 * Re-run on every update, and cheap when there is nothing to do: the panel is
 * rebuilt each time it opens, so the rows have to be reformed with it.
 */
/**
 * Which row a given control belongs to.
 *
 * Split out from the DOM work so the rule can be tested on its own: `'widget'`
 * means the control belongs to the panel rather than to either row, and is left
 * where it is.
 */
export function searchRowFor(
	name: string | null,
	isChevron: boolean,
	afterBreak: boolean,
): 'find' | 'replace' | 'widget' {
	if (isChevron || name === 'close') return 'widget';
	return afterBreak ? 'replace' : 'find';
}

function groupSearchRows(panel: HTMLElement): void {
	const br = panel.querySelector('br');
	if (!br) return;
	const active = panel.ownerDocument.activeElement;
	const focusedInput = active instanceof HTMLInputElement && panel.contains(active) ? active : null;
	const selection = focusedInput && { start: focusedInput.selectionStart, end: focusedInput.selectionEnd, direction: focusedInput.selectionDirection };

	const findRow = document.createElement('div');
	findRow.className = 'mlp-search-row mlp-search-row-find';
	const replaceRow = document.createElement('div');
	replaceRow.className = 'mlp-search-row mlp-search-row-replace';

	// Everything before the `<br>` belongs to find, everything after it to
	// replace — except the close button and our own chevron, which belong to the
	// widget rather than to either row.
	let seenBreak = false;
	for (const child of Array.from(panel.childNodes)) {
		if (child === br) {
			seenBreak = true;
			continue;
		}
		if (child.nodeType === Node.ELEMENT_NODE) {
			const el = child as HTMLElement;
			const row = searchRowFor(
				el.getAttribute('name'),
				el.classList.contains('mlp-search-toggle'),
				seenBreak,
			);
			if (row === 'widget') continue;
			(row === 'replace' ? replaceRow : findRow).appendChild(el);
			continue;
		}
		(seenBreak ? replaceRow : findRow).appendChild(child);
	}
	br.remove();
	panel.insertBefore(replaceRow, panel.firstChild);
	panel.insertBefore(findRow, replaceRow);
	// Reparenting an input can blur it. Preserve partially typed queries and
	// their caret instead of letting a later focus callback select them all.
	if (focusedInput) {
		focusedInput.focus({ preventScroll: true });
		if (selection?.start !== null && selection?.start !== undefined) {
			focusedInput.setSelectionRange(selection.start, selection.end, selection.direction ?? undefined);
		}
	}
}

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
	groupSearchRows(panel);
	if (panel.querySelector('.mlp-search-toggle')) return;
	panel.addEventListener('keydown', event => {
		const field = event.target;
		if (!(field instanceof HTMLInputElement)) return;
		if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'a') {
			// VS Code forwards uncontained shortcuts back asynchronously. A late
			// Select All would select the first newly typed query characters.
			event.preventDefault();
			event.stopPropagation();
			field.select();
		} else if (event.key === 'Escape' || event.key === 'Enter') {
			// The panel already handled these keys; do not replay them in the host.
			event.stopPropagation();
		}
	});
	// Mouse paste, drag/drop, and assistive input do not necessarily emit keyup.
	// Commit on input so the first Enter searches the newly entered query.
	panel.addEventListener('input', event => {
		const field = event.target;
		if (!(field instanceof HTMLInputElement) || !['search', 'replace'].includes(field.name)) return;
		const current = getSearchQuery(view.state);
		const next = new SearchQuery({ ...current, [field.name]: field.value });
		if (!next.eq(current)) view.dispatch({ effects: setSearchQuery.of(next) });
	});
	const toggle = document.createElement('button');
	toggle.type = 'button';
	toggle.className = 'mlp-search-toggle';
	toggle.setAttribute('aria-label', t('search.toggleReplace'));
	toggle.title = t('search.toggleReplace');
	// An SVG chevron rather than a `\u203a` character: that glyph is punctuation,
	// positioned against the text baseline rather than centered on its em box, so
	// it sits visibly low and slightly right however the button itself is
	// centered. A path is symmetric about its viewBox, so it lands where it is
	// put.
	const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	chevron.setAttribute('viewBox', '0 0 16 16');
	chevron.setAttribute('width', '16');
	chevron.setAttribute('height', '16');
	chevron.setAttribute('fill', 'none');
	chevron.setAttribute('stroke', 'currentColor');
	chevron.setAttribute('stroke-width', '1.6');
	chevron.setAttribute('stroke-linecap', 'round');
	chevron.setAttribute('stroke-linejoin', 'round');
	chevron.setAttribute('aria-hidden', 'true');
	chevron.innerHTML = '<path d="M6.5 4 10.5 8l-4 4"/>';
	toggle.appendChild(chevron);
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

/** Find remains an editor command while focus belongs to a rendered field. */
const widgetSearchShortcut = ViewPlugin.fromClass(class {
	constructor(private readonly view: EditorView) {
		view.dom.addEventListener('keydown', this.keydown);
	}
	private readonly keydown = (event: KeyboardEvent): void => {
		if (event.defaultPrevented || event.isComposing || event.shiftKey || !(event.metaKey || event.ctrlKey)
			|| event.key.toLowerCase() !== 'f') return;
		const target = event.target;
		if (!(target instanceof HTMLElement) || target === this.view.contentDOM || !this.view.contentDOM.contains(target)) return;
		event.preventDefault();
		event.stopPropagation();
		const residual = commitActiveDraft();
		if (residual !== undefined) preserveUncommittedDraft(residual);
		openSearchPanelFocused(this.view);
	};
	destroy(): void {
		this.view.dom.removeEventListener('keydown', this.keydown);
	}
});

export const searchRevealExtension: Extension = [
	searchSelectionField,
	settleSearchParsing,
	scrollOnPanelClose,
	replaceToggle,
	widgetSearchShortcut,
];
