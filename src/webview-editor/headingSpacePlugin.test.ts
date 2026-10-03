import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { headingSpaceInputHandler } from './headingSpacePlugin';

vi.mock('@codemirror/language', async importOriginal => ({
	...await importOriginal<typeof import('@codemirror/language')>(),
	ensureSyntaxTree: vi.fn((...args: Parameters<typeof ensureSyntaxTree>) => importActualEnsure(...args)),
}));
const { ensureSyntaxTree: importActualEnsure } = await vi.importActual<typeof import('@codemirror/language')>('@codemirror/language');

function type(initial: string, text: string, cursor = initial.length): string {
	let state = EditorState.create({ doc: initial, selection: { anchor: cursor }, extensions: [markdown(), headingSpaceInputHandler] });
	const editor = {
		get state() { return state; },
		dispatch(spec: Parameters<EditorState['update']>[0]) { state = state.update(spec).state; },
	} as unknown as EditorView;
	for (const character of text) {
		const { from, to } = state.selection.main;
		const insert = () => state.update(state.replaceSelection(character));
		if (!state.facet(EditorView.inputHandler).some(handler => handler(editor, from, to, character, insert))) state = insert().state;
	}
	return state.doc.toString();
}

afterEach(() => vi.clearAllMocks());

describe('heading spacing respects literal source', () => {
	it.each(['#meeting', '#Project/active', '#\u65e5\u672c\u8a9e', '#123'])('preserves a line-start tag or literal hash: %s', text => {
		expect(type('', text)).toBe(text);
		expect(type('Earlier paragraph\n\n', text)).toBe('Earlier paragraph\n\n' + text);
	});

	it.each([1, 2, 3, 4, 5, 6])('retains explicit level %i heading syntax', level => {
		const text = '#'.repeat(level) + ' Meeting';
		expect(type('', text)).toBe(text);
	});

	it.each([2, 3, 4, 5, 6])('keeps level %i convenience spacing in ordinary Markdown', level => {
		expect(type('', '#'.repeat(level) + 'Agenda')).toBe('#'.repeat(level) + ' Agenda');
	});

	it.each([
		['```text\n', ''],
		['~~~python\n', '\n~~~'],
		['Before\n\n    ', ''],
		['`', '`'],
		['<!--\n', '\n-->'],
		['---\n', '\n---\n\nBody'],
		['---\nowner: Morgan\n', ''],
	])('preserves hashes in literal content after %j', (prefix, suffix) => {
		for (const text of ['#meeting', '##comment']) {
			expect(type(prefix + suffix, text, prefix.length)).toBe(prefix + text + suffix);
		}
	});

	it('resumes heading convenience after closed frontmatter', () => {
		expect(type('---\nowner: Morgan\n---\n\n', '##Agenda')).toBe('---\nowner: Morgan\n---\n\n## Agenda');
	});

	it('preserves literal typing when a frontmatter delimiter is beyond the bounded scan', () => {
		const initial = '---\nowner: ' + 'a'.repeat(64 * 1024) + '\n---\n\n##';
		expect(type(initial, 'Agenda')).toBe(initial + 'Agenda');
	});

	it('leaves source untouched when parsing cannot reach the caret within its budget', () => {
		vi.mocked(ensureSyntaxTree).mockReturnValueOnce(null);
		expect(type('##', 'A')).toBe('##A');
		expect(ensureSyntaxTree).toHaveBeenCalledWith(expect.anything(), 2, 20);
	});

	it('does not collapse multiple carets into a single heading edit', () => {
		const state = EditorState.create({ doc: '##\n##', extensions: [markdown(), headingSpaceInputHandler, EditorState.allowMultipleSelections.of(true)],
			selection: EditorSelection.create([EditorSelection.cursor(2), EditorSelection.cursor(5)]) });
		const dispatch = vi.fn();
		const editor = { state, dispatch } as unknown as EditorView;
		const handled = state.facet(EditorView.inputHandler).some(handler => handler(editor, 2, 2, 'A', () => state.update(state.replaceSelection('A'))));
		expect(handled).toBe(false);
		expect(dispatch).not.toHaveBeenCalled();
		expect(state.update(state.replaceSelection('A')).newDoc.toString()).toBe('##A\n##A');
	});

	it.each(['compositionStarted', 'composing'] as const)('keeps %s input on its literal composition path', flag => {
		const state = EditorState.create({ doc: '##', selection: { anchor: 2 }, extensions: [markdown(), headingSpaceInputHandler] });
		const dispatch = vi.fn();
		const editor = { state, dispatch, [flag]: true } as unknown as EditorView;
		const handled = state.facet(EditorView.inputHandler).some(handler => handler(editor, 2, 2, 'A', () => state.update(state.replaceSelection('A'))));
		expect(handled).toBe(false);
		expect(dispatch).not.toHaveBeenCalled();
		expect(ensureSyntaxTree).not.toHaveBeenCalled();
		expect(state.update(state.replaceSelection('A')).newDoc.toString()).toBe('##A');
	});
});
