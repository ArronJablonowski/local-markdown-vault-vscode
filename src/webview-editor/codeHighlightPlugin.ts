import { StateEffect, StateField, Range } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type { CodeBlockTokens } from '../shared/messages';

export const setCodeTokens = StateEffect.define<CodeBlockTokens[]>();

export const codeTokensField = StateField.define<CodeBlockTokens[]>({
	create() {
		return [];
	},
	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setCodeTokens)) {
				return effect.value;
			}
		}
		if (!tr.docChanged) {
			return value;
		}
		// An edit invalidates that block's syntax until the host tokenizes it again.
		// Mapping deleted tokens onto replacement text can nest thousands of marks
		// on one character, overflowing CodeMirror's renderer during Select All/type.
		return value
			.map((block): CodeBlockTokens | null => {
				if (tr.changes.touchesRange(block.from, block.to)) return null;
				const from = tr.changes.mapPos(block.from, -1);
				const to = tr.changes.mapPos(block.to, 1);
				// Untouched blocks only shift; their token boundaries remain distinct.
				const tokens = block.tokens.map(token => ({
					from: tr.changes.mapPos(token.from, -1),
					to: tr.changes.mapPos(token.to, 1),
					style: token.style,
				}));
				return { from, to, tokens };
			})
			.filter((b): b is CodeBlockTokens => b !== null);
	},
});

function buildDecorations(view: EditorView): DecorationSet {
	const blocks = view.state.field(codeTokensField);
	const decorations: Range<Decoration>[] = [];
	const visible = (from: number, to: number): boolean => view.visibleRanges.some(range => from < range.to && to > range.from);
	for (const block of blocks) {
		if (!visible(block.from, block.to)) continue;
		for (const token of block.tokens) {
			if (token.to <= token.from || !visible(token.from, token.to)) continue;
			// Folded/replaced content splits visibleRanges. Emit a token once, not
			// once per visible fragment of its surrounding code block.
			decorations.push(Decoration.mark({ attributes: { style: token.style } }).range(token.from, token.to));
		}
	}
	return Decoration.set(decorations, true);
}

export const codeHighlightPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = buildDecorations(view);
		}

		update(update: ViewUpdate) {
			const tokensChanged = update.transactions.some((tr) => tr.effects.some((e) => e.is(setCodeTokens)));
			if (update.docChanged || update.viewportChanged || tokensChanged) {
				this.decorations = buildDecorations(update.view);
			}
		}
	},
	{ decorations: (v) => v.decorations },
);

export const codeHighlightExtension = [codeTokensField, codeHighlightPlugin];
