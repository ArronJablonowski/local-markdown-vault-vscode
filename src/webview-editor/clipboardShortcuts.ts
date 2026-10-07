import { EditorView, ViewPlugin } from '@codemirror/view';

/** The native clipboard chords shared by the editor and rendered controls. */
export function isClipboardShortcut(event: KeyboardEvent): boolean {
	if (event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey)) return false;
	const key = event.key.toLowerCase();
	return ['c', 'x', 'v'].includes(key) && (!event.shiftKey || key === 'v');
}

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
		if (!isClipboardShortcut(event)) return;
		// Forwarding to the workbench would replay after the next selection or edit.
		event.stopPropagation();
		if (event.isTrusted && !event.defaultPrevented) {
			// Electron may omit the default clipboard event for a contained chord. Invoke
			// the native command while its trusted gesture and selection are current.
			// Existing clipboard handlers retain selection fidelity, locks, and limits.
			const command = key === 'c' ? 'copy' : key === 'x' ? 'cut' : 'paste';
			const ownerDocument = this.view.dom.ownerDocument;
			let receivedClipboardEvent = false;
			const observedClipboardEvent = (clipboardEvent: Event): void => {
				if (this.view.dom.contains(clipboardEvent.target as Node | null)) receivedClipboardEvent = true;
			};
			// Whole-table cut stops immediate propagation at the editor boundary.
			// Observe before it so a delivered, canceled command cannot run twice.
			ownerDocument.addEventListener(command, observedClipboardEvent, true);
			try {
				const handled = ownerDocument.execCommand(command);
				// A guarded handler can cancel a delivered event while the command
				// reports false. Do not let the browser repeat the same operation.
				if (handled || receivedClipboardEvent) event.preventDefault();
			} catch {
				if (receivedClipboardEvent) event.preventDefault();
				// With no dispatched event, leave the browser's native fallback intact.
			} finally {
				ownerDocument.removeEventListener(command, observedClipboardEvent, true);
			}
		}
	};
	destroy(): void {
		this.view.dom.removeEventListener('keydown', this.keydown);
	}
});
