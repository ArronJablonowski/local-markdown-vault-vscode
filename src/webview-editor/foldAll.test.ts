import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { collectCollapsibleObjects } from './foldAll';
import { calloutState, toggleCallout } from './calloutState';
import { setDiagramRenderingAllowed } from './diagramLang';
import { GFM } from './gfmTableFix';

function parsedState(doc: string): EditorState {
	const state = EditorState.create({ doc, extensions: [markdown({ extensions: GFM }), calloutState] });
	if (!ensureSyntaxTree(state, state.doc.length, 5000)) throw new Error('Markdown did not finish parsing');
	// Publish any parsing work beyond the initial viewport, as forceParsing does.
	return state.update({}).state;
}

function codeLines(count: number, prefix = ''): string[] {
	return Array.from({ length: count }, (_, index) => `${prefix}line ${index + 1}`);
}

afterEach(() => setDiagramRenderingAllowed(true));

describe('fold-all code targets', () => {
	it.each([7, 8, 9])('requires eight body lines in a closed fence with %i lines', count => {
		const doc = ['Before', '', '```typescript', ...codeLines(count), '```', '', 'After'].join('\n');
		const state = parsedState(doc);
		expect(collectCollapsibleObjects(state)).toEqual(count < 8 ? [] : [{
			kind: 'code', from: doc.indexOf('\nline 2'),
			to: doc.indexOf('\n```', doc.indexOf('line 1')), anchor: doc.indexOf('line 1'),
		}]);
	});

	it.each([7, 8, 9])('counts all body lines in an unclosed fence with %i lines', count => {
		const doc = ['~~~text', ...codeLines(count)].join('\n');
		expect(collectCollapsibleObjects(parsedState(doc))).toEqual(count < 8 ? [] : [{
			kind: 'code', from: doc.indexOf('\nline 2'), to: doc.length, anchor: doc.indexOf('line 1'),
		}]);
	});

	it.each([7, 8, 9])('counts indented code by its actual %i source lines', count => {
		const doc = ['Before', '', ...codeLines(count, '    '), '', 'After'].join('\n');
		expect(collectCollapsibleObjects(parsedState(doc))).toEqual(count < 8 ? [] : [{
			kind: 'code', from: doc.indexOf('\n    line 2'),
			to: doc.indexOf('\n\nAfter'), anchor: doc.indexOf('    line 1'),
		}]);
	});

	it('uses the grammar closing mark and keeps a shorter fence inside the body', () => {
		const doc = ['````text', 'line 1', '```', ...codeLines(6), '`````', '', 'After'].join('\n');
		expect(collectCollapsibleObjects(parsedState(doc))).toEqual([{
			kind: 'code', from: doc.indexOf('\n```'), to: doc.indexOf('\n`````'), anchor: doc.indexOf('line 1'),
		}]);
	});

	it('keeps a mismatched closing fence as the final line of an unclosed block', () => {
		const doc = ['```text', ...codeLines(7), '~~~'].join('\n');
		expect(collectCollapsibleObjects(parsedState(doc))).toEqual([{
			kind: 'code', from: doc.indexOf('\nline 2'), to: doc.length, anchor: doc.indexOf('line 1'),
		}]);
	});

	it('collects code nested in a list with its source indentation intact', () => {
		const doc = ['- Item', '', '  ```text', ...codeLines(8, '  '), '  ```', '', 'After'].join('\n');
		expect(collectCollapsibleObjects(parsedState(doc))).toEqual([{
			kind: 'code', from: doc.indexOf('\n  line 2'),
			to: doc.indexOf('\n  ```', doc.indexOf('line 1')), anchor: doc.indexOf('  line 1'),
		}]);
	});
});

describe('fold-all callout targets', () => {
	it('collects nested callouts and code even while both parents are authored collapsed', () => {
		const doc = ['Before', '', '> [!note]- Outer', '> Outer body', '>', '> > [!tip]- Inner', '> >',
			'> > ```text', ...codeLines(8, '> > '), '> > ```', '', 'After'].join('\n');
		const outer = doc.indexOf('> [!note]');
		const inner = doc.indexOf('> > [!tip]');
		const end = doc.indexOf('\n\nAfter');
		expect(collectCollapsibleObjects(parsedState(doc))).toEqual([
			{ kind: 'callout', header: outer, from: doc.indexOf('> Outer body'), to: end, anchor: outer, defaultCollapsed: true },
			{ kind: 'callout', header: inner, from: doc.indexOf('> >\n', inner), to: end, anchor: inner, defaultCollapsed: true },
			{ kind: 'code', from: doc.indexOf('\n> > line 2'), to: doc.indexOf('\n> > ```', doc.indexOf('line 1')),
				anchor: doc.indexOf('> > line 1') },
		]);
	});

	it.each([['-', true], ['+', false], ['', false]] as const)('honors the authored %j callout marker', (marker, collapsed) => {
		const doc = `> [!warning]${marker} Title\n> Body`;
		const state = parsedState(doc);
		expect(collectCollapsibleObjects(state)).toEqual([{
			kind: 'callout', header: 0, from: doc.indexOf('> Body'), to: doc.length, anchor: 0, defaultCollapsed: collapsed,
		}]);
		expect(state.doc.toString()).toBe(doc);
	});

	it('reads presentation overrides without rewriting the authored callout marker', () => {
		const doc = '> [!note]- Title\n> Body';
		const initial = parsedState(doc);
		const expanded = initial.update({ effects: toggleCallout.of({ from: 0, collapsed: false }) }).state;
		expect(collectCollapsibleObjects(expanded)).toEqual([{
			kind: 'callout', header: 0, from: doc.indexOf('> Body'), to: doc.length, anchor: 0, defaultCollapsed: false,
		}]);
		expect(expanded.doc.toString()).toBe(doc);
		expect(initial.field(calloutState).size).toBe(0);
	});

	it('does not promote literal callout text in fenced or indented code', () => {
		const doc = ['```text', '> [!note]- Fenced literal', '```', '', '    > [!tip]- Indented literal',
			'', '\\> [!warning]- Escaped quote', '', '`> [!danger]- Inline literal`'].join('\n');
		expect(collectCollapsibleObjects(parsedState(doc))).toEqual([]);
	});

	it('does not promote ordinary quotes or callout-like table and heading text', () => {
		const doc = ['> Ordinary quote', '> [!note]- Later in the paragraph', '', '# > [!tip]- Heading', '',
			'| Literal |', '| --- |', '| > [!warning]- Table |'].join('\n');
		expect(collectCollapsibleObjects(parsedState(doc))).toEqual([]);
	});
});

