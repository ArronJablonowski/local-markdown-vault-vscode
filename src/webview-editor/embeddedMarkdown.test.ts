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
	it.each(['```js\n```', '~~~text\n~~~', '```js'])('renders an empty fence without leaking its delimiters: %s', source => {
		expect(render(source)).toBe('<pre><code></code></pre>');
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
