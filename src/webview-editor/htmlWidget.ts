import { EditorView, WidgetType } from '@codemirror/view';
import { renderSafeHtml } from './safeHtml';
import { wrapBlockWidget } from './blockWidgetWrap';
import { withCodeModeButton } from './codeModeButton';
import { htmlDisclosureState, rememberHtmlDisclosures } from './htmlDisclosureState';

const disclosureObservers = new WeakMap<HTMLElement, MutationObserver>();

/** HTML is a selectable preview; the shared source button opens its Markdown. */
export class HtmlWidget extends WidgetType {
	constructor(private readonly source: string, private readonly initialFrom: number) { super(); }
	// Reuse the mounted disclosure state when unrelated edits move the block.
	eq(other: HtmlWidget): boolean { return this.source === other.source; }
	toDOM(view: EditorView): HTMLElement {
		const content = document.createElement('div');
		content.className = 'mlp-safe-html';
		renderSafeHtml(content, this.source);
		const saved = view.state.field(htmlDisclosureState, false)?.get(this.initialFrom);
		if (saved?.source === this.source) {
			const open = new Set(saved.open);
			content.querySelectorAll('details').forEach((details, index) => { details.open = open.has(index); });
		}
		// Resolve the current DOM position on click; an absolute offset goes stale.
		const wrap = wrapBlockWidget(withCodeModeButton(view, content, { anchor: content }));
		// Expanding details changes the height without changing editor state.
		const remember = () => {
			if (!view.dom.contains(content)) return;
			const from = view.posAtDOM(content);
			const open = Array.from(content.querySelectorAll('details')).flatMap((details, index) => details.open ? [index] : []);
			const previous = view.state.field(htmlDisclosureState, false)?.get(from)?.open ?? [];
			if (previous.length !== open.length || previous.some((index, i) => index !== open[i])) {
				view.dispatch({ effects: rememberHtmlDisclosures.of({ from, source: this.source, open }) });
			}
			view.requestMeasure();
		};
		content.addEventListener('toggle', remember, true);
		// Observe the native open mutation before its deferred toggle event. This
		// also preserves default-summary activation without replacing browser behavior.
		const observer = new MutationObserver(remember);
		observer.observe(content, { subtree: true, attributes: true, attributeFilter: ['open'] });
		disclosureObservers.set(wrap, observer);
		return wrap;
	}
	destroy(dom: HTMLElement): void {
		disclosureObservers.get(dom)?.disconnect();
		disclosureObservers.delete(dom);
	}
	ignoreEvent(): boolean { return true; }
}
