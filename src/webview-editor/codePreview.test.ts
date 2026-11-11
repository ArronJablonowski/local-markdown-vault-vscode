import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { codeFolding, foldEffect, unfoldEffect } from '@codemirror/language';
import { codePreviewEnd, existingCodeFold } from './codePreview';

describe('six-line code preview ranges', () => {
	it.each([1, 6, 8, 12])('retains six content lines or all %i available lines', length => {
		const state = EditorState.create({ doc: Array.from({ length }, (_, n) => `line${n + 1}`).join('\n') });
		expect(codePreviewEnd(state, 0, state.doc.length)).toBe(state.doc.line(Math.min(6, length)).to);
	});
	it('finds and expands the actual range after a visible line is inserted', () => {
		let state = EditorState.create({ doc: Array.from({ length: 12 }, (_, n) => `line${n + 1}`).join('\n'), extensions: [codeFolding()] });
		state = state.update({ effects: foldEffect.of({ from: codePreviewEnd(state, 0, state.doc.length), to: state.doc.length }) }).state;
		state = state.update({ changes: { from: state.doc.line(2).from, insert: 'Inserted\n' } }).state;
		const folded = existingCodeFold(state, 0, state.doc.length);
		expect(folded?.from).toBe(state.doc.line(7).to);
		state = state.update({ effects: unfoldEffect.of(folded!) }).state;
		expect(existingCodeFold(state, 0, state.doc.length)).toBeUndefined();
	});
});
