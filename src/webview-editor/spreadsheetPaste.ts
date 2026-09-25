import { Annotation, type EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { detectFrontmatter } from './frontmatterWidget';
import { renderTableMarkdown } from './tableEdit';
import { parseSpreadsheetClipboard, pasteSpreadsheetCells, MAX_SPREADSHEET_OUTPUT_BYTES } from './spreadsheetClipboard';
import { isEditorDocumentWithinLimit } from '../shared/messageValidation';
import { t } from '../shared/i18n';

/** Keep a spreadsheet paste separate from neighboring typing in host undo. */
export const isolatedSpreadsheetPaste = Annotation.define<boolean>();
type PasteWarning = 'malformed' | 'tooLarge' | 'textOnly' | 'stale' | 'busy';

export function showSpreadsheetPasteWarning(reason?: PasteWarning): void {
	let warning = document.getElementById('mlp-spreadsheet-paste-warning');
	if (!warning) {
		warning = document.createElement('div');
		warning.id = 'mlp-spreadsheet-paste-warning';
		warning.setAttribute('role', 'alert');
		document.body.appendChild(warning);
	}
	warning.hidden = !reason;
	warning.textContent = reason ? t(`spreadsheetPaste.${reason}`) : '';
}

/** Never read, parse, or insert clipboard HTML (Excel also supplies text). */
export function readSpreadsheetClipboard(data: DataTransfer) {
	const type = data.types.includes('text/tab-separated-values') ? 'text/tab-separated-values'
		: data.types.includes('text/csv') ? 'text/csv' : 'text/plain';
	const hasText = data.types.includes(type);
	const text = hasText ? data.getData(type) : '';
	return { hasText, text, result: hasText
		? parseSpreadsheetClipboard(text, type === 'text/csv' ? 'csv' : type === 'text/tab-separated-values' ? 'tsv' : 'auto')
		: { kind: 'text' as const } };
}

/** Verify the entire replacement, including existing cells, before mutating. */
export function spreadsheetReplacementFits(state: EditorState, from: number, to: number, insert: string): boolean {
	return new TextEncoder().encode(insert).byteLength <= MAX_SPREADSHEET_OUTPUT_BYTES
		&& isEditorDocumentWithinLimit(state.sliceDoc(0, from) + insert + state.sliceDoc(to));
}

function inSourceObject(state: EditorState, position: number): boolean {
	const frontmatter = detectFrontmatter(state);
	if (frontmatter && position <= frontmatter.to) return true;
	for (let node = syntaxTree(state).resolveInner(position, -1); node; node = node.parent!) {
		if (['FencedCode', 'CodeBlock', 'InlineCode', 'Table', 'HTMLBlock'].includes(node.name)) return true;
	}
	return false;
}

/** Convert an unambiguous clipboard grid in the document body, not inside code. */
export function createSpreadsheetPasteHandler() {
	return EditorView.domEventHandlers({
		paste(event, view) {
			const target = event.target instanceof Element ? event.target : null;
			// Table widgets have their own cell-aware handler. Other widget inputs
			// and search fields must retain their ordinary text-paste behavior.
			if (!target || target.closest('.mlp-table-wrap, input, textarea')
				|| target.closest('[contenteditable]') !== view.contentDOM
				|| !view.state.facet(EditorView.editable) || !event.clipboardData) return false;
			const { state } = view;
			const { from, to } = state.selection.main;
			if (state.selection.ranges.length !== 1 || inSourceObject(state, from) || inSourceObject(state, to)) return false;
			const { result } = readSpreadsheetClipboard(event.clipboardData);
			if (result.kind === 'text') return false;
			event.preventDefault();
			if (result.kind === 'invalid') { showSpreadsheetPasteWarning(result.reason); return true; }
			try {
				const line = state.doc.lineAt(from);
				const prefix = state.sliceDoc(line.from, from);
				const indent = /^[ \t>]*$/.test(prefix) ? prefix : (/^[ \t]*(?:>[ \t]*)+/.exec(line.text)?.[0] ?? '');
				const start = prefix === indent ? line.from : from;
				const model = pasteSpreadsheetCells({ rows: [], headerRowCount: 1, align: [], indent }, result.rows, 0, 0);
				const before = state.sliceDoc(0, start), after = state.sliceDoc(to);
				const blank = indent.trimEnd();
				const lead = !before || before.endsWith('\n\n') ? ''
					: before.endsWith('\n') ? `${blank}\n` : `\n${blank}\n`;
				// Reuse existing separating newlines; at EOF provide an empty line
				// outside the table so the user can immediately keep taking notes.
				const tail = !indent && after.startsWith('\n\n') ? ''
					: !indent && after.startsWith('\n') ? '\n' : `\n${blank}\n${indent}`;
				const insert = lead + renderTableMarkdown(model) + tail;
				if (!spreadsheetReplacementFits(state, start, to, insert)) throw new RangeError();
				showSpreadsheetPasteWarning();
				view.dispatch({ changes: { from: start, to, insert },
					selection: { anchor: start + insert.length + (tail ? 0 : Math.min(2, after.length)) },
					annotations: isolatedSpreadsheetPaste.of(true), userEvent: 'input.paste', scrollIntoView: true });
				return true;
			} catch {
				showSpreadsheetPasteWarning('tooLarge');
				return true;
			}
		},
	});
}
