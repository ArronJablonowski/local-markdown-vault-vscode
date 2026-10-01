import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { pointerSelectionInProgress } from './cmUtils';
import { isDiagramHidden, onDiagramHostVisibilityChange } from './diagramVisibility';

const NAVIGATION_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

/** Keep a deliberate keyboard destination visible while preview heights settle. */
export const navigationScrollGuard = ViewPlugin.fromClass(class {
	private deadline = 0;
	private remaining = 0;
	private pending = false;
	private destroyed = false;
	private readonly ownerWindow: Window | null;
	private readonly stopVisibilityListener: () => void;
	private readonly cancel = (): void => { this.deadline = 0; this.remaining = 0; };
	private readonly keydown = (event: KeyboardEvent): void => {
		// Embedded table/property fields and toolbar controls own their own keys.
		if (event.isComposing || !NAVIGATION_KEYS.has(event.key)
			|| this.view.root.activeElement !== this.view.contentDOM) { this.cancel(); return; }
		this.deadline = Date.now() + 1000;
		this.remaining = 8;
		this.schedule();
	};

	constructor(private readonly view: EditorView) {
		this.ownerWindow = view.dom.ownerDocument.defaultView;
		// Reuse the host's retained-webview visibility signal; a hidden iframe may
		// still report its old content as focused.
		this.stopVisibilityListener = onDiagramHostVisibilityChange(this.cancel);
		view.dom.ownerDocument.addEventListener('visibilitychange', this.cancel);
		view.dom.addEventListener('keydown', this.keydown, true);
		for (const event of ['pointerdown', 'mousedown', 'pointercancel', 'wheel', 'touchstart', 'focusout']) {
			view.dom.addEventListener(event, this.cancel, true);
		}
		this.ownerWindow?.addEventListener('blur', this.cancel);
	}

	private active(): boolean {
		return !this.destroyed && this.remaining > 0 && Date.now() < this.deadline
			&& this.view.dom.isConnected && this.view.root.activeElement === this.view.contentDOM
			&& !isDiagramHidden(this.view.dom.ownerDocument)
			&& !pointerSelectionInProgress();
	}

	private schedule(): void {
		if (this.pending || !this.active()) return;
		this.pending = true;
		this.view.requestMeasure({
			key: this,
			read: () => null,
			write: () => queueMicrotask(() => {
				this.pending = false;
				if (!this.active()) return;
				// Read after CodeMirror completes both its measurement and scroll-anchor
				// adjustment. Reading earlier can mistake its unfinished frame for a jump.
				const range = this.view.state.selection.main;
				const head = range.head;
				// Match CodeMirror's scroll target: a selection ends on its selected
				// side of a widget boundary, not the neighboring unselected widget.
				const side = range.empty ? range.assoc || 1 : head > range.anchor ? -1 : 1;
				const caret = this.view.coordsAtPos(head, side);
				const viewport = this.view.scrollDOM.getBoundingClientRect();
				if (viewport.width <= 0 || viewport.height <= 0) { this.cancel(); return; }
				if (caret && caret.top >= viewport.top && caret.bottom <= viewport.bottom
					&& caret.left >= viewport.left && caret.right <= viewport.right) return;
				this.remaining--;
				this.view.dispatch({ effects: EditorView.scrollIntoView(EditorSelection.cursor(head, side), { y: 'nearest', x: 'nearest' }) });
				// Flush the requested scroll before the browser paints this frame.
				this.view.coordsAtPos(head, side);
			}),
		});
	}

	update(update: ViewUpdate): void {
		if (update.docChanged || update.focusChanged && !this.view.hasFocus) this.cancel();
		else this.schedule();
	}

	destroy(): void {
		this.destroyed = true;
		this.cancel();
		this.stopVisibilityListener();
		this.view.dom.ownerDocument.removeEventListener('visibilitychange', this.cancel);
		this.view.dom.removeEventListener('keydown', this.keydown, true);
		for (const event of ['pointerdown', 'mousedown', 'pointercancel', 'wheel', 'touchstart', 'focusout']) {
			this.view.dom.removeEventListener(event, this.cancel, true);
		}
		this.ownerWindow?.removeEventListener('blur', this.cancel);
	}
});
