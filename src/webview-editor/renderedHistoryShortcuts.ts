import { EditorView, ViewPlugin, runScopeHandlers } from '@codemirror/view';

/** Only the note's Undo/Redo chords, not IME or alternative key gestures. */
export function isHistoryShortcut(event: KeyboardEvent): boolean {
	if (event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey)) return false;
	const key = event.key.toLowerCase();
	return (key === 'z' || key === 'y') && (!event.shiftKey || key === 'z');
}

/** Rendered controls share note history without stealing native field history. */
export const renderedHistoryShortcuts = ViewPlugin.fromClass(class {
	constructor(private readonly view: EditorView) {
		// Fallback after control handlers and CodeMirror's normal keymap run.
		view.dom.addEventListener('keydown', this.keydown);
	}
	private readonly keydown = (event: KeyboardEvent): void => {
		if (event.defaultPrevented || !isHistoryShortcut(event)) return;
		const target = event.target instanceof Element ? event.target : null;
		if (!target || !this.view.contentDOM.contains(target) ||
			target.closest('input, textarea, select, [contenteditable="true"]:not(.cm-content)')) return;
		// WidgetType.ignoreEvent keeps native controls usable, but also skips the
		// ordered history keymap. Reuse it once, including the locked-mode guard.
		if (runScopeHandlers(this.view, event, 'editor')) {
			event.preventDefault();
			event.stopPropagation();
		}
	};
	destroy(): void { this.view.dom.removeEventListener('keydown', this.keydown); }
});
