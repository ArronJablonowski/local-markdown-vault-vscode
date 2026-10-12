import { describe, expect, it } from 'vitest';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { indentUnit } from '@codemirror/language';
import { indentMarkdownList, indentQuotedList } from './quotedListIndent';

function editor(doc: string, anchor: number, head = anchor, locked = false, unit = '  ') {
	let state = EditorState.create({ doc, selection: { anchor, head }, extensions: [markdown(), indentUnit.of(unit), EditorState.readOnly.of(locked)] });
	return { get state() { return state; }, dispatch(spec: TransactionSpec) { state = state.update(spec).state; } } as EditorView;
}

describe('quoted list indentation', () => {
	it.each(['- Child', '- [ ] Task', '1. Numbered', '+ Alternative'])('indents and outdents %s after nested quotes', marker => {
		const doc = `> > [!note]\n> > - Parent\n> > ${marker}`;
		const view = editor(doc, doc.length);
		expect(indentQuotedList(view)).toBe(true);
		expect(view.state.doc.toString()).toBe(doc.replace(`> > ${marker}`, `> >   ${marker}`));
		expect(indentQuotedList(view, true)).toBe(true);
		expect(view.state.doc.toString()).toBe(doc);
	});
	it('indents selected bullet lines without changing the quote prefix', () => {
		const doc = '> - Parent\n> - One\n> - Two\nAfter';
		const view = editor(doc, doc.indexOf('> - One'), doc.indexOf('After'));
		expect(indentQuotedList(view)).toBe(true);
		expect(view.state.doc.toString()).toBe('> - Parent\n>   - One\n>   - Two\nAfter');
	});
	it('does not outdent a root bullet out of its callout', () => {
		const view = editor('> - Root', 8);
		expect(indentQuotedList(view, true)).toBe(true);
		expect(view.state.doc.toString()).toBe('> - Root');
	});
	it.each(['> ```\n> - Literal\n> ```', 'Plain text', '- Normal list'])('leaves non-quoted-list contexts to the default keymap: %s', doc => {
		const view = editor(doc, doc.includes('Literal') ? doc.indexOf('Literal') : doc.length);
		expect(indentQuotedList(view)).toBe(false);
		expect(view.state.doc.toString()).toBe(doc);
	});
	it('does not edit locked content', () => {
		const view = editor('> - Root', 8, 8, true);
		expect(indentQuotedList(view)).toBe(false);
		expect(view.state.doc.toString()).toBe('> - Root');
	});
});

describe('full-tab list indentation', () => {
	it.each(['- Child', '- [ ] Task', '- [x] Done', '1. Numbered', '+ Alternative'])('adds four spaces to %s and reverses it', marker => {
		const doc = `- Parent\n${marker}`;
		const view = editor(doc, doc.length, doc.length, false, '    ');
		expect(indentMarkdownList(view)).toBe(true);
		expect(view.state.doc.toString()).toBe(`- Parent\n    ${marker}`);
		expect(indentMarkdownList(view, true)).toBe(true);
		expect(view.state.doc.toString()).toBe(doc);
	});
	it('does not turn the first item into indented code', () => {
		const view = editor('- First', 7, 7, false, '    ');
		expect(indentMarkdownList(view)).toBe(true);
		expect(view.state.doc.toString()).toBe('- First');
	});
	it('outdents legacy nesting one level at a time', () => {
		const doc = '- Parent\n  - Child\n    - Grandchild';
		const view = editor(doc, doc.length, doc.length, false, '    ');
		expect(indentMarkdownList(view, true)).toBe(true);
		expect(view.state.doc.toString()).toBe('- Parent\n  - Child\n  - Grandchild');
	});
	it('keeps locked checkbox source unchanged', () => {
		const doc = '- [ ] Parent\n- [ ] Child';
		const view = editor(doc, doc.length, doc.length, true, '    ');
		expect(indentMarkdownList(view)).toBe(false);
		expect(view.state.doc.toString()).toBe(doc);
	});
});
