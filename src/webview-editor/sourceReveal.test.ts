import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { codeFolding, ensureSyntaxTree, foldEffect, foldedRanges } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from './gfmTableFix';
import { sourceBlockUnfoldEffects } from './sourceReveal';

function stateWithFolds(doc: string, prefixes: string[], readonly = false): EditorState {
	let state = EditorState.create({ doc, extensions: [markdown({ extensions: GFM }), codeFolding(), EditorState.readOnly.of(readonly)] });
	if (!ensureSyntaxTree(state, doc.length, 1000)) throw new Error('Fixture did not parse');
	state = state.update({}).state;
	return state.update({ effects: prefixes.map(prefix => foldEffect.of({
		from: state.doc.lineAt(doc.indexOf(prefix + '_1')).to,
		to: state.doc.lineAt(doc.indexOf(prefix + '_2')).to,
	})) }).state;
}
function reveal(state: EditorState, position: number): EditorState {
	const next = state.update({ effects: sourceBlockUnfoldEffects(state, position) }).state;
	expect(next.doc).toBe(state.doc); // Presentation changes cannot rewrite a byte.
	return next;
}

describe('explicit source reveal', () => {
	for (const prefix of ['', '> ', '> > ']) it(`expands a formerly folded diagram through ${JSON.stringify(prefix)} container prefixes`, () => {
		const doc = 'Intro\n\n' + ['```mermaid', 'hidden_1', 'hidden_2', '```'].map(line => prefix + line).join('\n') + '\n\nAfter';
		const state = stateWithFolds(doc, ['hidden']);
		const position = state.doc.lineAt(doc.indexOf('```mermaid')).from;
		expect(foldedRanges(reveal(state, position)).size).toBe(0);
	});
	it('does not expand unrelated code blocks', () => {
		const doc = 'Intro\n\n```mermaid\nfirst_1\nfirst_2\n```\n\n```js\nsecond_1\nsecond_2\n```\n\nAfter';
		const state = stateWithFolds(doc, ['first', 'second']);
		const next = reveal(state, doc.indexOf('```mermaid'));
		const remaining: number[] = [];
		foldedRanges(next).between(0, doc.length, from => { remaining.push(from); });
		expect(remaining).toEqual([state.doc.lineAt(doc.indexOf('second_1')).to]);
	});
	it('leaves existing folds alone when source focus belongs to prose', () => {
		const doc = 'Intro\n\n```js\nhidden_1\nhidden_2\n```\n\nAfter';
		const state = stateWithFolds(doc, ['hidden']);
		expect(sourceBlockUnfoldEffects(state, 0)).toEqual([]);
		expect(foldedRanges(reveal(state, 0)).size).toBe(1);
	});
	for (const [name, block] of [
		['HTML', '<div>\nhidden_1\nhidden_2\n</div>'],
		['table', '| Name |\n| --- |\n| hidden_1 |\n| hidden_2 |'],
		['indented code', '    hidden_1\n    hidden_2'],
	] as const) it(`expands stale folds within ${name} source`, () => {
		const doc = 'Intro\n\n' + block + '\n\nAfter';
		const state = stateWithFolds(doc, ['hidden']);
		expect(foldedRanges(reveal(state, 'Intro\n\n'.length)).size).toBe(0);
	});
	it('permits presentation-only source expansion in a read-only document', () => {
		const doc = '```js\nhidden_1\nhidden_2\n```';
		const state = stateWithFolds(doc, ['hidden'], true);
		expect(foldedRanges(reveal(state, 0)).size).toBe(0);
	});
	it('resolves source at the end of its opening fence line', () => {
		const doc = '```mermaid\nhidden_1\nhidden_2\n```';
		const state = stateWithFolds(doc, ['hidden']);
		expect(foldedRanges(reveal(state, state.doc.line(1).to)).size).toBe(0);
	});
});
