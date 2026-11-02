import { EditorView, ViewPlugin, runScopeHandlers } from '@codemirror/view';

/** Only the note's Undo/Redo chords, not IME or alternative key gestures. */
export function isHistoryShortcut(event: KeyboardEvent): boolean {
	if (event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey)) return false;
	const key = event.key.toLowerCase();
	return (key === 'z' || key === 'y') && (!event.shiftKey || key === 'z');
}

/** Commands that belong to the note even when a rendered control owns focus. */
export function isNoteShortcut(event: KeyboardEvent): boolean {
	if (isHistoryShortcut(event)) return true;
	if (event.isComposing) return false;
	const key = event.key.toLowerCase();
	// Search traversal belongs to the note even when a widget owns focus.
	if (key === 'f3') return !event.altKey && !event.metaKey && !event.ctrlKey;
	if (!(event.metaKey || event.ctrlKey)) return false;
	if (key === 'g') return !event.altKey;
	if (event.shiftKey) return false;
	return key === 'a' && !event.altKey || key === 'f';
}

/** Rendered controls share note commands without stealing native field history. */
export const renderedNoteShortcuts = ViewPlugin.fromClass(class {
	constructor(private readonly view: EditorView) {
		view.dom.addEventListener('keydown', this.selectText, true);
		// Fallback after control handlers and CodeMirror's normal keymap run.
		view.dom.addEventListener('keydown', this.keydown);
	}
	private readonly selectText = (event: KeyboardEvent): void => {
		// Resolve selection commands before inline controls can consume them
		// without moving focus, otherwise the next typed character is lost.
		if (['a', 'g', 'f3'].includes(event.key.toLowerCase()) && event.target !== this.view.contentDOM) this.keydown(event);
	};
	private readonly keydown = (event: KeyboardEvent): void => {
		if (event.defaultPrevented || !isNoteShortcut(event)) return;
		const target = event.target instanceof Element ? event.target : null;
		if (!target || !this.view.contentDOM.contains(target) ||
			target.closest('input, textarea, select, [contenteditable="true"]:not(.cm-content)')) return;
		// Selected search results must receive typing just like Select All.
		// With no query, the search command can still move focus to its panel.
		if (['a', 'g', 'f3'].includes(event.key.toLowerCase())) this.view.focus();
		// WidgetType.ignoreEvent skips the editor keymap. Reuse its registered
		// commands once, including save ordering, locks, and Find-panel focus.
		if (runScopeHandlers(this.view, event, 'editor')) {
			event.preventDefault();
			event.stopPropagation();
		}
	};
	destroy(): void {
		this.view.dom.removeEventListener('keydown', this.selectText, true);
		this.view.dom.removeEventListener('keydown', this.keydown);
	}
});
