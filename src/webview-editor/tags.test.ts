import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { describe, expect, it } from 'vitest';
import { findInlineTags } from './tags';

function tags(source: string): string[] {
	const state = EditorState.create({ doc: source, extensions: [markdown()] });
	return findInlineTags(state, 0, state.doc.length).map((item) => item.tag);
}

describe('inline tags', () => {
	it('finds Unicode and nested tags', () => {
		expect(tags('Use #work/active and (#日本語).')).toEqual(['work/active', '日本語']);
	});

	it('does not treat headings, code, URL fragments, or numbers as tags', () => {
		expect(tags('# Heading\n\n`#code` https://example.com/#anchor #123\n\n```\n#fence\n```')).toEqual([]);
	});
});
