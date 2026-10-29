import { EditorView, WidgetType } from '@codemirror/view';
import { renderSafeHtml } from './safeHtml';
import { wrapBlockWidget } from './blockWidgetWrap';
import { withCodeModeButton } from './codeModeButton';

/** HTML is a selectable preview; the shared source button opens its Markdown. */
export class HtmlWidget extends WidgetType {
	constructor(private readonly source: string) { super(); }
	// Reuse the mounted disclosure state when unrelated edits move the block.
	eq(other: HtmlWidget): boolean { return this.source === other.source; }
	toDOM(view: EditorView): HTMLElement {
		const content = document.createElement('div');
		content.className = 'mlp-safe-html';
		renderSafeHtml(content, this.source);
		// Resolve the current DOM position on click; an absolute offset goes stale.
		const wrap = wrapBlockWidget(withCodeModeButton(view, content, { anchor: content }));
		// Expanding details changes the height without changing editor state.
		content.addEventListener('toggle', () => view.requestMeasure(), true);
		return wrap;
	}
	ignoreEvent(): boolean { return true; }
}
