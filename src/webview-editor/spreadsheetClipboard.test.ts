import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { renderTableMarkdown, type TableEditModel } from './tableEdit';
import {
	MAX_SPREADSHEET_CELLS, MAX_SPREADSHEET_COLUMNS, MAX_SPREADSHEET_INPUT_BYTES,
	MAX_SPREADSHEET_OUTPUT_BYTES, MAX_SPREADSHEET_ROWS,
	parseSpreadsheetClipboard, pasteSpreadsheetCells, spreadsheetCellSource,
} from './spreadsheetClipboard';

const table = (rows: string[][]) => ({ kind: 'table', rows });
const model = (overrides: Partial<TableEditModel> = {}): TableEditModel => ({
	rows: [['Name', 'Value'], ['Keep **source**', 'Original']],
	headerRowCount: 1, align: ['left', 'right'], indent: '> ', ...overrides,
});

describe('parseSpreadsheetClipboard', () => {
	it('prefers tabs over commas and preserves empty boundary cells', () => {
		expect(parseSpreadsheetClipboard('\tfirst, last\t\n\tsecond\t')).toEqual(table([['', 'first, last', ''], ['', 'second', '']]));
	});
	it('recognizes rectangular multirow CSV', () => {
		expect(parseSpreadsheetClipboard('name,value\nalpha,42')).toEqual(table([['name', 'value'], ['alpha', '42']]));
	});
	it('recognizes quoted CSV Markdown and multiline syntax as literal values', () => {
		expect(parseSpreadsheetClipboard('Name,Value\n"**bold**",x')).toEqual(table([['Name', 'Value'], ['**bold**', 'x']]));
		expect(parseSpreadsheetClipboard('Name,Value\n"line\n# heading\n| --- | --- |",x'))
			.toEqual(table([['Name', 'Value'], ['line\n# heading\n| --- | --- |', 'x']]));
		expect(parseSpreadsheetClipboard('"**Header**",Value\n"Said ""**bold**""",x'))
			.toEqual(table([['**Header**', 'Value'], ['Said "**bold**"', 'x']]));
	});
	it('does not mistake a tab inside a quoted CSV value for TSV', () => {
		expect(parseSpreadsheetClipboard('Name,Value\n"tab\tinside",x')).toEqual(table([['Name', 'Value'], ['tab\tinside', 'x']]));
	});
	it('keeps unquoted later Markdown blocks as ordinary text', () => {
		expect(parseSpreadsheetClipboard('Name,Value\n- Bullet,item')).toEqual({ kind: 'text' });
	});
	it.each(['   |    :---: | --- |', '    :---: | --- |', '|---|---|', '---|---'])('keeps Markdown delimiter rows as ordinary text: %s', delimiter => {
		expect(parseSpreadsheetClipboard(`Name,Value\n${delimiter}`)).toEqual({ kind: 'text' });
	});
	it('bounds recognition time for a 200,000-space non-table CSV prefix', () => {
		// Run out of process so a reintroduced catastrophic regex cannot freeze
		// the test runner itself. Supported CI runtimes natively strip this file's
		// sole type-only import, keeping the regression on the real parser.
		const source = new URL('./spreadsheetClipboard.ts', import.meta.url).href;
		const program = `
			import { parseSpreadsheetClipboard } from ${JSON.stringify(source)};
			const start = performance.now();
			const result = parseSpreadsheetClipboard('Name,Value\\n' + ' '.repeat(200000) + 'X,Y');
			console.log(JSON.stringify({ kind: result.kind, length: result.kind === 'table' ? result.rows[1][0].length : 0, elapsed: performance.now() - start }));
		`;
		const child = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8', timeout: 2000 });
		expect(child.error).toBeUndefined();
		expect(child.status, child.stderr).toBe(0);
		const result = JSON.parse(child.stdout);
		expect(result).toMatchObject({ kind: 'table', length: 200001 });
		expect(result.elapsed).toBeLessThan(1500);
	});
	it.each(['One, sentence.', 'One, sentence.\nA paragraph without commas.', 'No delimiters', '', '**bold**,text\nnext,row', '# Header, two\nnext,row', '- List, item\nnext,row', '> Quote, item\nnext,row', '[link](local.md),text\nnext,row', '| A, B | C |\n| --- | --- |\n| D, E | F |', '```csv\nA,B\n1,2\n```', '```text\nA\tB\n```'])('preserves ordinary Markdown/prose in auto mode: %j', value => {
		expect(parseSpreadsheetClipboard(value)).toEqual({ kind: 'text' });
	});
	it.each(['csv', 'tsv'] as const)('accepts explicit %s with one row or column', mime => {
		expect(parseSpreadsheetClipboard('only one cell', mime)).toEqual(table([['only one cell']]));
		expect(parseSpreadsheetClipboard('', mime)).toEqual(table([['']]));
		expect(parseSpreadsheetClipboard('first\nsecond\n', mime)).toEqual(table([['first'], ['second']]));
	});
	it('does not interpret explicit CSV tabs as separators', () => {
		expect(parseSpreadsheetClipboard('a\tb,c', 'csv')).toEqual(table([['a\tb', 'c']]));
	});
	it('allows literal Markdown in explicitly declared spreadsheet cells', () => {
		expect(parseSpreadsheetClipboard('**bold**,text\nnext,row', 'csv')).toEqual(table([['**bold**', 'text'], ['next', 'row']]));
	});
	it('handles BOM, CRLF, quoted commas, doubled quotes, and in-cell line breaks', () => {
		expect(parseSpreadsheetClipboard('\ufeff"first,name","a ""quote"""\r\n"line 1\r\nline 2",tail\r\n', 'csv'))
			.toEqual(table([['first,name', 'a "quote"'], ['line 1\r\nline 2', 'tail']]));
	});
	it('allows quoted tabs and in-cell newlines in TSV', () => {
		expect(parseSpreadsheetClipboard('"a\tb"\t"one\ntwo"\nlast\t', 'tsv')).toEqual(table([['a\tb', 'one\ntwo'], ['last', '']]));
	});
	it('keeps interior quotes and Markdown/HTML-looking TSV values literal', () => {
		expect(parseSpreadsheetClipboard('**bold**\t<img src="https://example.com/pixel">\nsay "hi"\t[x](command:run)'))
			.toEqual(table([['**bold**', '<img src="https://example.com/pixel">'], ['say "hi"', '[x](command:run)']]));
	});
	it('preserves empty rows but ignores one terminal record separator', () => {
		expect(parseSpreadsheetClipboard('a,b\r\n\r\nc,d\r\n', 'csv')).toEqual(table([['a', 'b'], ['', ''], ['c', 'd']]));
		expect(parseSpreadsheetClipboard('a,b,', 'csv')).toEqual(table([['a', 'b', '']]));
	});
	it('pads ragged TSV and explicit CSV only after dimension checks', () => {
		expect(parseSpreadsheetClipboard('a\tb\tc\nd\te')).toEqual(table([['a', 'b', 'c'], ['d', 'e', '']]));
		expect(parseSpreadsheetClipboard('a,b,c\nd,e', 'csv')).toEqual(table([['a', 'b', 'c'], ['d', 'e', '']]));
		expect(parseSpreadsheetClipboard('a,b,c\nd,e')).toEqual({ kind: 'text' });
	});
	it.each(['"unfinished', 'abc"def,x', '"closed"junk,x', '"closed" ,x', '"a""', '"a"\tb,c'])('rejects malformed explicit quoting: %j', value => {
		expect(parseSpreadsheetClipboard(value, 'csv')).toEqual({ kind: 'invalid', reason: 'malformed' });
	});
	it('rejects a malformed automatic candidate instead of returning partial records', () => {
		expect(parseSpreadsheetClipboard('a,b\n"unfinished,c')).toEqual({ kind: 'invalid', reason: 'malformed' });
	});
	it('bounds actual UTF-8 input bytes, not UTF-16 string length', () => {
		expect(parseSpreadsheetClipboard('é'.repeat(MAX_SPREADSHEET_INPUT_BYTES / 2), 'csv').kind).toBe('table');
		expect(parseSpreadsheetClipboard('é'.repeat(MAX_SPREADSHEET_INPUT_BYTES / 2 + 1), 'csv')).toEqual({ kind: 'invalid', reason: 'tooLarge' });
		expect(parseSpreadsheetClipboard('x'.repeat(MAX_SPREADSHEET_INPUT_BYTES + 1), 'csv')).toEqual({ kind: 'invalid', reason: 'tooLarge' });
	});
	it('bounds rows, columns, and rectangular cells before padding', () => {
		expect(parseSpreadsheetClipboard('x\n'.repeat(MAX_SPREADSHEET_ROWS), 'csv').kind).toBe('table');
		expect(parseSpreadsheetClipboard('x\n'.repeat(MAX_SPREADSHEET_ROWS + 1), 'csv')).toEqual({ kind: 'invalid', reason: 'tooLarge' });
		expect(parseSpreadsheetClipboard(','.repeat(MAX_SPREADSHEET_COLUMNS), 'csv')).toEqual({ kind: 'invalid', reason: 'tooLarge' });
		const wide = Array(MAX_SPREADSHEET_COLUMNS).fill('x').join(',');
		expect(parseSpreadsheetClipboard(Array(MAX_SPREADSHEET_CELLS / MAX_SPREADSHEET_COLUMNS).fill(wide).join('\n'), 'csv').kind).toBe('table');
		expect(parseSpreadsheetClipboard(wide + '\n' + 'x\n'.repeat(50), 'csv')).toEqual({ kind: 'invalid', reason: 'tooLarge' });
	});
	it('round-trips deterministic combinations of quoted punctuation and Unicode', () => {
		const values = ['', 'x,y', 'line\r\nbreak', 'tab\tinside', '"double"', '😀 café', '<script>', '\\|', '**literal**'];
		for (let seed = 0; seed < 40; seed++) {
			const rows = Array.from({ length: 4 }, (_, r) => Array.from({ length: 3 }, (_, c) => values[(seed + 3 * r + c) % values.length]));
			const source = rows.map(cells => cells.map(value => `"${value.replace(/"/g, '""')}"`).join(',')).join('\r\n');
			expect(parseSpreadsheetClipboard(source, 'csv')).toEqual(table(rows));
		}
	});
	it('round-trips 200 seeded randomized CSV and TSV grids including boundary whitespace', () => {
		let seed = 0x5eed;
		const random = (maximum: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % maximum; };
		const alphabet = ['a', ',', '\t', '\n', '\r', '"', ' ', '\\', '|', '&', '<', '😀', '\u00a0'];
		for (let trial = 0; trial < 200; trial++) {
			const width = random(6) + 1;
			const rows = Array.from({ length: random(8) + 1 }, () => Array.from({ length: width }, () =>
				Array.from({ length: random(20) }, () => alphabet[random(alphabet.length)]).join('')));
			for (const mime of ['csv', 'tsv'] as const) {
				const source = rows.map(cells => cells.map(value => `"${value.replace(/"/g, '""')}"`).join(mime === 'csv' ? ',' : '\t')).join('\r\n');
				expect(parseSpreadsheetClipboard(source, mime)).toEqual(table(rows));
			}
		}
	});
});

