import { EditorView, ViewPlugin } from '@codemirror/view';

/** Keep clipboard gestures in this editor instead of VS Code's delayed key replay. */
export const clipboardShortcuts = ViewPlugin.fromClass(class {
	constructor(private readonly view: EditorView) {
		// Bubble phase lets cell inputs and CodeMirror process their own keys first.
		view.dom.addEventListener('keydown', this.keydown);
	}
	private readonly keydown = (event: KeyboardEvent): void => {
		if (event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey)) return;
		const key = event.key.toLowerCase();
		// Paste Without Formatting still needs the browser's native paste event.
		// Other shifted shortcuts (such as developer tools) belong to the host.
		if (event.shiftKey && key !== 'v') return;
		const target = event.target;
		if (key === 'a' && (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
			&& ['text', 'search', 'url', 'tel', 'email', 'password'].includes(target.type))) {
			// Property fields need the same immediate Select All behavior as the source editor.
			target.select();
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (!['c', 'x', 'v'].includes(key)) return;
		// Do not preventDefault: the browser must still emit the real copy/cut/paste event.
		// Forwarding to the workbench would replay it after the next selection or edit.
		event.stopPropagation();
		if (key === 'v' && event.shiftKey && event.isTrusted) {
			// Electron on macOS emits no default paste for this shifted chord.
			// A synchronous native command preserves the current selection and uses
			// the same guarded paste handlers; never read the clipboard asynchronously.
			try { if (document.execCommand('paste')) event.preventDefault(); } catch { /* Keep the browser fallback when unavailable. */ }
		}
	};
	destroy(): void {
		this.view.dom.removeEventListener('keydown', this.keydown);
	}
});
