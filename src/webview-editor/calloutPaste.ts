import { ensureSyntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { calloutForNode } from './calloutState';
import { softLineBreakPrefix } from './softLineBreak';
import { readClipboardText } from './clipboardText';
import { isEditorDocumentWithinLimit, MAX_EDITOR_DOCUMENT_BYTES } from '../shared/messageValidation';

/** Bound quote expansion before allocating its result or any per-line arrays. */
export function quoteCalloutPaste(text: string, prefix: string, reuseFinalPrefix = false): string | undefined {
	if (!isEditorDocumentWithinLimit(text)) return undefined;
	const normalized = text.replace(/\r\n?/g, '\n');
	let breaks = 0;
	for (let index = 0; index < normalized.length; index++) if (normalized.charCodeAt(index) === 10) breaks++;
	const reuse = reuseFinalPrefix && normalized.endsWith('\n');
	if (new TextEncoder().encode(normalized).byteLength + (breaks - Number(reuse)) * new TextEncoder().encode(prefix).byteLength > MAX_EDITOR_DOCUMENT_BYTES) return undefined;
	const insert = normalized.replaceAll('\n', '\n' + prefix);
	return reuse && prefix.length ? insert.slice(0, -prefix.length) : insert;
}

/** Keep paragraph separators inside the selected callout, not outside its quote. */
export function createCalloutPasteHandler(tooLarge: () => void, parsing: () => void) {
	return EditorView.domEventHandlers({ paste(event, view) {
		const target = event.target instanceof Element ? event.target : null;
		const { state } = view;
		if (!target || target.closest('input, textarea, .mlp-table-wrap') || target.closest('[contenteditable]') !== view.contentDOM ||
			!state.facet(EditorView.editable) || state.readOnly || state.selection.ranges.length !== 1) return false;
		const { text } = readClipboardText(event.clipboardData, 'plain');
		if (!isEditorDocumentWithinLimit(text)) { event.preventDefault(); tooLarge(); return true; }
		if (!/[\r\n]/.test(text)) return false;
		const { from, to } = state.selection.main;
		const tree = ensureSyntaxTree(state, to, 50);
		if (!tree) {
			// Never silently break an explicit quote while its callout/code context
			// is unknown. The clipboard remains available for a later retry.
			if (/^[ \t]*>/.test(state.doc.lineAt(from).text)) { event.preventDefault(); parsing(); return true; }
			return false;
		}
		const context = (position: number, side: -1 | 1) => {
			let literalLine: string | undefined;
			for (let node = tree.resolveInner(position, side); node; node = node.parent!) {
				if (node.name === 'Table') return undefined;
				if (['FencedCode', 'CodeBlock', 'InlineCode'].includes(node.name)) literalLine = state.doc.lineAt(node.from).text;
				const callout = calloutForNode(state, node);
				if (callout) return { ...callout, literalLine };
			}
			return undefined;
		};
		const callout = context(from, 1), end = context(to, -1);
		if (!callout || !end || callout.from !== end.from) return false;
		const line = state.doc.lineAt(from);
		const quote = /^[ \t]*(?:>[ \t]*)+/.exec(line.text)?.[0];
		// Whole-source replacements must keep their authored Markdown unchanged.
		if (quote && from < line.from + quote.length) return false;
		const prefix = softLineBreakPrefix(callout.literalLine ?? (quote ? line.text : state.doc.lineAt(callout.from).text));
		const endLine = state.doc.lineAt(to);
		// Count before expanding: millions of tiny lines must not allocate an
		// attacker-sized array or a quote-expanded string beyond the document cap.
		const reuseFinalPrefix = to === endLine.from && endLine.text.startsWith(prefix);
		event.preventDefault();
		const insert = quoteCalloutPaste(text, prefix, reuseFinalPrefix);
		if (insert === undefined) { tooLarge(); return true; }
		if (!isEditorDocumentWithinLimit(state.sliceDoc(0, from) + insert + state.sliceDoc(to))) { tooLarge(); return true; }
		view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: 'input.paste', scrollIntoView: true });
		return true;
	} });
}
