import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { GFM } from './gfmTableFix';
import { spreadsheetPasteNeedsLiteralText } from './spreadsheetPaste';

vi.mock('@codemirror/language', async importOriginal => ({
	...await importOriginal<typeof import('@codemirror/language')>(),
	ensureSyntaxTree: vi.fn((...args: Parameters<typeof ensureSyntaxTree>) => actualEnsure(...args)),
}));
const { ensureSyntaxTree: actualEnsure } = await vi.importActual<typeof import('@codemirror/language')>('@codemirror/language');
afterEach(() => vi.clearAllMocks());

function state(doc: string): EditorState {
	return EditorState.create({ doc, extensions: [EditorState.lineSeparator.of('\n'), markdown({ extensions: GFM })] });
}

describe('spreadsheet paste context', () => {
	for (const [name, body] of [
		['backtick fence', '```text\nTARGET\n```'],
		['tilde fence', '~~~text\nTARGET\n~~~'],
		['indented code', '    TARGET'],
		['inline code', 'Literal `TARGET` source'],
		['HTML block', '<div>\nTARGET\n</div>'],
		['block HTML comment', '<!--\nTARGET\n-->'],
		['inline HTML comment', 'Prose <!-- TARGET --> remains'],
		['block processing instruction', '<?process\nTARGET\n?>'],
		['inline processing instruction', 'Prose <?process TARGET ?> remains'],
		['inline HTML attribute', 'Prose <span title="TARGET">remains</span>'],
		['table source', '| Left | Right |\n| --- | --- |\n| TARGET | keep |'],
	] as const) {
		it(`keeps ${name} literal in a complete syntax tree`, () => {
			const doc = `Before\n\n${body}\n\nAfter`;
			const editor = state(doc), from = doc.indexOf('TARGET');
			expect(spreadsheetPasteNeedsLiteralText(editor, from, from + 6)).toBe(true);
			expect(ensureSyntaxTree).toHaveBeenCalledOnce();
			expect(ensureSyntaxTree).toHaveBeenCalledWith(editor, from + 6, 20);
		});

		it(`keeps distant ${name} literal before background parsing finishes`, () => {
			const doc = 'Earlier paragraph **retained** with context.\n\n'.repeat(10000) + body;
			const editor = state(doc), from = doc.indexOf('TARGET');
			expect(syntaxTree(editor).length).toBeLessThan(from);
			expect(spreadsheetPasteNeedsLiteralText(editor, from, from + 6)).toBe(true);
			expect(ensureSyntaxTree).toHaveBeenCalledOnce();
		});
	}

	it('shares one parse budget while protecting either source endpoint of a cross-object selection', () => {
		const doc = 'Before\n\n```text\nTARGET\n```\n\nAfter';
		const editor = state(doc), from = doc.indexOf('TARGET');
		expect(spreadsheetPasteNeedsLiteralText(editor, from, doc.length)).toBe(true);
		expect(ensureSyntaxTree).toHaveBeenLastCalledWith(editor, doc.length, 20);
		expect(spreadsheetPasteNeedsLiteralText(editor, 0, from + 6)).toBe(true);
		expect(ensureSyntaxTree).toHaveBeenLastCalledWith(editor, from + 6, 20);
		expect(ensureSyntaxTree).toHaveBeenCalledTimes(2);
	});

	it('retains frontmatter source without spending a syntax budget', () => {
		const doc = '---\nnotes: |\n' + '  Source remains literal\n'.repeat(1800) + '  TARGET\n---\n\nAfter';
		const editor = state(doc), from = doc.indexOf('TARGET');
		expect(spreadsheetPasteNeedsLiteralText(editor, from, from + 6)).toBe(true);
		expect(ensureSyntaxTree).not.toHaveBeenCalled();
	});

	for (const [name, doc] of [
		['unfinished', '---\ntitle: Meeting\nnext: TARGET'],
		['oversized', '---\nsummary: ' + 'x'.repeat(70_000) + '\nnext: TARGET\n---\n\nBody'],
		['unfinished CRLF', '---\r\ntitle: Meeting\r\nnext: TARGET'],
	] as const) it(`retains ambiguous ${name} frontmatter without additional parsing`, () => {
		const editor = state(doc), from = doc.indexOf('TARGET');
		expect(editor.doc.toString()).toBe(doc);
		expect(spreadsheetPasteNeedsLiteralText(editor, from, from + 6)).toBe(true);
		expect(ensureSyntaxTree).not.toHaveBeenCalled();
	});

	it('recognizes exact source and following prose boundaries', () => {
		const doc = '---\ntitle: Meeting\n---\n\nBefore\n\n```text\nTARGET\n```\n\nAfter';
		const editor = state(doc), sourceStart = doc.indexOf('TARGET'), after = doc.indexOf('After');
		for (const position of [sourceStart, sourceStart + 6, doc.lastIndexOf('```'), doc.lastIndexOf('```') + 3]) {
			expect(spreadsheetPasteNeedsLiteralText(editor, position, position)).toBe(true);
		}
		for (const position of [doc.indexOf('Before'), after - 1, after, doc.length]) {
			expect(spreadsheetPasteNeedsLiteralText(editor, position, position)).toBe(false);
		}
	});

	it('conservatively retains text when the bounded parse cannot establish even prose context', () => {
		const editor = state('Ordinary prose');
		vi.mocked(ensureSyntaxTree).mockReturnValueOnce(null);
		expect(spreadsheetPasteNeedsLiteralText(editor, 0, editor.doc.length)).toBe(true);
		expect(ensureSyntaxTree).toHaveBeenCalledOnce();
		expect(ensureSyntaxTree).toHaveBeenCalledWith(editor, editor.doc.length, 20);
	});

	it('does not infer prose context without a language parser', () => {
		const editor = EditorState.create({ doc: 'Ordinary prose' });
		expect(spreadsheetPasteNeedsLiteralText(editor, 0, editor.doc.length)).toBe(true);
	});

	it('permits conversion in known prose, including an empty document', () => {
		for (const doc of ['', 'Ordinary prose', '```text\ncode\n```\n\nOrdinary prose']) {
			const editor = state(doc);
			expect(spreadsheetPasteNeedsLiteralText(editor, doc.length, doc.length)).toBe(false);
		}
	});
});
