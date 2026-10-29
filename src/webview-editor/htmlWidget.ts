import { EditorView, WidgetType } from '@codemirror/view';
import { renderSafeHtml } from './safeHtml';
import { wrapBlockWidget } from './blockWidgetWrap';

/** HTML is a preview, not a second editable document; double-click reveals source. */
export class HtmlWidget extends WidgetType {
	constructor(private readonly source: string, private readonly from: number) { super(); }
	eq(other: HtmlWidget): boolean { return this.source === other.source && this.from === other.from; }
	toDOM(view: EditorView): HTMLElement {
		const content = document.createElement('div');
		content.className = 'mlp-safe-html';
		renderSafeHtml(content, this.source);
		const wrap = wrapBlockWidget(content);
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = '</>';
		button.setAttribute('aria-label', 'Edit HTML source');
		const reveal = () => { view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true }); view.focus(); };
		button.addEventListener('click', reveal);
		wrap.prepend(button);
		content.addEventListener('dblclick', reveal);
		return wrap;
	}
	ignoreEvent(): boolean { return true; }
}
