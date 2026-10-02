import { beforeAll, describe, expect, it } from 'vitest';
import { installStubDom, serializeChildren } from './testDom';
import { renderInlineInto, renderTableCellInto } from './tableCellInline';
import { parseTableCellLists, MAX_CELL_LIST_DEPTH, MAX_CELL_LIST_NODES, MAX_CELL_LIST_SOURCE } from './tableCellLists';
import { spreadsheetCellSource } from './spreadsheetClipboard';

let createElement: (tag: string) => HTMLElement;
beforeAll(() => { ({ createElement } = installStubDom()); });
const hooks = { resolveImageSrc: () => undefined };
const ul = (body: string) => `<ul class="mlp-cell-list">${body}</ul>`;
const li = (body: string) => `<li class="mlp-cell-list-item">${body}</li>`;
function render(source: string): string {
	const cell = createElement('td');
	renderTableCellInto(cell, source, hooks);
	return serializeChildren(cell);
}

describe('safe lists in table cells', () => {
	it('renders the reported whole-cell unordered list as distinct items', () => {
		expect(render('<ul><li>Confirm client context.</li><li>Resolve coverage gaps.</li></ul>'))
			.toBe(ul(li('Confirm client context.') + li('Resolve coverage gaps.')));
	});
	it('preserves prose surrounding multiple lists', () => {
		expect(render('Before <ul><li>One</li></ul> between <ul><li>Two</li></ul> after'))
			.toBe('Before ' + ul(li('One')) + ' between ' + ul(li('Two')) + ' after');
	});
	it('supports balanced nested unordered and ordered lists', () => {
		expect(render('<ul><li>Parent<ol><li>Child<ul><li>Leaf</li></ul></li></ol> tail</li><li>Sibling</li></ul>'))
			.toBe(ul(li('Parent<ol class="mlp-cell-list">' + li('Child' + ul(li('Leaf'))) + '</ol> tail') + li('Sibling')));
	});
	it('accepts uppercase attribute-free tags and whitespace between items', () => {
		expect(render('<UL > <LI >One</LI > \t <LI>Two</LI> </UL >')).toBe(ul(li('One') + li('Two')));
	});
	it('renders Markdown emphasis, code, escaped pipes, and line breaks inside each item', () => {
		expect(render('<ul><li>**Bold** and *italic*<br>`x\\|y`</li></ul>')).toBe(ul(li(
			'<strong class="mlp-strong">Bold</strong> and <em class="mlp-em">italic</em><br><code class="mlp-inline-code">x|y</code>',
		)));
	});
	it('keeps links inert until host navigation authorization and images blocked', () => {
		const result = render('<ul><li>[Run](command:evil) ![Tracker](https://example.invalid/pixel)</li></ul>');
		expect(result).toContain('data-href="command:evil"');
		expect(result).not.toContain(' href=');
		expect(result).not.toContain(' src=');
	});
	it('does not grant list parsing to ordinary inline rendering or link labels', () => {
		const source = '<ul><li>Literal</li></ul>';
		const inline = createElement('span');
		renderInlineInto(inline, source, { ...hooks, inTableCell: true });
		expect(serializeChildren(inline)).not.toContain('<ul');
		expect(render(`[${source}](note.md)`)).not.toContain('<ul');
		expect(render(`<ul><li>[${source}](note.md)</li></ul>`).match(/<ul /g)).toHaveLength(1);
	});

	for (const source of [
		'`<ul><li>Code</li></ul>`',
		'``<ul><li>`Code`</li></ul>``',
		'\\<ul><li>Escaped</li></ul>',
		'&lt;ul&gt;&lt;li&gt;Encoded&lt;/li&gt;&lt;/ul&gt;',
		'&#60;ul&#62;&#60;li&#62;Encoded&#60;/li&#62;&#60;/ul&#62;',
		'<!-- <ul><li>Comment</li></ul> -->',
		'**<ul><li>Inside emphasis</li></ul>**',
		spreadsheetCellSource('<ul><li>Clipboard literal</li></ul>'),
	]) it(`leaves a literal example inert: ${source.slice(0, 35)}`, () => {
		expect(parseTableCellLists(source)).toBeNull();
		expect(render(source)).not.toMatch(/<(?:ul|ol|li)(?:\s|>)/);
	});

	for (const source of [
		'<ul><li>Unclosed', '<ul><li>Unclosed</ul>', '<ul><li>Wrong</li></ol>',
		'<li>Orphan</li>', '<ul>Orphan text<li>Item</li></ul>',
		'<ul><ul><li>Missing parent item</li></ul></ul>',
		'<ul><li><li>Nested orphan</li></li></ul>', '<ul/><li>Void</li>',
		'<ul class="theme"><li>Styled</li></ul>', '<ul><li style="display:none">Hidden</li></ul>',
		'<ul onclick="alert(1)"><li>Event</li></ul>', '<ul><li data-href="command:evil">Data</li></ul>',
		'<ul><li>Invalid close</li onclick="alert(1)"></ul>',
	]) it(`falls back to source for unsupported or malformed structure: ${source.slice(0, 35)}`, () => {
		expect(parseTableCellLists(source)).toBeNull();
		expect(render(source)).not.toMatch(/<(?:ul|ol|li)(?:\s|>)/);
	});

	it('keeps unsupported active HTML literal inside otherwise valid list items', () => {
		const result = render('<ul><li><script>alert(1)</script><img src=x onerror=alert(1)><svg onload=alert(1)></svg></li></ul>');
		expect(result).toContain('<ul class="mlp-cell-list">');
		expect(result).toContain('&lt;script&gt;');
		expect(result).not.toMatch(/<(?:script|img|svg)\b/);
	});
	it('keeps escaped and code tags inside list items literal', () => {
		const result = render('<ul><li>`<ul><li>Example</li></ul>` and \\<li></li></ul>');
		expect(result.match(/<ul /g)).toHaveLength(1);
		expect(result.match(/<li /g)).toHaveLength(1);
		expect(result).toContain('<code class="mlp-inline-code">&lt;ul&gt;');
	});
	it('bounds total nodes, nesting, and source length without partial rendering', () => {
		const nested = (depth: number) => '<ul><li>'.repeat(depth) + 'Leaf' + '</li></ul>'.repeat(depth);
		expect(parseTableCellLists(nested(MAX_CELL_LIST_DEPTH / 2))).not.toBeNull();
		expect(parseTableCellLists(nested(MAX_CELL_LIST_DEPTH / 2 + 1))).toBeNull();
		expect(parseTableCellLists('<ul>' + '<li>x</li>'.repeat(MAX_CELL_LIST_NODES - 1) + '</ul>')).not.toBeNull();
		expect(parseTableCellLists('<ul>' + '<li>x</li>'.repeat(MAX_CELL_LIST_NODES) + '</ul>')).toBeNull();
		const oversized = '<ul><li>' + 'x'.repeat(MAX_CELL_LIST_SOURCE) + '</li></ul>';
		expect(parseTableCellLists(oversized)).toBeNull();
		expect(render(oversized)).not.toContain('<ul');
	});
});
