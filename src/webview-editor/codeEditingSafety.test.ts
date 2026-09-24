import { describe, expect, it, vi } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { escapeFencedCode, exitFencedCodeOnBlankLine } from './codeFenceEditing';
import { exitEmptyMarkdownSection } from './sectionEditing';
import { deleteFullySelectedFencedCode } from './blockSelection';

function view(doc: string, cursor = doc.length): EditorView {
	return { state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown()] }), dispatch: vi.fn() } as unknown as EditorView;
}

describe('code editing safety', () => {
	it('adds a real closing fence without mistaking the opener for the closing fence', () => {
		const editor = view('```text\none\ntwo');
		expect(escapeFencedCode(editor)).toBe(true);
		expect(editor.dispatch).toHaveBeenCalledWith(expect.objectContaining({
			changes: { from: editor.state.doc.length, insert: '\n```\n' },
			selection: { anchor: editor.state.doc.length + 5 },
		}));
	});

	it.each(['```', '~~~~', '`````'])('closes an unfinished %s fence after a final blank line', (fence) => {
		const editor = view(`${fence}text\nkeep this code\n`);
		expect(exitFencedCodeOnBlankLine(editor)).toBe(true);
		expect(editor.dispatch).toHaveBeenCalledWith(expect.objectContaining({
			changes: { from: editor.state.doc.length, insert: `${fence}\n` },
		}));
	});

	it('keeps a single Enter inside nonempty unfinished code', () => {
		const editor = view('```text\nkeep this code');
		expect(exitFencedCodeOnBlankLine(editor)).toBe(false);
		expect(editor.dispatch).not.toHaveBeenCalled();
	});

	it('escapes trailing padding before an automatically inserted closing fence', () => {
		const doc = '```python\nprint("ready")\n\n\n```';
		const editor = view(doc, doc.indexOf('\n\n\n') + 1);
		expect(exitFencedCodeOnBlankLine(editor)).toBe(true);
		expect(editor.dispatch).toHaveBeenCalledWith(expect.objectContaining({
			changes: { from: doc.length, insert: '\n' },
			selection: { anchor: doc.length + 1 },
		}));
	});

	it('does not escape an interior blank line followed by more code', () => {
		const doc = '```python\none\n\n\ntwo\n```';
		expect(exitFencedCodeOnBlankLine(view(doc, doc.indexOf('\n\n\n') + 1))).toBe(false);
	});

	it.each(['```', '```text', '~~~~'])('does not jump into or past the next block from prose between %s fences', fence => {
		const closer = fence[0] === '~' ? '~~~~' : '```';
		const doc = `${fence}\none\n${closer}\n\n${fence}\ntwo\n${closer}`;
		const cursor = doc.indexOf('\n\n') + 1;
		const editor = view(doc, cursor);
		expect(escapeFencedCode(editor)).toBe(false);
		expect(exitFencedCodeOnBlankLine(editor)).toBe(false);
		expect(editor.dispatch).not.toHaveBeenCalled();
	});

	it('does not guess a closing prefix for a nested unfinished fence', () => {
		const editor = view('> ```text\n> code\n> ');
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
