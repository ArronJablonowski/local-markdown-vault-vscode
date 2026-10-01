import { EditorState } from '@codemirror/state';
import type { DecorationSet, EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import type { CodeBlockTokens } from '../shared/messages';
import { codeHighlightPlugin, codeTokensField, setCodeTokens } from './codeHighlightPlugin';

function highlightedState(doc: string, blocks: CodeBlockTokens[]): EditorState {
	return EditorState.create({ doc, extensions: [codeTokensField] }).update({ effects: setCodeTokens.of(blocks) }).state;
}

describe('host code-token edits', () => {
	it('discards thousands of old tokens when replacing the entire document', () => {
		const doc = 'abcdefghij\n'.repeat(1_000);
		const blocks = Array.from({ length: 1_000 }, (_, index) => ({
			from: index * 11, to: index * 11 + 10,
			tokens: Array.from({ length: 10 }, (_, token) => ({
				from: index * 11 + token, to: index * 11 + token + 1, style: 'color:#569cd6',
			})),
		}));
		const next = highlightedState(doc, blocks).update({ changes: { from: 0, to: doc.length, insert: 'S' } }).state;
		expect(next.doc.toString()).toBe('S');
		expect(next.field(codeTokensField).length).toBe(0);
	});

	it.each([
		{ from: 4, insert: 'x' },
		{ from: 6, insert: 'x' },
		{ from: 8, insert: 'x' },
		{ from: 5, to: 7, insert: 'replacement' },
		{ from: 0, to: 12, insert: '' },
	])('invalidates syntax for any edit touching a highlighted block: %j', (changes) => {
		const state = highlightedState('pre\ncode\nend', [{
			from: 4, to: 8, tokens: [{ from: 4, to: 8, style: 'color:#569cd6' }],
		}]);
		expect(state.update({ changes }).state.field(codeTokensField)).toEqual([]);
	});

	it('maps untouched blocks without spreading color onto inserted prose', () => {
		const state = highlightedState('pre\ncode\nend', [{
			from: 4, to: 8, tokens: [{ from: 4, to: 6, style: 'color:#569cd6' }, { from: 6, to: 8, style: 'color:#c586c0' }],
		}]);
		expect(state.update({ changes: [{ from: 0, insert: 'Hello ' }, { from: 11, insert: '!' }] }).state.field(codeTokensField)).toEqual([{
			from: 10, to: 14, tokens: [{ from: 10, to: 12, style: 'color:#569cd6' }, { from: 12, to: 14, style: 'color:#c586c0' }],
		}]);
	});

	it('keeps unaffected blocks when a replacement covers neighboring code', () => {
		const blocks = [0, 6, 12].map(from => ({ from, to: from + 4, tokens: [{ from, to: from + 4, style: 'color:#569cd6' }] }));
		const state = highlightedState('code\n\ncode\n\ncode', blocks);
		expect(state.update({ changes: { from: 6, to: 16, insert: 'new prose' } }).state.field(codeTokensField)).toEqual([blocks[0]]);
	});

	it('accepts fresh host tokens after invalidation and retains them through selection changes', () => {
		const state = highlightedState('code', [{ from: 0, to: 4, tokens: [{ from: 0, to: 4, style: 'color:#569cd6' }] }]);
		const edited = state.update({ changes: { from: 1, insert: 'x' } }).state;
		const fresh = [{ from: 0, to: 5, tokens: [{ from: 0, to: 5, style: 'color:#c586c0' }] }];
		const refreshed = edited.update({ effects: setCodeTokens.of(fresh) }).state;
		expect(refreshed.update({ selection: { anchor: 3 } }).state.field(codeTokensField)).toEqual(fresh);
	});

	it('emits each visible token once across separated visible ranges', () => {
		const state = highlightedState('x'.repeat(100), [{ from: 0, to: 100, tokens: [
			{ from: 5, to: 9, style: 'color:#569cd6' },
			{ from: 50, to: 60, style: 'color:#569cd6' },
			{ from: 80, to: 90, style: 'color:#569cd6' },
		] }]);
		const view = { state, visibleRanges: [{ from: 0, to: 20 }, { from: 70, to: 100 }] } as unknown as EditorView;
		const plugin = (codeHighlightPlugin as unknown as { create(view: EditorView): { decorations: DecorationSet } }).create(view);
		const ranges: Array<[number, number]> = [];
		for (let cursor = plugin.decorations.iter(); cursor.value; cursor.next()) ranges.push([cursor.from, cursor.to]);
		expect(ranges).toEqual([[5, 9], [80, 90]]);
	});
});