describe('fold-all rendered-object exclusions', () => {
	it('excludes code and callout syntax inside frontmatter while retaining later targets', () => {
		const doc = ['---', '> [!note]- Property literal', '> Body', '', '```text', ...codeLines(8), '```',
			'---', '', '> [!tip]+ Real callout', '> Real body'].join('\n');
		const header = doc.indexOf('> [!tip]');
		expect(collectCollapsibleObjects(parsedState(doc))).toEqual([{
			kind: 'callout', header, from: doc.indexOf('> Real body'), to: doc.length, anchor: header, defaultCollapsed: false,
		}]);
	});

	it.each(['mermaid', 'drawio', 'diagrams.net', 'diagramsnet', 'mxgraph', 'MERMAID'])('excludes rendered %s fences', language => {
		const doc = ['```' + language, ...codeLines(8), '```'].join('\n');
		expect(collectCollapsibleObjects(parsedState(doc))).toEqual([]);
	});

	it.each(['mermaid', 'drawio', 'diagrams.net', 'diagramsnet', 'mxgraph'])('includes inert %s source in Restricted Mode', language => {
		setDiagramRenderingAllowed(false);
		const doc = ['```' + language, ...codeLines(8), '```'].join('\n');
		expect(collectCollapsibleObjects(parsedState(doc))).toEqual([{
			kind: 'code', from: doc.indexOf('\nline 2'), to: doc.lastIndexOf('\n```'), anchor: doc.indexOf('line 1'),
		}]);
	});

	it('always includes ordinary XML fences', () => {
		const doc = ['```xml', ...codeLines(8), '```'].join('\n');
		expect(collectCollapsibleObjects(parsedState(doc))).toEqual([{
			kind: 'code', from: doc.indexOf('\nline 2'), to: doc.lastIndexOf('\n```'), anchor: doc.indexOf('line 1'),
		}]);
	});

	it('includes diagram source attached to a list marker when it cannot become a diagram widget', () => {
		const doc = ['- ```mermaid', '  flowchart LR', '  A-->B', '  B-->C', '  C-->D',
			'  D-->E', '  E-->F', '  F-->G', '  G-->H', '  ```'].join('\n');
		expect(collectCollapsibleObjects(parsedState(doc))).toEqual([{
			kind: 'code', from: doc.indexOf('\n  A-->B'), to: doc.lastIndexOf('\n  ```'), anchor: doc.indexOf('  flowchart LR'),
		}]);
	});

	it('includes an empty diagram fence that has no rendered widget', () => {
		const doc = ['```mermaid', ...Array(8).fill(''), '```'].join('\n');
		expect(collectCollapsibleObjects(parsedState(doc))).toEqual([{
			kind: 'code', from: '```mermaid\n'.length, to: doc.lastIndexOf('\n```'), anchor: '```mermaid\n'.length,
		}]);
	});

	it('re-evaluates the same document after the diagram policy changes', () => {
		const state = parsedState(['```mermaid', ...codeLines(8), '```'].join('\n'));
		expect(collectCollapsibleObjects(state)).toEqual([]);
		setDiagramRenderingAllowed(false);
		expect(collectCollapsibleObjects(state)).toHaveLength(1);
		setDiagramRenderingAllowed(true);
		expect(collectCollapsibleObjects(state)).toEqual([]);
	});
});

describe('fold-all collection limits', () => {
	it('accepts 10,000 objects but rejects an additional target instead of returning a partial collection', () => {
		const callout = '> [!note] Title\n> Body';
		const allowed = parsedState(Array(10_000).fill(callout).join('\n\n'));
		expect(collectCollapsibleObjects(allowed)).toHaveLength(10_000);
		const excessive = parsedState(allowed.doc.toString() + '\n\n' + callout);
		expect(() => collectCollapsibleObjects(excessive)).toThrow('Fold target limit');
	});
});
