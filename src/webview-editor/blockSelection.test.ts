import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { fullySelectedFenceRange } from './blockSelection';

function state(doc: string): EditorState {
	return EditorState.create({ doc, extensions: [markdown()] });
}

describe('fullySelectedFenceRange', () => {
	it('expands all selected visible code to include both fences', () => {
		const doc = 'Before\n```text\none\ntwo\n```\nAfter';
		const editor = state(doc);
		expect(fullySelectedFenceRange(editor, doc.indexOf('one'), doc.indexOf('two') + 3)).toEqual({
			from: doc.indexOf('```text'),
			to: doc.indexOf('```\nAfter') + 3,
		});
	});

	it('does not widen a partial code selection', () => {
		const doc = '```text\none\ntwo\n```';
		const editor = state(doc);
		expect(fullySelectedFenceRange(editor, doc.indexOf('one'), doc.indexOf('one') + 3)).toBeNull();
	});

	it('does not combine selections from different fences', () => {
		const doc = '```\none\n```\n\n```\ntwo\n```';
		const editor = state(doc);
		expect(fullySelectedFenceRange(editor, doc.indexOf('one'), doc.indexOf('two') + 3)).toBeNull();
	});
});
