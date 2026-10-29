import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { isDiagramHidden, onDiagramHostVisibilityChange } from './diagramVisibility';

type PointerAnchor = { pos: number; top: number; bottom: number; left: number; right: number; expires: number };

/** Settle pending height corrections before mouse hit-testing moves its target. */
export const pointerScrollAnchor = ViewPlugin.fromClass(class {
	private anchor: PointerAnchor | null = null;
	private readonly stopHostVisibility: () => void;
	private readonly cancel = (): void => { this.anchor = null; };
	private readonly keydown = (event: KeyboardEvent): void => {
		// Holding a modifier prepares a mouse gesture; it does not move the caret.
		if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) this.cancel();
	};
	constructor(private readonly view: EditorView) {
		// Retained VS Code panes can be hidden without a browser blur event.
		this.stopHostVisibility = onDiagramHostVisibilityChange(this.cancel);
		view.dom.ownerDocument.addEventListener('visibilitychange', this.cancel);
		view.dom.addEventListener('mousedown', this.press, true);
		view.dom.addEventListener('mousemove', this.hover, true);
		view.dom.addEventListener('mouseup', this.finish, true);
		view.dom.addEventListener('keydown', this.keydown, true);
		for (const type of ['wheel', 'focusout', 'pointercancel', 'touchstart']) view.dom.addEventListener(type, this.cancel, true);
		view.dom.ownerDocument.defaultView?.addEventListener('blur', this.cancel);
	}
	private readonly hover = (event: MouseEvent): void => {
		// A pointer move can precede the press by a frame. Settle that frame too,
		// rather than letting its deferred correction invalidate the next target.
		if (event.buttons === 0) this.press(event);
		else if (event.buttons === 1) this.restoreDrag(event);
	};
	private readonly finish = (event: MouseEvent): void => {
		// MouseSelection can hit-test once more on release. Flush that last frame
		// before it resolves the final selection, then discard the gesture anchor.
		if (event.button === 0) this.restoreDrag(event);
		this.cancel();
	};
	private restoreDrag(event: MouseEvent): void {
		if (isDiagramHidden(this.view.dom.ownerDocument)) { this.cancel(); return; }
		const anchor = this.anchor;
		if (!anchor) return;
		const viewport = this.view.scrollDOM.getBoundingClientRect();
		// Keep a same-row sweep stable, but yield to multi-row and edge scrolling.
		if (event.clientY <= viewport.top + 6 || event.clientY >= viewport.bottom - 6
			|| event.clientX <= viewport.left + 6 || event.clientX >= viewport.right - 6
			|| Date.now() >= anchor.expires || event.clientY < anchor.top - 2 || event.clientY > anchor.bottom + 2
			|| event.clientX < anchor.left || event.clientX > anchor.right) { this.cancel(); return; }
		anchor.expires = Date.now() + 500;
		this.restore(anchor);
	}

	private readonly press = (event: MouseEvent): void => {
		if (isDiagramHidden(this.view.dom.ownerDocument)) { this.cancel(); return; }
		if (event.button !== 0 || event.defaultPrevented) return;
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest('button, input, textarea, select')) { this.cancel(); return; }
		// A background correction may have clamped scrolling since hover, before
		// this event's target was resolved. Recover that same visual row first.
		const previous = this.anchor;
		if (previous && Date.now() < previous.expires && event.clientY >= previous.top - 2 && event.clientY <= previous.bottom + 2
			&& event.clientX >= previous.left && event.clientX <= previous.right) this.restore(previous);
		else this.cancel();
		const nonEditable = target?.closest('[contenteditable="false"]');
		// Native fields, rendered widgets and controls own their own mouse behavior.
		if (!target?.closest('.cm-line') || !this.view.contentDOM.contains(target)
			|| nonEditable && nonEditable !== this.view.contentDOM
			|| target.closest('button, input, textarea, select, [contenteditable="true"]:not(.cm-content), .cm-widgetBuffer')) return;
		const doc = this.view.dom.ownerDocument;
		const range = doc.caretRangeFromPoint?.(event.clientX, event.clientY);
		if (!range || range.startContainer.nodeType !== Node.TEXT_NODE || !this.view.contentDOM.contains(range.startContainer)) return;
		// Anchor an actual character, not an ambiguous caret at a wrapped line end.
		const length = range.startContainer.textContent?.length ?? 0;
		if (!length) return;
		const offset = Math.min(range.startOffset, length - 1);
		range.setStart(range.startContainer, offset);
		range.setEnd(range.startContainer, offset + 1);
		const before = range.getBoundingClientRect();
		if (!before.height || event.clientY < before.top - 2 || event.clientY > before.bottom + 2) return;
		let pos: number;
		try { pos = this.view.posAtDOM(range.startContainer, offset); }
		catch { return; } // A concurrently replaced widget is not a prose anchor.
		const row = target.closest('.cm-line')!.getBoundingClientRect();
		this.anchor = { pos, top: before.top, bottom: before.bottom, left: row.left, right: row.right, expires: Date.now() + 500 };
		// coordsForChar flushes CodeMirror's pending measurement. Near the document
		// end that can shrink the height map, clamp scrollTop, then hit-test the
		// original mouse coordinates against a different line. Preserve the glyph
		// under the pointer before handing the unchanged event to CodeMirror.
		this.restore(this.anchor);
	};
	private restore(anchor: PointerAnchor): void {
		for (let pass = 0; pass < 2; pass++) {
			const after = this.view.coordsForChar(anchor.pos);
			if (!after || Math.abs(after.top - anchor.top) < 1) break;
			this.view.scrollDOM.scrollTop += (after.top - anchor.top) / this.view.scaleY;
		}
	}
	update(update: ViewUpdate): void { if (update.docChanged) this.cancel(); }

	destroy(): void {
		this.stopHostVisibility();
		this.view.dom.ownerDocument.removeEventListener('visibilitychange', this.cancel);
		this.view.dom.removeEventListener('mousedown', this.press, true);
		this.view.dom.removeEventListener('mousemove', this.hover, true);
		this.view.dom.removeEventListener('mouseup', this.finish, true);
		this.view.dom.removeEventListener('keydown', this.keydown, true);
		for (const type of ['wheel', 'focusout', 'pointercancel', 'touchstart']) this.view.dom.removeEventListener(type, this.cancel, true);
		this.view.dom.ownerDocument.defaultView?.removeEventListener('blur', this.cancel);
	}
});
