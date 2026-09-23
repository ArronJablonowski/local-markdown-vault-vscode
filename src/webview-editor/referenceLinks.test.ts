import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { referenceLinkTarget } from './referenceLinks';

function targets(doc: string) {
	const state = EditorState.create({ doc, extensions: [markdown()] });
	const results: Array<string | undefined> = [];
	syntaxTree(state).iterate({ enter(node) {
		if (node.name === 'Link' || node.name === 'Image') results.push(referenceLinkTarget(state, node.node));
	} });
	return results;
}

describe('reference link lookup', () => {
	it('supports full, collapsed, shortcut, and image references', () => {
		expect(targets('[text][id] [id][] [id] ![alt][id]\n\n[id]: note.md')).toEqual(['note.md', 'note.md', 'note.md', 'note.md']);
	});
	it('normalizes labels, preserves first definitions, and strips destination brackets', () => {
		expect(targets('[text][Some ID]\n\n[some id]: <folder/note.md>\n[some id]: second.md')).toEqual(['folder/note.md']);
	});
	it('ignores undefined references, footnotes, and definitions inside fences', () => {
		expect(targets('[missing] [^note]\n\n```text\n[missing]: unsafe.md\n```\n\n[^note]: example')).toEqual([undefined, undefined]);
	});
	it('does not reuse reference destinations after document edits', () => {
		expect(targets('[id]\n\n[id]: one.md')).toEqual(['one.md']);
		expect(targets('[id]\n\n[id]: two.md')).toEqual(['two.md']);
	});
});