describe('spreadsheetCellSource', () => {
	it('escapes all 32 ASCII punctuation characters including literal backslashes', () => {
		const punctuation = Array.from({ length: 94 }, (_, i) => String.fromCharCode(i + 33)).filter(char => !/[a-z0-9]/i.test(char));
		expect(punctuation).toHaveLength(32);
		expect(spreadsheetCellSource(punctuation.join(''))).toBe(punctuation.map(char => '\\' + char).join(''));
	});
	it('does not enable HTML, entities, links, image tracking, math, or code', () => {
		expect(spreadsheetCellSource('<img src="https://example.com/pixel"> &amp; $x$ **bold** `code` [go](command:x)'))
			.toBe('\\<img src\\=\\"https\\:\\/\\/example\\.com\\/pixel\\"\\> \\&amp\\; \\$x\\$ \\*\\*bold\\*\\* \\`code\\` \\[go\\]\\(command\\:x\\)');
	});
	it('only generates bare line breaks while preserving authored HTML as text', () => {
		expect(spreadsheetCellSource('one\r\ntwo\rthree\nfour<br>')).toBe('one<br>two<br>three<br>four\\<br\\>');
	});
	it('preserves spaces, tabs, Unicode, and literal escape sequences', () => {
		expect(spreadsheetCellSource(' café\t😀 a\\|b ')).toBe('&#32;café\t😀 a\\\\\\|b&#32;');
	});
	it('protects boundary whitespace from Markdown cell trimming without decoding input entities', () => {
		expect(spreadsheetCellSource('\t  data \u00a0')).toBe('&#9;&#32;&#32;data&#32;&#160;');
		expect(spreadsheetCellSource(' \r\n ')).toBe('&#32;<br>&#32;');
		expect(spreadsheetCellSource('&#32;')).toBe('\\&\\#32\\;');
		expect(spreadsheetCellSource('  ')).toBe('&#32;&#32;');
	});
});

