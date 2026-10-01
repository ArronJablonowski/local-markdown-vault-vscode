import { describe, expect, it, vi } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { escapeFencedCode, exitFencedCodeOnBlankLine } from './codeFenceEditing';
import { exitEmptyMarkdownSection } from './sectionEditing';
import { deleteFullySelectedFencedCode } from './blockSelection';

function view(doc: string, cursor = doc.length): EditorView {
	return { state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown()] }), dispatch: vi.fn() } as unknown as EditorView;
}

describe('code editing safety', () => {
	it.each([escapeFencedCode, exitFencedCodeOnBlankLine])('preserves a locked code block without dispatching navigation or edits (%#)', command => {
		const doc = '```text\nretained\n\n```';
		const editor = {
			state: EditorState.create({ doc, selection: { anchor: doc.lastIndexOf('\n```') }, extensions: [markdown(), EditorState.readOnly.of(true)] }),
			dispatch: vi.fn(),
		} as unknown as EditorView;
		expect(command(editor)).toBe(false);
		expect(editor.dispatch).not.toHaveBeenCalled();
	});

	it.each([false, true])('preserves an arrow-extended code selection in either direction (backward=%s)', backward => {
		const doc = '```text\nretained\n\n```';
		const from = doc.indexOf('retained');
		const to = from + 'retained'.length;
		const editor = {
			state: EditorState.create({ doc, selection: { anchor: backward ? to : from, head: backward ? from : to }, extensions: [markdown()] }),
			dispatch: vi.fn(),
		} as unknown as EditorView;
		expect(escapeFencedCode(editor)).toBe(false);
		expect(exitFencedCodeOnBlankLine(editor)).toBe(false);
		expect(editor.dispatch).not.toHaveBeenCalled();
	});

	it('preserves multiple carets when one is on a final blank code line', () => {
		const doc = 'Above\n\n```text\nretained\n\n```';
		const editor = {
			state: EditorState.create({ doc, extensions: [markdown(), EditorState.allowMultipleSelections.of(true)],
				selection: EditorSelection.create([EditorSelection.cursor(2), EditorSelection.cursor(doc.lastIndexOf('\n```'))]) }),
			dispatch: vi.fn(),
		} as unknown as EditorView;
		expect(escapeFencedCode(editor)).toBe(false);
		expect(exitFencedCodeOnBlankLine(editor)).toBe(false);
		expect(editor.dispatch).not.toHaveBeenCalled();
	});

	it('moves explicit escape to the following prose without changing either block', () => {
		const doc = '```text\nretained\n```\nFollowing paragraph';
		const editor = view(doc, doc.indexOf('retained') + 4);
		expect(escapeFencedCode(editor)).toBe(true);
		expect(editor.dispatch).toHaveBeenCalledOnce();
		expect(editor.dispatch).toHaveBeenCalledWith({ selection: { anchor: doc.indexOf('Following') }, scrollIntoView: true });
	});

	it('escapes a final closed fence immediately after a jump beyond the parsed viewport', () => {
		const prefix = '# Retained context\n\nA paragraph with **formatting**.\n\n'.repeat(1800);
		const doc = `${prefix}\`\`\`text\nEOF_ANCHOR\n\`\`\``;
		const editor = view(doc, doc.indexOf('EOF_ANCHOR') + 'EOF_ANCHOR'.length);
		expect(syntaxTree(editor.state).length).toBeLessThan(doc.length);
		expect(escapeFencedCode(editor)).toBe(true);
		expect(editor.dispatch).toHaveBeenCalledWith(expect.objectContaining({
			changes: { from: doc.length, insert: '\n' },
			selection: { anchor: doc.length + 1 },
		}));
	});

	it('exits a trailing blank code line beyond the initial parse without adding more code whitespace', () => {
		const prefix = 'Retained paragraph with **formatting**.\n\n'.repeat(1200);
		const doc = `${prefix}\`\`\`text\nkeep\n\n\`\`\``;
		const editor = view(doc, doc.lastIndexOf('\n```'));
		expect(syntaxTree(editor.state).length).toBeLessThan(doc.length);
		expect(exitFencedCodeOnBlankLine(editor)).toBe(true);
		expect(editor.dispatch).toHaveBeenCalledWith(expect.objectContaining({
			changes: { from: doc.length, insert: '\n' },
			selection: { anchor: doc.length + 1 },
		}));
	});

	it('closes a confirmed unfinished EOF fence beyond the initial parse', () => {
		const prefix = 'Retained paragraph with **formatting**.\n\n'.repeat(1200);
		const doc = `${prefix}\`\`\`text\nkeep\n`;
		const editor = view(doc);
		expect(exitFencedCodeOnBlankLine(editor)).toBe(true);
		expect(editor.dispatch).toHaveBeenCalledWith(expect.objectContaining({
			changes: { from: doc.length, insert: '```\n' },
		}));
	});

	it('does not misclassify distant prose between two fences while completing the parse', () => {
		const prefix = 'Retained paragraph with **formatting**.\n\n'.repeat(1200);
		const doc = `${prefix}\`\`\`text\nfirst\n\`\`\`\n\nProse\n\n\`\`\`text\nsecond\n\`\`\``;
		const editor = view(doc, doc.indexOf('Prose') + 5);
		expect(escapeFencedCode(editor)).toBe(false);
		expect(editor.dispatch).not.toHaveBeenCalled();
	});

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
