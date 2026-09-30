import type { EditorView } from '@codemirror/view';
import { t } from '../shared/i18n';

const notices = new WeakMap<EditorView, () => void>();

/** Report an uncompleted escape without queuing a later caret jump or discarding input. */
export function setCodeFenceParseWarning(view: EditorView, visible: boolean): void {
	notices.get(view)?.();
	if (!visible || !view.dom?.ownerDocument) return;
	const warning = view.dom.ownerDocument.createElement('div');
	warning.className = 'mlp-code-escape-warning';
	warning.setAttribute('role', 'alert');
	warning.textContent = t('code.escape.parsing');
	view.dom.appendChild(warning);
	const clear = () => {
		warning.remove();
		view.dom.removeEventListener('keydown', clear, true);
		view.dom.removeEventListener('pointerdown', clear, true);
		view.dom.removeEventListener('input', clear, true);
		notices.delete(view);
	};
	notices.set(view, clear);
	// A subsequent user action dismisses this notice only, never other status messages.
	view.dom.addEventListener('keydown', clear, true);
	view.dom.addEventListener('pointerdown', clear, true);
	view.dom.addEventListener('input', clear, true);
}
