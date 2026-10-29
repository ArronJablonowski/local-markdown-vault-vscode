import { EditorView, WidgetType } from '@codemirror/view';
import { renderSafeHtml } from './safeHtml';
import { wrapBlockWidget } from './blockWidgetWrap';
import { withCodeModeButton } from './codeModeButton';

/** HTML is a selectable preview; the shared source button opens its Markdown. */
export class HtmlWidget extends WidgetType {
	constructor(private readonly source: string, private readonly from: number) { super(); }
	eq(other: HtmlWidget): boolean { return this.source === other.source && this.from === other.from; }
	toDOM(view: EditorView): HTMLElement {
		const content = document.createElement('div');
		content.className = 'mlp-safe-html';
		renderSafeHtml(content, this.source);
		const wrap = wrapBlockWidget(withCodeModeButton(view, content, { anchor: content, caretPos: () => this.from }));
		// Expanding details changes the height without changing editor state.
		content.addEventListener('toggle', () => view.requestMeasure(), true);
		return wrap;
	}
	ignoreEvent(): boolean { return true; }
}
