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
		// Forwarding to the workbench would replay after the next selection or edit.
		event.stopPropagation();
		if (key === 'v' && event.isTrusted && !event.defaultPrevented) {
			// Electron may omit the default paste event for either paste chord. Invoke
			// the native command while its trusted gesture and selection are current.
			// Existing guarded paste handlers still enforce locking and payload limits.
			let receivedPaste = false;
			const observedPaste = (): void => { receivedPaste = true; };
			this.view.dom.addEventListener('paste', observedPaste, true);
			try {
				const handled = document.execCommand('paste');
				// A guarded handler can cancel a delivered event while the command
				// reports false. Do not let the browser paste the same data twice.
				if (handled || receivedPaste) event.preventDefault();
			} catch {
				if (receivedPaste) event.preventDefault();
				// With no dispatched event, leave the browser's native fallback intact.
			} finally {
				this.view.dom.removeEventListener('paste', observedPaste, true);
			}
		}
	};
	destroy(): void {
		this.view.dom.removeEventListener('keydown', this.keydown);
	}
});
