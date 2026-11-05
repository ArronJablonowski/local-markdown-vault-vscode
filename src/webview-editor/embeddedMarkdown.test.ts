import { beforeAll, describe, expect, it } from 'vitest';
import { renderEmbeddedMarkdown, splitEmbeddedTableRow } from './embeddedMarkdown';
import { installStubDom, serializeChildren } from './testDom';

describe('mixed embedded Markdown rendering', () => {
	let createElement: (tag: string) => HTMLElement;
	beforeAll(() => { ({ createElement } = installStubDom()); });
	const render = (source: string): string => {
		const parent = createElement('div');
		renderEmbeddedMarkdown(parent, source, { resolveImageSrc: () => undefined, renderNested: () => undefined });
		return serializeChildren(parent);
	};
	it.each(['\n', '\r\n', '\r'])('renders mixed content consistently across line ending %j', ending => {
		const source = '# **Meeting**\n\n- [x] **Done**\n\n> *Quoted*\n> continuation\n\n```text\nfirst\nlast\n```';
		expect(render(source.replace(/\n/g, ending))).toBe(render(source));
	});
	it.each([1, 2, 3, 4, 5, 6])('renders empty level %i ATX headings without exposing delimiter hashes', level => {
		const marker = '#'.repeat(level);
		expect(render(marker)).toBe(`<h${level}></h${level}>`);
		expect(render(`${marker} ${marker}`)).toBe(`<h${level}></h${level}>`);
	});
	it.each(['x', 'X', ' '])('renders read-only embedded tasks without losing formatted labels: [%s]', marker => {
		const html = render(`- [${marker}] **Review** and *confirm*`);
		expect(html).toContain('type="checkbox"');
		expect(html).toContain('disabled=""');
		expect(html.includes('checked=""')).toBe(marker !== ' ');
		expect(html).toContain('<strong class="mlp-strong">Review</strong> and <em class="mlp-em">confirm</em>');
		expect(html.includes('mlp-embed-task-complete')).toBe(marker !== ' ');
	});
	it.each([
		['> first **bold**\n> second *italic*', '<blockquote><p>first <strong class="mlp-strong">bold</strong>\nsecond <em class="mlp-em">italic</em></p></blockquote>'],
		['> > one\n> > two > three', '<blockquote><blockquote><p>one\ntwo &gt; three</p></blockquote></blockquote>'],
	])('removes only structural quote marks from multiline inline content: %s', (source, expected) => {
		expect(render(source)).toBe(expected);
	});
	it.each([
		['**Meeting**\n===', '<h1><strong class="mlp-strong">Meeting</strong></h1>'],
		['*Agenda*\n---', '<h2><em class="mlp-em">Agenda</em></h2>'],
		['[Notes](Notes.md)\n===', '<h1><a data-href="Notes.md" role="link" tabindex="0" class="mlp-link">Notes</a></h1>'],
		['> `Decision`\n> ---', '<blockquote><h2><code class="mlp-inline-code">Decision</code></h2></blockquote>'],
		['First line\nsecond **line**\n===', '<h1>First line\nsecond <strong class="mlp-strong">line</strong></h1>'],
	])('renders underline-style headings with their text and formatting: %s', (source, expected) => {
		expect(render(source)).toBe(expected);
	});
	it.each(['```js\n```', '~~~text\n~~~', '```js'])('renders an empty fence without leaking its delimiters: %s', source => {
		expect(render(source)).toBe('<pre><code></code></pre>');
	});
	it.each([
		['> ```js\n> first\n> second\n> ```', '<blockquote><pre><code>first\nsecond</code></pre></blockquote>'],
		['> ```\n> first\n>\n> second\n> ```', '<blockquote><pre><code>first\n\nsecond</code></pre></blockquote>'],
		['- ```js\n  first\n  second\n  ```', '<ul><li><pre><code>first\nsecond</code></pre></li></ul>'],
		['    first\n    second', '<pre><code>first\nsecond</code></pre>'],
		['>     first\n>     second', '<blockquote><pre><code>first\nsecond</code></pre></blockquote>'],
	])('retains every parser code segment in containers: %s', (source, expected) => {
		expect(render(source)).toBe(expected);
	});
	it.each([0, 3, 42, 999999999])('preserves ordered list start %i alongside inline formatting and nested bullets', start => {
		const html = render(`${start}. **Decision**\n${' '.repeat(String(start).length + 2)}- \`follow up\``);
		expect(html).toContain(`<ol start="${start}">`);
		expect(html).toContain('<ul><li><p><code class="mlp-inline-code">follow up</code></p></li></ul></li></ol>');
	});
});

describe('embedded table row parsing', () => {
	it('retains empty leading, middle, and trailing cells', () => {
		expect(splitEmbeddedTableRow('| | B | |')).toEqual([' ', ' B ', ' ']);
		expect(splitEmbeddedTableRow('A||C')).toEqual(['A', '', 'C']);
	});
	it('preserves a literal escaped pipe at the end of a borderless row', () => {
		expect(splitEmbeddedTableRow('left|right\\|')).toEqual(['left', 'right\\|']);
		expect(splitEmbeddedTableRow('|left|right\\|')).toEqual(['left', 'right\\|']);
	});
	it.each([1, 2, 3, 4, 5, 6])('honors a run of %i backslashes before a pipe', count => {
		const prefix = 'A' + '\\'.repeat(count);
		const row = prefix + '|B|C';
		expect(splitEmbeddedTableRow(row)).toEqual(count % 2 === 0 ? [prefix, 'B', 'C'] : [prefix + '|B', 'C']);
	});
	it('recognizes a trailing framing pipe only when it is unescaped', () => {
		expect(splitEmbeddedTableRow('| A | B\\\\|')).toEqual([' A ', ' B\\\\']);
		expect(splitEmbeddedTableRow('| A | B\\\\\\|')).toEqual([' A ', ' B\\\\\\|']);
	});
});
