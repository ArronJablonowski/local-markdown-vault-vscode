import { syntaxTree } from '@codemirror/language';
import type { EditorState, Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { t } from '../shared/i18n';

const MAX_FOOTNOTES = 1_000;

interface FootnoteDefinition { id: string; from: number; markerTo: number; lineFrom: number }

class FootnoteReferenceWidget extends WidgetType {
	constructor(private readonly id: string, private readonly target: number) { super(); }
	eq(other: FootnoteReferenceWidget): boolean { return this.id === other.id && this.target === other.target; }
	toDOM(view: EditorView): HTMLElement {
		const sup = document.createElement('sup');
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'mlp-footnote-reference';
		button.textContent = this.id;
		button.setAttribute('aria-label', t('footnote.goto', this.id));
		const navigate = () => {
			view.dispatch({ selection: { anchor: this.target }, scrollIntoView: true });
			view.focus();
		};
		button.addEventListener('mousedown', (event) => event.preventDefault());
		button.addEventListener('click', (event) => {
			event.preventDefault();
			navigate();
		});
		button.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			event.stopPropagation();
			navigate();
		});
		sup.appendChild(button);
		return sup;
	}
	ignoreEvent(): boolean { return false; }
}

class FootnoteDefinitionWidget extends WidgetType {
	constructor(private readonly id: string, private readonly target: number | undefined) { super(); }
	eq(other: FootnoteDefinitionWidget): boolean { return this.id === other.id && this.target === other.target; }
	toDOM(view: EditorView): HTMLElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'mlp-footnote-definition-label';
		button.textContent = `${this.id} ↩`;
		button.setAttribute('aria-label', t('footnote.return', this.id));
		button.disabled = this.target === undefined;
		const navigate = () => {
			if (this.target === undefined) return;
			view.dispatch({ selection: { anchor: this.target }, scrollIntoView: true });
			view.focus();
		};
		button.addEventListener('mousedown', (event) => event.preventDefault());
		button.addEventListener('click', (event) => {
			event.preventDefault();
			navigate();
		});
		button.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			event.stopPropagation();
			navigate();
		});
		return button;
	}
	ignoreEvent(): boolean { return false; }
}

function buildFootnoteDecorations(view: EditorView): DecorationSet {
	const state = view.state;
	const text = state.doc.toString();
	const definitions = new Map<string, FootnoteDefinition>();
	for (const match of text.matchAll(/^[ \t]{0,3}\[\^([A-Za-z0-9_-]{1,64})\]:[ \t]*/gm)) {
		if (definitions.size >= MAX_FOOTNOTES) break;
		const from = match.index ?? 0;
		if (isCode(state, from)) continue;
		definitions.set(match[1], { id: match[1], from, markerTo: from + match[0].length, lineFrom: state.doc.lineAt(from).from });
	}
	const references = new Map<string, number[]>();
	for (const match of text.matchAll(/\[\^([A-Za-z0-9_-]{1,64})\]/g)) {
		const from = match.index ?? 0;
		if (definitions.get(match[1])?.from === from || isCode(state, from) || isEscaped(text, from)) continue;
		const list = references.get(match[1]) ?? [];
		if (list.length < 100) list.push(from);
		references.set(match[1], list);
	}
	const decorations: Range<Decoration>[] = [];
	for (const definition of definitions.values()) {
		decorations.push(Decoration.line({ class: 'mlp-line-footnote-definition' }).range(definition.lineFrom));
		decorations.push(Decoration.replace({
			widget: new FootnoteDefinitionWidget(definition.id, references.get(definition.id)?.[0]),
		}).range(definition.from, definition.markerTo));
	}
	for (const [id, positions] of references) {
		const definition = definitions.get(id);
		if (!definition) continue;
		const target = Math.min(definition.markerTo + 1, state.doc.lineAt(definition.from).to);
		for (const from of positions) {
			const to = from + id.length + 3;
			decorations.push(Decoration.replace({ widget: new FootnoteReferenceWidget(id, target) }).range(from, to));
		}
	}
	return Decoration.set(decorations, true);
}

export const footnoteDecorations = ViewPlugin.fromClass(class {
	decorations: DecorationSet;
	constructor(view: EditorView) { this.decorations = buildFootnoteDecorations(view); }
	update(update: ViewUpdate) {
		if (update.docChanged || update.viewportChanged || update.selectionSet) this.decorations = buildFootnoteDecorations(update.view);
	}
}, { decorations: (plugin) => plugin.decorations });

function isCode(state: EditorState, position: number): boolean {
	let node = syntaxTree(state).resolveInner(position, 1);
	while (node) {
		if (node.name === 'InlineCode' || node.name === 'FencedCode' || node.name === 'CodeBlock') return true;
		node = node.parent!;
	}
	return false;
}

function isEscaped(text: string, position: number): boolean {
	let slashes = 0;
	for (let index = position - 1; index >= 0 && text[index] === '\\'; index--) slashes++;
	return slashes % 2 === 1;
}
