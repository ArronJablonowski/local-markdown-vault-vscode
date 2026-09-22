import { Decoration, EditorView, ViewPlugin, highlightWhitespace, type DecorationSet, type ViewUpdate } from '@codemirror/view';

function lineBreaks(view: EditorView): DecorationSet {
	const starts = new Set<number>();
	for (const range of view.visibleRanges) {
		let line = view.state.doc.lineAt(range.from);
		while (line.from <= range.to && line.to < view.state.doc.length) {
			starts.add(line.from);
			line = view.state.doc.line(line.number + 1);
		}
	}
	return Decoration.set([...starts].sort((a, b) => a - b).map(from =>
		Decoration.line({ class: 'mlp-has-line-break' }).range(from)));
}

/** Marks actual line breaks, not wrapped visual lines or the end of the file. */
export const whitespaceMarkers = [
	highlightWhitespace(),
	EditorView.editorAttributes.of({ class: 'mlp-show-whitespace' }),
	ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		constructor(view: EditorView) { this.decorations = lineBreaks(view); }
		update(update: ViewUpdate): void {
			if (update.docChanged || update.viewportChanged) this.decorations = lineBreaks(update.view);
		}
	}, { decorations: plugin => plugin.decorations }),
];
