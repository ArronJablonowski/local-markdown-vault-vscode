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
	if (event.isComposing || event.shiftKey || !(event.metaKey || event.ctrlKey)) return false;
	const key = event.key.toLowerCase();
	return key === 'a' && !event.altKey || key === 'f';
}

/** Rendered controls share note commands without stealing native field history. */
export const renderedNoteShortcuts = ViewPlugin.fromClass(class {
	constructor(private readonly view: EditorView) {
		view.dom.addEventListener('keydown', this.selectAll, true);
		// Fallback after control handlers and CodeMirror's normal keymap run.
		view.dom.addEventListener('keydown', this.keydown);
	}
	private readonly selectAll = (event: KeyboardEvent): void => {
		// Some inline controls let CodeMirror handle Select All without moving
		// focus. Resolve it first so immediate typing cannot stay on a checkbox.
		if (event.key.toLowerCase() === 'a' && event.target !== this.view.contentDOM) this.keydown(event);
	};
	private readonly keydown = (event: KeyboardEvent): void => {
		if (event.defaultPrevented || !isNoteShortcut(event)) return;
		const target = event.target instanceof Element ? event.target : null;
		if (!target || !this.view.contentDOM.contains(target) ||
			target.closest('input, textarea, select, [contenteditable="true"]:not(.cm-content)')) return;
		// Return Select All to the source editor before the next replacement key.
		if (event.key.toLowerCase() === 'a') this.view.focus();
		// WidgetType.ignoreEvent skips the editor keymap. Reuse its registered
		// commands once, including save ordering, locks, and Find-panel focus.
		if (runScopeHandlers(this.view, event, 'editor')) {
			event.preventDefault();
			event.stopPropagation();
		}
	};
	destroy(): void {
		this.view.dom.removeEventListener('keydown', this.selectAll, true);
		this.view.dom.removeEventListener('keydown', this.keydown);
	}
});
