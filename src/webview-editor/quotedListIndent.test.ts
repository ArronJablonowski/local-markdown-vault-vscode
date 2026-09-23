import { describe, expect, it } from 'vitest';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { indentUnit } from '@codemirror/language';
import { indentQuotedList } from './quotedListIndent';

function editor(doc: string, anchor: number, head = anchor, locked = false) {
	let state = EditorState.create({ doc, selection: { anchor, head }, extensions: [markdown(), indentUnit.of('  '), EditorState.readOnly.of(locked)] });
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
