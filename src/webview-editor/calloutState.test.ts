import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { calloutState, toggleCallout } from './calloutState';

describe('callout folding state', () => {
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
