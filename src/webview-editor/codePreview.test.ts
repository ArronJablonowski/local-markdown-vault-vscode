import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { codeFolding, foldEffect, unfoldEffect } from '@codemirror/language';
import { codePreviewEnd, existingCodeFold, codePreviewCollapsed } from './codePreview';

function shiftedView() {
	let state = EditorState.create({ doc: 'Before\n\n' + Array.from({ length: 12 }, (_, n) => `line${n + 1}`).join('\n'), extensions: [codeFolding()] });
	state = state.update({ effects: foldEffect.of({ from: codePreviewEnd(state, 8, state.doc.length), to: state.doc.length }) }).state;
	state = state.update({ changes: { from: state.doc.line(4).from, insert: 'Inserted\n' } }).state;
	const view: any = { state, dom: { isConnected: true }, dispatch: vi.fn((transaction: any) => { view.state = view.state.update(transaction).state; }) };
	return view;
}

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
	it('coalesces preview corrections without changing source', async () => {
		const view = shiftedView(), source = view.state.doc.toString();
		for (let n = 0; n < 5; n++) expect(codePreviewCollapsed(view, 8, view.state.doc.length)).toBe(true);
		expect(view.dispatch).not.toHaveBeenCalled();
		await Promise.resolve();
		expect(view.dispatch).toHaveBeenCalledTimes(1);
		expect(existingCodeFold(view.state, 8, view.state.doc.length)?.from).toBe(codePreviewEnd(view.state, 8, view.state.doc.length));
		expect(view.state.doc.toString()).toBe(source);
	});
	it('does not hide an actively edited line or move its cursor', async () => {
		const view = shiftedView();
		view.state = view.state.update({ selection: { anchor: view.state.doc.line(4).from } }).state;
		const head = view.state.selection.main.head;
		codePreviewCollapsed(view, 8, view.state.doc.length); await Promise.resolve();
		expect(view.dispatch).not.toHaveBeenCalled(); expect(view.state.selection.main.head).toBe(head);
		view.state = view.state.update({ selection: { anchor: 0 } }).state;
		codePreviewCollapsed(view, 8, view.state.doc.length); await Promise.resolve();
		expect(view.dispatch).toHaveBeenCalledTimes(1);
	});
	it.each(['document', 'selection', 'destroyed'])('rejects stale correction after %s changes', async change => {
		const view = shiftedView(); codePreviewCollapsed(view, 8, view.state.doc.length);
		if (change === 'document') view.state = view.state.update({ changes: { from: 0, insert: 'New\n' } }).state;
		else if (change === 'selection') view.state = view.state.update({ selection: { anchor: 10 } }).state;
		else view.dom.isConnected = false;
		await Promise.resolve(); expect(view.dispatch).not.toHaveBeenCalled();
	});
	it('unfolds completely when only four lines remain', async () => {
		const view = shiftedView();
		view.state = EditorState.create({ doc: 'Before\n\none\ntwo\nthree\nfour', extensions: [codeFolding()] });
		view.state = view.state.update({ effects: foldEffect.of({ from: view.state.doc.line(3).to, to: view.state.doc.length }) }).state;
		codePreviewCollapsed(view, 8, view.state.doc.length); await Promise.resolve();
		expect(existingCodeFold(view.state, 8, view.state.doc.length)).toBeUndefined();
	});
});
