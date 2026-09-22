import { describe, expect, it, vi } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { escapeFencedCode } from './codeFenceEditing';
import { exitEmptyMarkdownSection } from './sectionEditing';
import { deleteFullySelectedFencedCode } from './blockSelection';

function view(doc: string, cursor = doc.length): EditorView {
	return { state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown()] }), dispatch: vi.fn() } as unknown as EditorView;
}

describe('code editing safety', () => {
	it('does not mistake an opening fence for a closing fence', () => {
		const editor = view('```text\none\ntwo');
		expect(escapeFencedCode(editor)).toBe(false);
		expect(editor.dispatch).not.toHaveBeenCalled();
	});

	it.each(['```text\n- \n```', '```text\n  \n```', '```text\n> \n```', '    - '])('does not erase code resembling an empty list or quote: %j', (doc) => {
		const cursor = doc.includes('\n```') ? doc.lastIndexOf('\n```') : doc.length;
		const editor = view(doc, cursor);
		expect(exitEmptyMarkdownSection(editor)).toBe(false);
		expect(editor.dispatch).not.toHaveBeenCalled();
	});

	it('preserves all selections when deleting with multiple cursors', () => {
		const doc = '```\none\n```\nother';
		const editor = {
			state: EditorState.create({ doc, extensions: [markdown(), EditorState.allowMultipleSelections.of(true)],
				selection: EditorSelection.create([EditorSelection.range(4, 7), EditorSelection.range(12, 17)]) }),
			dispatch: vi.fn(),
		} as unknown as EditorView;
		expect(deleteFullySelectedFencedCode(editor)).toBe(false);
		expect(editor.dispatch).not.toHaveBeenCalled();
	});
});
