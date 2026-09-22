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
		view.dom.addEventListener('cut', this.cut, true);
		view.dom.addEventListener('keydown', this.deleteKey, true);
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
	private nativeWidgetSelection(): Selection | undefined {
		if (this.crossed && !this.view.state.selection.main.empty) return;
		const selected = window.getSelection();
		if (!selected || selected.isCollapsed || !selected.anchorNode || !selected.focusNode ||
			!this.view.contentDOM.contains(selected.anchorNode) || !this.view.contentDOM.contains(selected.focusNode)) return;
		const element = selected.anchorNode instanceof Element ? selected.anchorNode : selected.anchorNode.parentElement;
		// In-place cell editors own their native cut/delete behavior. Complete
		// table selections have their own structural deletion handler.
		if (!element?.closest('.mlp-block') ||
			element.closest('[contenteditable="true"]:not(.cm-content), .mlp-table-block-selected')) return;
		return selected;
	}
	private removeNativeSelection(selected: Selection): void {
		if (!this.view.state.facet(EditorView.editable)) return;
		const range = selected.getRangeAt(0);
		const changes: Array<{ from: number; to: number; insert: string }> = [];
		for (const cell of Array.from(this.view.contentDOM.querySelectorAll<HTMLElement>('.mlp-table-cell[data-mlp-from]'))) {
			if (!range.intersectsNode(cell)) continue;
			const content = document.createRange();
			content.selectNodeContents(cell);
			const intersection = content.cloneRange();
			if (range.compareBoundaryPoints(Range.START_TO_START, content) > 0) intersection.setStart(range.startContainer, range.startOffset);
			if (range.compareBoundaryPoints(Range.END_TO_END, content) < 0) intersection.setEnd(range.endContainer, range.endOffset);
			if (!intersection.toString()) continue;
			const from = Number(cell.dataset.mlpFrom), to = Number(cell.dataset.mlpTo);
			const raw = cell.dataset.mlpSrc;
			if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to > this.view.state.doc.length ||
				from > to || raw === undefined || this.view.state.sliceDoc(from, to) !== raw) return;
			const prefix = content.cloneRange();
			prefix.setEnd(intersection.startContainer, intersection.startOffset);
			const offset = prefix.toString().length;
			if (cell.textContent === raw) changes.push({ from: from + offset, to: from + offset + intersection.toString().length, insert: '' });
			else if (offset === 0 && intersection.toString() === cell.textContent) changes.push({ from, to, insert: '' });
			// Never guess source offsets through partially selected rich markup.
			// The user can enter the cell editor to cut its Markdown precisely.
			else return;
		}
		if (!changes.length) return;
		protectRenderedBlockFromCaret();
		this.view.dispatch({ changes, selection: { anchor: changes[0].from }, userEvent: 'delete.selection' });
		this.view.focus();
	}
	private cut = (event: ClipboardEvent): void => {
		if (event.defaultPrevented || !event.clipboardData) return;
		const selected = this.nativeWidgetSelection();
		if (!selected) return;
		event.clipboardData.setData('text/plain', selected.toString());
		event.preventDefault();
		this.removeNativeSelection(selected);
	};
	private deleteKey = (event: KeyboardEvent): void => {
		if (event.defaultPrevented || !['Backspace', 'Delete'].includes(event.key)) return;
		const selected = this.nativeWidgetSelection();
		if (!selected) return;
		event.preventDefault();
		this.removeNativeSelection(selected);
	};
	destroy(): void {
		this.view.dom.removeEventListener('mousedown', this.start, true);
		this.view.dom.removeEventListener('copy', this.copy, true);
		this.view.dom.removeEventListener('cut', this.cut, true);
		this.view.dom.removeEventListener('keydown', this.deleteKey, true);
		document.removeEventListener('mousemove', this.move);
		document.removeEventListener('mouseup', this.end);
		window.removeEventListener('blur', this.end);
	}
});
