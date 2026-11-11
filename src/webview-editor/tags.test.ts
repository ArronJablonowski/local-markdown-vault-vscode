import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { ensureSyntaxTree, syntaxTreeAvailable } from '@codemirror/language';
vi.mock('@codemirror/language', async importOriginal => {
	const actual = await importOriginal<typeof import('@codemirror/language')>();
	return { ...actual, syntaxTreeAvailable: vi.fn(actual.syntaxTreeAvailable) };
});
import { findInlineTags } from './tags';

function tags(source: string): string[] {
	const state = EditorState.create({ doc: source, extensions: [markdown()] });
	ensureSyntaxTree(state, state.doc.length, 5000);
	return findInlineTags(state.update({}).state, 0, state.doc.length).map((item) => item.tag);
}
afterEach(() => vi.mocked(syntaxTreeAvailable).mockClear());

describe('inline tags', () => {
	it('does not guess at tags before the surrounding syntax is parsed', () => {
		vi.mocked(syntaxTreeAvailable).mockReturnValueOnce(false);
		expect(tags('Pending #tag')).toEqual([]);
		expect(tags('Parsed #tag')).toEqual(['tag']);
	});
	it('finds Unicode and nested tags', () => {
		expect(tags('Use #work/active and (#\u65e5\u672c\u8a9e).')).toEqual(['work/active', '\u65e5\u672c\u8a9e']);
	});

	it('does not treat headings, code, URL fragments, or numbers as tags', () => {
		expect(tags('# Heading\n\n`#code` https://example.com/#anchor #123\n\n```\n#fence\n```')).toEqual([]);
	});
});
