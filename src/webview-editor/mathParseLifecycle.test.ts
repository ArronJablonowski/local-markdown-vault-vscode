import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { GFM } from '@lezer/markdown';
import { calloutState, toggleCallout } from './calloutState';
import { findMathRanges, mathDecorationsField, renderableMathRanges } from './math';
import { refreshPreview } from './previewRefresh';

const pointer = vi.hoisted(() => ({ held: false }));
vi.mock('./cmUtils', async importOriginal => ({
	...await importOriginal<typeof import('./cmUtils')>(),
	pointerSelectionInProgress: () => pointer.held,
}));

const prefix = 'Retained paragraph with **formatting**.\n\n'.repeat(1600);
function create(suffix: string): EditorState {
	return EditorState.create({ doc: prefix + suffix, extensions: [markdown({ extensions: GFM }), calloutState, mathDecorationsField] });
}
function finishParse(state: EditorState): EditorState {
	expect(syntaxTree(state).length).toBeLessThan(state.doc.length);
	expect(ensureSyntaxTree(state, state.doc.length, 1000)?.length).toBe(state.doc.length);
	// Advancing the real parse context is published by a state-only transaction,
	// just as the background worker publishes a new syntax tree without typing.
	const transaction = state.update({});
	expect(transaction.docChanged).toBe(false);
	expect(transaction.selection).toBeUndefined();
	expect(syntaxTree(transaction.state).length).toBe(state.doc.length);
	return transaction.state;
}

afterEach(() => { pointer.held = false; });

describe('math follows background parser progress', () => {
	it.each([
		['indented code', '    $x^2$'],
		['table cell', '| Formula |\n| --- |\n| $x^2$ |'],
		['collapsed callout', '> [!note]- Hidden\n> $x^2$'],
		['collapsed display math', '> [!note]- Hidden\n>\n> $$\n> x^2\n> $$'],
	])('never speculates into unparsed %s', (_label, suffix) => {
		const state = create(suffix);
		expect(syntaxTree(state).length).toBeLessThan(prefix.length);
		expect(renderableMathRanges(state)).toEqual([]);
		expect(state.field(mathDecorationsField).size).toBe(0);
		const parsed = finishParse(state);
		expect(renderableMathRanges(parsed)).toEqual([]);
		expect(parsed.field(mathDecorationsField).size).toBe(0);
		expect(parsed.doc.toString()).toBe(prefix + suffix);
	});

	it.each(['Ordinary $x^2$ prose.', '> [!note]+ Visible\n> $x^2$', '$$\nx^2\n$$'])('renders eligible math after a parse-only transaction: %j', suffix => {
		const state = create(suffix);
		expect(state.field(mathDecorationsField).size).toBe(0);
		const parsed = finishParse(state);
		expect(renderableMathRanges(parsed).map(range => range.source)).toEqual(['x^2']);
		expect(parsed.field(mathDecorationsField).size).toBe(1);
		expect(parsed.doc).toBe(state.doc);
		expect(parsed.selection).toBe(state.selection);
	});

	it('refreshes callout math on explicit folding and unfolding after background parsing', () => {
		let state = finishParse(create('> [!note]- Hidden\n> $x^2$'));
		expect(state.field(mathDecorationsField).size).toBe(0);
		state = state.update({ effects: toggleCallout.of({ from: prefix.length, collapsed: false }) }).state;
		expect(state.field(mathDecorationsField).size).toBe(1);
		state = state.update({ effects: toggleCallout.of({ from: prefix.length, collapsed: true }) }).state;
		expect(state.field(mathDecorationsField).size).toBe(0);
	});

	it('defers parse-only math reflow during a pointer gesture, then catches up on release', () => {
		const state = create('Ordinary $x^2$ prose.');
		pointer.held = true;
		let parsed = finishParse(state);
		expect(parsed.field(mathDecorationsField)).toBe(state.field(mathDecorationsField));
		expect(parsed.field(mathDecorationsField).size).toBe(0);
		pointer.held = false;
		parsed = parsed.update({ effects: refreshPreview.of(null) }).state;
		expect(parsed.field(mathDecorationsField).size).toBe(1);
		expect(parsed.doc.toString()).toBe(state.doc.toString());
	});

	it('applies real edits immediately during a held gesture without stale math offsets', () => {
		let state = finishParse(create('Ordinary $x^2$ prose.'));
		pointer.held = true;
		state = state.update({ changes: { from: prefix.length, to: state.doc.length, insert: 'Replacement prose.' } }).state;
		expect(state.field(mathDecorationsField).size).toBe(0);
		expect(state.doc.toString()).toBe(prefix + 'Replacement prose.');
	});

	it('renders the last body expression in a 500 KB mixed note below the expression cap', () => {
		const prose = Array.from({ length: 769 }, (_, n) => `## Context ${n}\n\n${'Retained context with **formatting**. '.repeat(17)} Inline $x^2$.\n\n`).join('');
		const table = '| Expression |\n| --- |\n' + '| $n^2$ |\n'.repeat(12);
		const doc = 'Intro\n\n' + table + '\n' + prose + '$$\ny^2\n$$\n';
		expect(doc.length).toBeGreaterThan(480_000);
		expect(findMathRanges(doc).filter(range => !range.display)).toHaveLength(781);
		const initial = EditorState.create({ doc, extensions: [markdown({ extensions: GFM }), calloutState, mathDecorationsField] });
		const state = finishParse(initial);
		const ranges = renderableMathRanges(state);
		expect(ranges.filter(range => !range.display)).toHaveLength(769);
		expect(ranges.some(range => range.from === doc.lastIndexOf('$x^2$'))).toBe(true);
		expect(state.field(mathDecorationsField).size).toBe(770);
		expect(state.doc).toBe(initial.doc);
	});

	it('keeps intentional source reveal and inert code after a completed parse', () => {
		let state = finishParse(create('Visible $x^2$.\n\n`$code$`\n\n```text\n$literal$\n```'));
		expect(state.field(mathDecorationsField).size).toBe(1);
		state = state.update({ selection: { anchor: prefix.length + 10 } }).state;
		expect(state.field(mathDecorationsField).size).toBe(0);
		state = state.update({ selection: { anchor: 0 } }).state;
		expect(state.field(mathDecorationsField).size).toBe(1);
		const value = state.field(mathDecorationsField);
		expect(state.update({}).state.field(mathDecorationsField)).toBe(value);
	});

	it('preserves the existing expression count and length limits', () => {
		expect(findMathRanges('$x$ '.repeat(1001))).toHaveLength(1000);
		expect(findMathRanges('$' + 'x'.repeat(8193) + '$')).toEqual([]);
		expect(findMathRanges('$$\n' + 'x'.repeat(65537) + '\n$$')).toEqual([]);
	});
});
