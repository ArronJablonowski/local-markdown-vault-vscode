import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { calloutState, toggleCallout } from './calloutState';

describe('callout folding state', () => {
	it('Find opens every collapsed ancestor without changing saved fold markers', () => {
		const doc = 'Before\n\n> [!note]- Outer\n> > [!tip]- Inner\n> > Find this token.\n\nAfter';
		const from = doc.indexOf('Find this');
		let state = EditorState.create({ doc, extensions: [markdown(), calloutState] });
		state = state.update({ selection: { anchor: from, head: from + 4 }, userEvent: 'select.search' }).state;
		expect([...state.field(calloutState)]).toEqual([[doc.indexOf('> [!note]'), false], [doc.indexOf('> > [!tip]'), false]]);
		expect(state.doc.toString()).toBe(doc);
	});

	it('ordinary selection and a Find match in the title leave its body collapsed', () => {
		const doc = '> [!note]- Title\n> Body';
		const state = EditorState.create({ doc, extensions: [markdown(), calloutState] });
		expect(state.update({ selection: { anchor: 18, head: 21 }, userEvent: 'select.pointer' }).state.field(calloutState).size).toBe(0);
		expect(state.update({ selection: { anchor: 11, head: 16 }, userEvent: 'select.search' }).state.field(calloutState).size).toBe(0);
	});

	it('folding does not edit source and survives edits before the callout', () => {
		const doc = 'Intro\n\n> [!note]+ Title\n> Body';
		let state = EditorState.create({ doc, extensions: [calloutState] });
		state = state.update({ effects: toggleCallout.of({ from: 7, collapsed: true }) }).state;
		expect(state.doc.toString()).toBe(doc);
		state = state.update({ changes: { from: 0, insert: 'Prefix\n' } }).state;
		expect(state.field(calloutState).get(14)).toBe(true);
	});
	it('drops state when the callout is deleted', () => {
		let state = EditorState.create({ doc: '> [!note] Title\n> Body', extensions: [calloutState] });
		state = state.update({ effects: toggleCallout.of({ from: 0, collapsed: true }) }).state;
		state = state.update({ changes: { from: 0, to: state.doc.length, insert: 'Plain' } }).state;
		expect(state.field(calloutState).size).toBe(0);
	});
	it('honors a changed source fold marker instead of retaining a UI override', () => {
		let state = EditorState.create({ doc: '> [!note]+ Title\n> Body', extensions: [calloutState] });
		state = state.update({ effects: toggleCallout.of({ from: 0, collapsed: true }) }).state;
		state = state.update({ changes: { from: 9, to: 10, insert: '-' } }).state;
		expect(state.field(calloutState).size).toBe(0);
	});
});
