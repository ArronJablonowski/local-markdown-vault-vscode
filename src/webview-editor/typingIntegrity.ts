import type { Transaction } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';

// Commit ordinary physical-key typing before the browser mutates contenteditable.
// Native caret/DOM reconciliation can otherwise reorder characters after Find.
// IME, dead keys, replacements, paste, and noncancelable input keep their native path.
export const typingIntegrity = ViewPlugin.fromClass(class {
	key: string | undefined;
}, {
	eventHandlers: {
		keydown(event, view) {
			this.key = event.isTrusted && event.target === view.contentDOM &&
				!event.defaultPrevented && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey &&
				Array.from(event.key).length === 1 ? event.key : undefined;
			return false;
		},
		beforeinput(event, view) {
			const key = this.key;
			this.key = undefined;
			if (!key || !event.isTrusted || !event.cancelable || event.defaultPrevented ||
				event.target !== view.contentDOM || !view.hasFocus ||
				event.inputType !== 'insertText' || event.data !== key ||
				event.isComposing || view.compositionStarted || view.composing ||
				view.state.readOnly || !view.state.facet(EditorView.editable)) return false;

			// Keep the normal input-handler order (pairing, heading spacing) and all
			// transaction filters, multiple selections, host saves, and host history.
			event.preventDefault();
			const { state } = view;
			const { from, to } = state.selection.main;
			let transaction: Transaction | undefined;
			const insert = () => transaction ??= state.update({
				...state.replaceSelection(state.toText(key)),
				userEvent: 'input.type',
				scrollIntoView: true,
			});
			if (!state.facet(EditorView.inputHandler).some(handler => handler(view, from, to, key, insert))) {
				view.dispatch(insert());
			}
			return true;
		},
		keyup() { this.key = undefined; return false; },
		blur() { this.key = undefined; return false; },
		compositionstart() { this.key = undefined; return false; },
		mousedown() { this.key = undefined; return false; },
	},
});
