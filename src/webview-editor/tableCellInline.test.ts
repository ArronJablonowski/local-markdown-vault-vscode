import { describe, it, expect, beforeAll } from 'vitest';
import { installStubDom, serializeChildren } from './testDom';
import { renderInlineInto } from './tableCellInline';
import { spreadsheetCellSource } from './spreadsheetClipboard';
import { resolveLinkTarget } from '../shared/linkTarget';

let createElement: (tag: string) => HTMLElement;

beforeAll(() => {
	({ createElement } = installStubDom());
});

const hooks = { resolveImageSrc: (src: string) => src };

/** Renders one cell's source and returns its inner HTML. */
function render(source: string): string {
	const cell = createElement('td');
	renderInlineInto(cell, source, hooks);
	return serializeChildren(cell);
}

describe('renderInlineInto', () => {
	it('applies table pipe rules inside formatted image descriptions only in tables', () => {
		const source = '![`x\\|y` and **label**](chart.png)';
		const cell = createElement('td');
		renderInlineInto(cell, source, { ...hooks, inTableCell: true });
		expect(serializeChildren(cell)).toContain('alt="x|y and label"');
		expect(render(source)).toContain('alt="x\\|y and label"');
	});
	it('distinguishes explicit empty destinations from unresolved references', () => {
		expect(render('[empty]()')).toContain('<a ');
		expect(render('![empty]()')).toContain('<img ');
	});
	it.each([
		['[missing]', '[missing]'],
		['![missing]', '![missing]'],
		['[**label**][missing]', '[<strong class="mlp-strong">label</strong>][missing]'],
		['![*label*][missing]', '![<em class="mlp-em">label</em>][missing]'],
		['[label][]', '[label][]'],
	])('preserves unresolved reference syntax instead of creating an empty target: %s', (source, expected) => {
		expect(render(source)).toBe(expected);
	});
	it('does not authorize image reference syntax without a resolved target', () => {
		const requests: string[] = [];
		const cell = createElement('td');
		renderInlineInto(cell, '![missing][reference]', { resolveImageSrc: src => { requests.push(src); return undefined; } });
		expect(requests).toEqual([]);
	});
	it.each([[128, 0x20ac], [133, 0x2026], [145, 0x2018], [146, 0x2019], [147, 0x201c], [148, 0x201d], [149, 0x2022], [159, 0x178]])(
		'decodes legacy numeric reference %i consistently with HTML text', (point, expected) => {
			const value = String.fromCodePoint(expected);
			expect(render(`**&#${point}; &#x${point.toString(16)};**`)).toBe(`<strong class="mlp-strong">${value} ${value}</strong>`);
		});
	it.each(['javascript:foo@bar.invalid', 'command:foo@bar.invalid', 'data:foo@bar.invalid'])('never converts an explicit blocked scheme into an email target: %s', href => {
		const cell = createElement('td');
		const seen: string[] = [];
		renderInlineInto(cell, `<${href}>`, { resolveImageSrc: () => undefined, resolveLinkHref: target => {
			seen.push(target); return resolveLinkTarget(target).kind === 'blocked' ? undefined : target;
		} });
		expect(seen).toEqual([href]);
		expect(serializeChildren(cell)).toContain('aria-disabled="true"');
		expect(serializeChildren(cell)).not.toContain('data-href=');
	});
	it.each([
		['<qa@example.invalid>', 'qa@example.invalid', 'mailto:qa@example.invalid'],
		['qa@example.invalid', 'qa@example.invalid', 'mailto:qa@example.invalid'],
		['www.example.invalid/path', 'www.example.invalid/path', 'https://www.example.invalid/path'],
		['<https://example.invalid>', 'https://example.invalid', 'https://example.invalid'],
	])('routes parser-confirmed autolinks without changing their visible labels: %s', (source, label, href) => {
		expect(render(`**${source}**`)).toBe(`<strong class="mlp-strong"><a data-href="${href}" role="link" tabindex="0" class="mlp-link">${label}</a></strong>`);
	});
	it.each([
		['![**Bold** and *italic* with `code`](chart.png)', 'Bold and italic with code'],
		['![outer ![inner](nested.png) label](chart.png)', 'outer inner label'],
		['![\\*literal\\* <b>label</b>](chart.png)', '*literal* label'],
	])('uses plain formatted text for image accessibility labels: %s', (source, alt) => {
		expect(render(source)).toContain(`alt="${alt}"`);
	});
	it('does not authorize or fetch images nested inside an image description', () => {
		const resolved: string[] = [];
		const cell = createElement('td');
		renderInlineInto(cell, '![outer ![inner](nested.png)](chart.png)', {
			resolveImageSrc: src => { resolved.push(src); return undefined; },
		});
		expect(resolved).toEqual(['chart.png']);
		expect(serializeChildren(cell)).toContain('alt="outer inner"');
	});
	it('bounds deeply nested image descriptions without requesting nested resources', () => {
		let source = 'leaf';
		for (let depth = 0; depth < 80; depth++) source = `![${source}](nested.png)`;
		const resolved: string[] = [];
		const cell = createElement('td');
		renderInlineInto(cell, source, { resolveImageSrc: src => { resolved.push(src); return undefined; } });
		expect(resolved).toEqual(['nested.png']);
		expect(serializeChildren(cell)).toContain('leaf');
	});
	it.each([
		['"Review \\"quoted\\" notes"', 'Review &quot;quoted&quot; notes'],
		["'Review \\'quoted\\' notes'", "Review 'quoted' notes"],
		['(Review \\(draft\\) notes)', 'Review (draft) notes'],
	])('decodes punctuation escapes in link and image titles: %s', (title, expected) => {
		expect(render(`[**Notes**](Notes.md ${title})`)).toContain(`title="${expected}"`);
		expect(render(`![Chart](chart.png ${title})`)).toContain(`title="${expected}"`);
	});
	it.each(['first  \nsecond', 'first\\\nsecond'])('renders explicit Markdown line breaks inside mixed inline formatting: %s', source => {
		expect(render(`**${source}**`)).toBe('<strong class="mlp-strong">first<br>second</strong>');
		expect(render(`[${source}](Notes.md)`)).toBe('<a data-href="Notes.md" role="link" tabindex="0" class="mlp-link">first<br>second</a>');
	});
	it('keeps soft line breaks and code-span whitespace distinct from hard breaks', () => {
		expect(render('first\nsecond')).toBe('first\nsecond');
		expect(render('`first  \nsecond`')).toBe('<code class="mlp-inline-code">first   second</code>');
	});
	it('preserves spreadsheet spaces, tabs, Unicode, and real multiline cell breaks', () => {
		expect(render(spreadsheetCellSource('  A\t\r\nB 🙂 '))).toBe('  A\t<br>B 🙂 ');
	});
	it('renders numeric references as text only, never as active HTML', () => {
		expect(render('&#60;img src=x onerror=alert(1)&#62;')).toBe('&lt;img src=x onerror=alert(1)&gt;');
		expect(render('&#x1f642; &#0; &#xD800; &#1114112;')).toBe('🙂 � � �');
	});
	it('does not decode original spreadsheet entity-looking text twice', () => {
		expect(render(spreadsheetCellSource('&#32; &amp; <br>'))).toBe('&amp;#32; &amp;amp; &lt;br&gt;');
	});
	it('keeps spreadsheet formulas, links, Markdown, and HTML literal', () => {
		for (const value of ['=SUM(A1:B2)', '**bold**', '[[note]]', '[run](command:evil)', 'https://example.invalid', '$x$']) {
			expect(render(spreadsheetCellSource(value))).toBe(value);
		}
		expect(render(spreadsheetCellSource('<script>alert(1)</script>'))).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
	});
	it('decodes only escaped pipes in table code, without changing ordinary code', () => {
		const source = '`x\\|y \\*literal\\*`';
		const table = createElement('td');
		renderInlineInto(table, source, { ...hooks, inTableCell: true });
		expect(serializeChildren(table)).toBe('<code class="mlp-inline-code">x|y \\*literal\\*</code>');
		expect(render(source)).toBe('<code class="mlp-inline-code">x\\|y \\*literal\\*</code>');
	});
	it('leaves plain text alone', () => {
		expect(render('hello world')).toBe('hello world');
	});

	it('renders an empty cell as nothing', () => {
		expect(render('')).toBe('');
	});

	// Each expectation below matches what a reference GFM renderer (markdown-it,
	// the engine behind VS Code's built-in Markdown preview) produces for the
	// same cell source — the regex-based renderer this replaced got every one of
	// them wrong.
	describe('GFM parity', () => {
		it.each([
			['` padded `', 'padded'],
			['`` `literal` ``', '`literal`'],
			['`  `', '  '],
			['` left`', ' left'],
			['`right `', 'right '],
			['`one\ntwo`', 'one two'],
		])('normalizes code-span whitespace in mixed emphasis: %s', (source, expected) => {
			expect(render(`**${source}**`)).toBe(`<strong class="mlp-strong"><code class="mlp-inline-code">${expected}</code></strong>`);
		});
		it('renders bold and italic together', () => {
			expect(render('***bi***')).toBe('<em class="mlp-em"><strong class="mlp-strong">bi</strong></em>');
		});

		it('renders emphasis nested inside strong emphasis', () => {
			expect(render('**a *b* c**')).toBe('<strong class="mlp-strong">a <em class="mlp-em">b</em> c</strong>');
		});

		it('does not treat a spaced asterisk inside bold as emphasis', () => {
			expect(render('**2 * 3**')).toBe('<strong class="mlp-strong">2 * 3</strong>');
		});

		it('does not treat spaced asterisks as emphasis at all', () => {
			expect(render('a * b * c')).toBe('a * b * c');
		});

		it('recognizes underscore emphasis', () => {
			expect(render('_em_ and __strong__')).toBe(
				'<em class="mlp-em">em</em> and <strong class="mlp-strong">strong</strong>',
			);
		});

		it('renders an image, not a link with a stray "!"', () => {
			expect(render('![alt](img.png)')).toBe('<img src="img.png" alt="alt" class="mlp-image mlp-table-image">');
		});

		it('keeps the inner backtick of a multi-backtick code span', () => {
			expect(render('``a`b``')).toBe('<code class="mlp-inline-code">a`b</code>');
		});

		it('renders a link that carries a title', () => {
			expect(render('[t](http://x.com "ti")')).toBe(
				'<a title="ti" data-href="http://x.com" role="link" tabindex="0" class="mlp-link">t</a>',
			);
		});

		it('renders a link nested inside strong emphasis', () => {
			expect(render('**[t](u)**')).toBe(
				'<strong class="mlp-strong"><a data-href="u" role="link" tabindex="0" class="mlp-link">t</a></strong>',
			);
		});

		it('renders emphasis nested inside a link label', () => {
			expect(render('[**b** t](u)')).toBe(
				'<a data-href="u" role="link" tabindex="0" class="mlp-link"><strong class="mlp-strong">b</strong> t</a>',
			);
		});

		it('honours backslash escapes instead of rendering emphasis', () => {
			expect(render('\\*not em\\*')).toBe('*not em*');
		});

		it('escapes bare angle brackets and ampersands rather than injecting markup', () => {
			expect(render('1 < 2 & 3')).toBe('1 &lt; 2 &amp; 3');
		});

		it('renders strikethrough', () => {
			expect(render('~~s~~')).toBe('<del class="mlp-strikethrough">s</del>');
		});

		it('renders inline code literally, without interpreting its markup', () => {
			expect(render('`**not bold**`')).toBe('<code class="mlp-inline-code">**not bold**</code>');
		});

		it('mixes code spans and emphasis in one cell', () => {
			expect(render('`a` and **b**')).toBe(
				'<code class="mlp-inline-code">a</code> and <strong class="mlp-strong">b</strong>',
			);
		});
	});

	describe('inline HTML', () => {
		it('renders a bare <br> as a line break in a table cell', () => {
			expect(render('x<br>y')).toBe('x<br>y');
		});

		it('supports self-closing and case-insensitive line breaks', () => {
			expect(render('x<br/>y')).toBe('x<br>y');
			expect(render('x<BR />y')).toBe('x<br>y');
		});

		it('does not accept HTML attributes on line breaks', () => {
			expect(render('x<br onclick="alert(1)">y')).toBe('x&lt;br onclick="alert(1)"&gt;y');
		});

		it('shows any other tag literally rather than injecting it into the webview', () => {
			// A cell must never be able to smuggle arbitrary markup into the DOM.
			expect(render('<b>x</b>')).toBe('&lt;b&gt;x&lt;/b&gt;');
			expect(render('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
		});
	});

	describe('links', () => {
		it('normalizes angle-wrapped and punctuation-escaped link destinations', () => {
			expect(render('[Notes](<Notes/Meeting notes.md>)')).toContain('data-href="Notes/Meeting notes.md"');
			expect(render('[Draft](Notes/Topic\\(draft\\).md)')).toContain('data-href="Notes/Topic(draft).md"');
		});

		it('normalizes image destinations before calling the authorization hook', () => {
			const cell = createElement('td');
			const requested: string[] = [];
			renderInlineInto(cell, '![Chart](<Assets/Chart \\(draft\\).png>)', {
				resolveImageSrc: src => { requested.push(src); return 'authorized-image'; },
			});
			expect(requested).toEqual(['Assets/Chart (draft).png']);
		});

		it('marks a link with data-href so the editor\'s ctrl-click handler finds it', () => {
			const cell = createElement('td');
			renderInlineInto(cell, '[t](http://x.com)', hooks);
			expect(serializeChildren(cell)).toContain('data-href="http://x.com"');
		});

		it('promotes a bare URL to a link', () => {
			expect(render('https://x.com')).toBe('<a data-href="https://x.com" role="link" tabindex="0" class="mlp-link">https://x.com</a>');
		});

		it('resolves a relative image path through the provided hook', () => {
			const cell = createElement('td');
			renderInlineInto(cell, '![a](p.png)', { resolveImageSrc: (src) => `base://${src}` });
			expect(serializeChildren(cell)).toBe('<img src="base://p.png" alt="a" class="mlp-image mlp-table-image">');
		});
	});
});
