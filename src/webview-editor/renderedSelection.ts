import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { protectRenderedBlockFromCaret } from './cmUtils';

/** Native selections in non-editable widgets are not CodeMirror source ranges. */
export const renderedSelection = ViewPlugin.fromClass(class {
	private anchor: { node: Node; offset: number } | undefined;
	private sourceAnchor: number | undefined;
	private crossed = false;
	constructor(private view: EditorView) {
		view.dom.addEventListener('mousedown', this.start, true);
		view.dom.addEventListener('copy', this.copy, true);
		document.addEventListener('mousemove', this.move);
		document.addEventListener('mouseup', this.end);
		window.addEventListener('blur', this.end);
	}
	private start = (event: MouseEvent): void => {
		this.anchor = undefined;
		this.sourceAnchor = undefined;
		this.crossed = false;
		const target = event.target instanceof Element ? event.target : null;
		if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey ||
			!target?.closest('.mlp-block') || target.closest('button, input, textarea, [contenteditable="true"]:not(.cm-content)')) return;
		const range = document.caretRangeFromPoint(event.clientX, event.clientY);
		if (range && this.view.contentDOM.contains(range.startContainer)) {
			this.anchor = { node: range.startContainer, offset: range.startOffset };
			const cell = target.closest<HTMLElement>('[data-mlp-from]');
			this.sourceAnchor = cell ? Number(cell.dataset.mlpFrom) : this.view.posAtDOM(range.startContainer, range.startOffset);
			if (cell && cell.textContent === cell.dataset.mlpSrc) {
				const prefix = document.createRange();
				prefix.selectNodeContents(cell);
				prefix.setEnd(range.startContainer, range.startOffset);
				this.sourceAnchor += prefix.toString().length;
			}
		}
	};
	private move = (event: MouseEvent): void => {
		if (!this.anchor || !(event.buttons & 1)) return;
		const range = document.caretRangeFromPoint(event.clientX, event.clientY);
		if (!range || (!this.crossed && !this.anchor.node.isConnected) || !this.view.contentDOM.contains(range.startContainer)) return;
		const element = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
		const startElement = this.anchor.node instanceof Element ? this.anchor.node : this.anchor.node.parentElement;
		if (this.crossed || element?.closest('.mlp-block') !== startElement?.closest('.mlp-block')) {
			const head = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
			if (head !== null && this.sourceAnchor !== undefined) {
				this.crossed = true;
				protectRenderedBlockFromCaret();
				event.preventDefault();
				this.view.focus();
				this.view.dispatch({ selection: { anchor: this.sourceAnchor, head } });
				return;
			}
		}
		// Within a widget, leave native partial-text selection untouched. Once a
		// drag crosses into the document, use a source range so CodeMirror can
		// highlight/copy content outside its current virtualized DOM viewport.
	};
	private end = (): void => { this.anchor = undefined; };
	update(update: ViewUpdate): void {
		if (update.docChanged) {
			this.end();
			this.crossed = false;
		}
	}
	private copy = (event: ClipboardEvent): void => {
		if (this.crossed && !this.view.state.selection.main.empty) return;
		const selection = window.getSelection();
		if (event.defaultPrevented || !event.clipboardData || !selection || selection.isCollapsed ||
			!selection.anchorNode || !selection.focusNode ||
			!this.view.contentDOM.contains(selection.anchorNode) || !this.view.contentDOM.contains(selection.focusNode)) return;
		const inWidget = (node: Node): boolean => !!(node instanceof Element ? node : node.parentElement)?.closest('.mlp-block');
		if (!inWidget(selection.anchorNode) && !inWidget(selection.focusNode)) return;
		event.clipboardData.setData('text/plain', selection.toString());
		event.preventDefault();
	};
	destroy(): void {
		this.view.dom.removeEventListener('mousedown', this.start, true);
		this.view.dom.removeEventListener('copy', this.copy, true);
		document.removeEventListener('mousemove', this.move);
		document.removeEventListener('mouseup', this.end);
		window.removeEventListener('blur', this.end);
	}
});
