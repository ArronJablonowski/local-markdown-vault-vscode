import { afterEach, describe, expect, it, vi } from 'vitest';
import { Annotation, EditorState, StateEffect, Transaction, type Extension, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { history, undo } from '@codemirror/commands';
import { GFM } from './gfmTableFix';
import { escapeInlineHighlight, exitInlineHighlightOnEnter } from './inlineHighlightEditing';
import { exitEmptyMarkdownSection } from './sectionEditing';

vi.mock('@codemirror/language', async importOriginal => ({
	...await importOriginal<typeof import('@codemirror/language')>(),
	ensureSyntaxTree: vi.fn((...args: Parameters<typeof ensureSyntaxTree>) => importActualEnsure(...args)),
}));
const { ensureSyntaxTree: importActualEnsure } = await vi.importActual<typeof import('@codemirror/language')>('@codemirror/language');
afterEach(() => vi.clearAllMocks());

function editor(doc: string, anchor: number, extra: Extension[] = []) {
	let state = EditorState.create({ doc, selection: { anchor }, extensions: [markdown({ extensions: GFM }), ...extra] });
	return {
		get state() { return state; },
		dispatch(transaction: Transaction | TransactionSpec) {
			state = transaction instanceof Transaction ? transaction.state : state.update(transaction).state;
		},
	} as EditorView;
}

describe('Enter after inline highlighting', () => {
	for (const [prefix, continuation] of [
		['', ''], ['- ', '- '], ['- [x] ', '- [ ] '], ['  - [ ] ', '  - [ ] '],
		['1. ', '2. '], ['> ', '> '], ['> - [ ] ', '> - [ ] '], ['> > ', '> > '],
	]) for (const inside of [false, true]) it(`retains ${JSON.stringify(prefix)} markup with caret ${inside ? 'inside' : 'after'} the closing marker`, () => {
		const doc = '# Meeting\n\n' + prefix + 'Confirm ==launch scope==';
		const view = editor(doc, doc.length - (inside ? 2 : 0));
		expect(exitInlineHighlightOnEnter(view)).toBe(true);
		expect(view.state.doc.toString()).toBe(doc + '\n' + continuation);
		expect(view.state.selection.main.head).toBe(view.state.doc.length);
		if (continuation) {
			expect(exitInlineHighlightOnEnter(view)).toBe(false);
			expect(exitEmptyMarkdownSection(view)).toBe(true);
			expect(view.state.doc.toString()).toBe(doc + '\n\n');
		}
	});

	it('does not treat code or an interior highlight caret as its exit boundary', () => {
		for (const [doc, anchor] of [['`==literal==`', 10], ['```text\n==literal==\n```', 16], ['- ==highlight==', 6]] as const) {
			const view = editor(doc, anchor);
			expect(exitInlineHighlightOnEnter(view)).toBe(false);
			expect(view.state.doc.toString()).toBe(doc);
		}
	});

	it('does not reinterpret a distant fenced-code caret before parsing catches up', () => {
		const doc = 'Earlier paragraph with **text** and notes.\n\n'.repeat(10000) + '```text\n==literal==\n```';
		const anchor = doc.length - 6;
		const view = editor(doc, anchor);
		expect(syntaxTree(view.state).length).toBeLessThan(anchor);
		expect(exitInlineHighlightOnEnter(view)).toBe(false);
		expect(view.state.doc.toString()).toBe(doc);
		expect(view.state.selection.main.head).toBe(anchor);
	});

	it('leaves a candidate to normal editing when the bounded parse cannot resolve context', () => {
		const doc = '- ==scope==';
		const view = editor(doc, doc.length - 2);
		vi.mocked(ensureSyntaxTree).mockReturnValueOnce(null);
		expect(exitInlineHighlightOnEnter(view)).toBe(false);
		expect(ensureSyntaxTree).toHaveBeenCalledWith(view.state, doc.length - 2, 20);
		expect(view.state.doc.toString()).toBe(doc);
		expect(view.state.selection.main.head).toBe(doc.length - 2);
	});

	it('leaves readonly highlighted text and its caret unchanged', () => {
		const doc = '- ==scope==';
		const view = editor(doc, doc.length - 2, [EditorState.readOnly.of(true)]);
		expect(exitInlineHighlightOnEnter(view)).toBe(false);
		expect(escapeInlineHighlight(view)).toBe(false);
		expect(view.state.doc.toString()).toBe(doc);
		expect(view.state.selection.main.head).toBe(doc.length - 2);
	});

	it('local CodeMirror history restores the original caret instead of an intermediate virtual caret', () => {
		const doc = '- ==scope==';
		const view = editor(doc, doc.length - 2, [history()]);
		expect(exitInlineHighlightOnEnter(view)).toBe(true);
		expect(view.state.doc.toString()).toBe(doc + '\n- ');
		expect(undo(view)).toBe(true);
		expect(view.state.doc.toString()).toBe(doc);
		expect(view.state.selection.main.head).toBe(doc.length - 2);
	});

	it('an edit-rejecting transaction filter preserves the original document and caret', () => {
		const doc = '> - [ ] ==scope==';
		const view = editor(doc, doc.length - 2, [EditorState.transactionFilter.of(transaction => transaction.docChanged ? [] : transaction)]);
		const dispatch = vi.spyOn(view, 'dispatch');
		expect(exitInlineHighlightOnEnter(view)).toBe(true);
		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(view.state.doc.toString()).toBe(doc);
		expect(view.state.selection.main.head).toBe(doc.length - 2);
	});

	it('the single accepted transaction retains filter annotations and effects against the original state', () => {
		const retained = Annotation.define<string>();
		const retainedEffect = StateEffect.define<string>();
		const doc = '- ==scope==';
		const view = editor(doc, doc.length - 2, [history(), EditorState.transactionFilter.of(transaction => {
			if (!transaction.docChanged || transaction.annotation(retained)) return transaction;
			return [transaction, { annotations: [retained.of('keep'), Transaction.addToHistory.of(false)], effects: retainedEffect.of('once') }];
		})]);
		const originalState = view.state;
		const dispatch = vi.spyOn(view, 'dispatch');
		expect(exitInlineHighlightOnEnter(view)).toBe(true);
		expect(dispatch).toHaveBeenCalledTimes(1);
		const accepted = dispatch.mock.calls[0][0] as Transaction;
		expect(accepted.startState).toBe(originalState);
		expect(accepted.annotation(retained)).toBe('keep');
		expect(accepted.annotation(Transaction.userEvent)).toBe('input');
		expect(accepted.annotation(Transaction.addToHistory)).toBe(false);
		expect(accepted.effects.filter(effect => effect.is(retainedEffect)).map(effect => effect.value)).toEqual(['once']);
		expect(accepted.scrollIntoView).toBe(true);
		expect(view.state.doc.toString()).toBe(doc + '\n- ');
		expect(undo(view)).toBe(false);
	});
});
