import { describe, expect, it } from 'vitest';
import { Annotation, EditorSelection, EditorState, StateEffect, Transaction } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from './gfmTableFix';
import { blockDecorationsField } from './blockDecorations';
import { calloutState } from './calloutState';
import { createBlockReplacementSelectionGuard } from './blockReplacementSelection';

const remote = Annotation.define<boolean>();
const retained = Annotation.define<string>();
const retainedEffect = StateEffect.define<string>();
const table = '| Name | Count |\n| --- | --- |\n| Apple | 3 |\n\n';

function state(doc = table, anchor = 0, head = doc.length) {
	return EditorState.create({ doc, selection: { anchor, head }, extensions: [
		markdown({ extensions: GFM }), calloutState, blockDecorationsField,
		EditorState.allowMultipleSelections.of(true), createBlockReplacementSelectionGuard(remote),
	] });
}

describe('typed block replacement selection guard', () => {
	for (const backwards of [false, true]) it(`collapses only the accidentally selected typed replacement, backwards=${backwards}`, () => {
		const editor = state(table, backwards ? table.length : 0, backwards ? 0 : table.length);
		const transaction = editor.update({ changes: { from: 0, to: table.length, insert: 'E' },
			selection: { anchor: 0, head: 1 }, userEvent: 'input.type', scrollIntoView: true,
			annotations: [retained.of('keep'), Transaction.addToHistory.of(false)], effects: retainedEffect.of('effect') });
		expect(transaction.newDoc.toString()).toBe('E');
		expect(transaction.newSelection.main.empty).toBe(true);
		expect(transaction.newSelection.main.head).toBe(1);
		expect(transaction.annotation(Transaction.userEvent)).toBe('input.type');
		expect(transaction.annotation(Transaction.addToHistory)).toBe(false);
		expect(transaction.annotation(retained)).toBe('keep');
		expect(transaction.effects[0].value).toBe('effect');
		expect(transaction.scrollIntoView).toBe(true);
	});

	for (const userEvent of ['input.type.compose', 'input.type.compose.start', 'input.paste', 'input.complete', 'undo', 'redo']) {
		it(`leaves ${userEvent} selections unchanged`, () => {
			const transaction = state().update({ changes: { from: 0, to: table.length, insert: 'E' },
				selection: { anchor: 0, head: 1 }, userEvent });
			expect(transaction.newSelection.main.empty).toBe(false);
		});
	}

	it('leaves a remote update and its annotation unchanged', () => {
		const transaction = state().update({ changes: { from: 0, to: table.length, insert: 'E' },
			selection: { anchor: 0, head: 1 }, userEvent: 'input.type', annotations: remote.of(true) });
		expect(transaction.newSelection.main.empty).toBe(false);
		expect(transaction.annotation(remote)).toBe(true);
	});

	it('does not change selected ordinary prose or a revealed table source', () => {
		for (const editor of [state('Plain selected text'), EditorState.create({ doc: table,
			selection: { anchor: 0, head: table.length }, extensions: [createBlockReplacementSelectionGuard(remote)] })]) {
			const transaction = editor.update({ changes: { from: 0, to: editor.doc.length, insert: 'E' },
				selection: { anchor: 0, head: 1 }, userEvent: 'input.type' });
			expect(transaction.newSelection.main.empty).toBe(false);
		}
	});

	it('leaves intentional formatting selection inside a wrapped replacement', () => {
		const transaction = state().update({ changes: { from: 0, to: table.length, insert: '`' + table + '`' },
			selection: { anchor: 1, head: table.length + 1 }, userEvent: 'input.type' });
		expect(transaction.newSelection.main.anchor).toBe(1);
		expect(transaction.newSelection.main.head).toBe(table.length + 1);
	});

	it('leaves multicaret edits and partial replacements unchanged', () => {
		const editor = state(table + 'tail').update({ selection: EditorSelection.create([
			EditorSelection.range(0, table.length), EditorSelection.cursor(table.length + 4),
		]) }).state;
		const multi = editor.update({ changes: { from: 0, to: table.length, insert: 'E' },
			selection: { anchor: 0, head: 1 }, userEvent: 'input.type' });
		expect(multi.newSelection.main.empty).toBe(false);
		const partial = state().update({ changes: { from: 0, to: 3, insert: 'E' },
			selection: { anchor: 0, head: 1 }, userEvent: 'input.type' });
		expect(partial.newSelection.main.empty).toBe(false);
	});
});