describe('pasteSpreadsheetCells', () => {
	it('changes only the target rectangle and preserves untouched authored Markdown', () => {
		const before = model(); const snapshot = structuredClone(before);
		const result = pasteSpreadsheetCells(before, [['**literal**']], 1, 1);
		expect(result.rows).toEqual([['Name', 'Value'], ['Keep **source**', '\\*\\*literal\\*\\*']]);
		expect(result.align).toEqual(['left', 'right']);
		expect(result.indent).toBe('> '); expect(result.headerRowCount).toBe(1);
		expect(before).toEqual(snapshot); expect(result.rows).not.toBe(before.rows);
		expect(result.rows[0]).not.toBe(before.rows[0]); expect(result.align).not.toBe(before.align);
	});
	it('expands a table with null alignment and empty gap cells', () => {
		const result = pasteSpreadsheetCells(model(), [['a', 'b'], ['c', 'd']], 2, 2);
		expect(result.rows).toEqual([['Name', 'Value', '', ''], ['Keep **source**', 'Original', '', ''], ['', '', 'a', 'b'], ['', '', 'c', 'd']]);
		expect(result.align).toEqual(['left', 'right', null, null]);
	});
	it('can create a new table from an empty model', () => {
		const result = pasteSpreadsheetCells(model({ rows: [], align: [], indent: '' }), [['H1', 'H2'], ['a', 'b']], 0, 0);
		expect(renderTableMarkdown(result)).toBe('| H1 | H2 |\n| --- | --- |\n| a | b |');
	});
	it('keeps hidden overflow source cells and replaces empty ragged input cells', () => {
		const before = model({ rows: [['H1', 'H2'], ['A', 'B', '**hidden**'], ['C', 'D', 'extra']] });
		const result = pasteSpreadsheetCells(before, [['x', 'y'], ['z']], 1, 0);
		expect(result.rows).toEqual([['H1', 'H2'], ['x', 'y', '**hidden**'], ['z', '', 'extra']]);
		expect(renderTableMarkdown(result)).toContain('| x | y | **hidden** |');
	});
	it('serializes literal pipes and newlines without adding unintended rows or columns', () => {
		const result = pasteSpreadsheetCells(model({ indent: '' }), [['a||b', 'one\ntwo\\|three']], 1, 0);
		expect(renderTableMarkdown(result)).toBe('| Name | Value |\n| :--- | ---: |\n| a\\|\\|b | one<br>two\\\\\\|three |');
	});
	it('preserves boundary whitespace through Markdown serialization', () => {
		const result = pasteSpreadsheetCells(model({ indent: '' }), [['  x ', '\ty\t']], 1, 0);
		expect(renderTableMarkdown(result)).toContain('| &#32;&#32;x&#32; | &#9;y&#9; |');
	});
	it.each([-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER])('rejects invalid or oversized coordinates %s without modifying the model', coordinate => {
		const before = model(); const snapshot = structuredClone(before);
		expect(() => pasteSpreadsheetCells(before, [['x']], coordinate, 0)).toThrow(RangeError);
		expect(() => pasteSpreadsheetCells(before, [['x']], 0, coordinate)).toThrow(RangeError);
		expect(before).toEqual(snapshot);
	});
	it('rejects combined expansion beyond the cell budget', () => {
		const before = model({ rows: Array.from({ length: 100 }, () => ['keep']), align: [null] });
		expect(() => pasteSpreadsheetCells(before, [['new']], 0, 100)).toThrow(RangeError);
		expect(before.rows).toHaveLength(100); expect(before.rows[0]).toEqual(['keep']);
	});
	it('rejects expanded output including punctuation growth and row framing', () => {
		const value = '!'.repeat(MAX_SPREADSHEET_INPUT_BYTES);
		expect(() => pasteSpreadsheetCells(model({ rows: [], align: [], indent: '' }), [[value]], 0, 0)).toThrow(RangeError);
		const valid = pasteSpreadsheetCells(model({ rows: [], align: [], indent: '' }), [[value.slice(0, -20)]], 0, 0);
		expect(new TextEncoder().encode(renderTableMarkdown(valid)).byteLength).toBeLessThanOrEqual(MAX_SPREADSHEET_OUTPUT_BYTES);
		expect(() => pasteSpreadsheetCells(model(), [[' '.repeat(MAX_SPREADSHEET_INPUT_BYTES)]], 1, 1)).toThrow(RangeError);
	});
	it('rejects excessive existing source or indentation before allocating a replacement', () => {
		expect(() => pasteSpreadsheetCells(model({ rows: [['x'.repeat(MAX_SPREADSHEET_OUTPUT_BYTES), 'keep']] }), [['x']], 1, 0)).toThrow(RangeError);
		expect(() => pasteSpreadsheetCells(model({ indent: ' '.repeat(MAX_SPREADSHEET_OUTPUT_BYTES) }), [['x']], 1, 0)).toThrow(RangeError);
	});
	it('enforces UTF-8 budgets and allows valid emoji without corruption', () => {
		const result = pasteSpreadsheetCells(model(), [['😀 café']], 1, 1);
		expect(result.rows[1][1]).toBe('😀 café');
		expect(() => pasteSpreadsheetCells(model(), [['😀'.repeat(MAX_SPREADSHEET_INPUT_BYTES / 4 + 1)]], 1, 1)).toThrow(RangeError);
	});
	it('does not allocate the result grid before checking an oversized shape', () => {
		const before = model();
		Object.defineProperty(before.rows[0], 'slice', { value: () => { throw new Error('allocated too early'); } });
		expect(() => pasteSpreadsheetCells(before, [['x']], MAX_SPREADSHEET_ROWS, 0)).toThrow(RangeError);
	});
});
