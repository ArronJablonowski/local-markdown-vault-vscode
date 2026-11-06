import { describe, expect, it } from 'vitest';
import { CSV_LIMITS, csvColumnLabel, parseCsv, sortedCsvRows } from './csv';

describe('bounded CSV parsing', () => {
	it.each([
		['', []], ['\ufeff', []], ['a', [['a']]], ['a,b,', [['a', 'b', '']]],
		['a,b\r\nc,d\r\n', [['a', 'b'], ['c', 'd']]],
		['a,b\rc,d\ne,f', [['a', 'b'], ['c', 'd'], ['e', 'f']]],
		['\n\n', [[''], ['']]], ['\ufeffName,Notes\n🙂,"a,b"', [['Name', 'Notes'], ['🙂', 'a,b']]],
		['"a\nb","say ""hi"""', [['a\nb', 'say "hi"']]],
		['  A  ,=SUM(A1:A2)\n<script>,https://tracker.invalid', [['  A  ', '=SUM(A1:A2)'], ['<script>', 'https://tracker.invalid']]],
		['a,b\nc', [['a', 'b'], ['c']]],
	] as Array<[string, string[][]]>)('preserves records for %j', (text, rows) => expect(parseCsv(text).rows).toEqual(rows));
	it.each(['"unclosed', 'x"y,z', '"x" trailing,z', '"""', '\0,a'])('rejects malformed data: %j', text => expect(() => parseCsv(text)).toThrow());
	it('supports explicit separators without guessing quoted content', () => {
		expect(parseCsv('a;"b;c"\nx;y', ';').rows).toEqual([['a', 'b;c'], ['x', 'y']]);
		expect(parseCsv('a\t"b\tc"', '\t').rows).toEqual([['a', 'b\tc']]);
	});
	it('bounds every dimension before rendering a rectangular grid', () => {
		for (const text of ['x'.repeat(CSV_LIMITS.characters + 1), 'x'.repeat(CSV_LIMITS.field + 1), '"' + 'x'.repeat(CSV_LIMITS.field + 1) + '"', ','.repeat(200), '\n'.repeat(50_001), ('a,'.repeat(199) + 'b\n').repeat(1251)]) expect(() => parseCsv(text)).toThrow(/exceeds/);
	});
	it('round-trips generated quoted records, including hostile literal text', () => {
		const alphabet = ['a', ',', '"', '\r', '\n', '🙂', '\t', '=', '<', '&', ' '];
		const rows = Array.from({ length: 70 }, (_, row) => Array.from({ length: 7 }, (_, col) => Array.from({ length: 12 }, (_, n) => alphabet[(row * 17 + col * 7 + n * 13) % alphabet.length]).join('')));
		const source = rows.map(row => row.map(value => '"' + value.replace(/"/g, '""') + '"').join(',')).join('\r\n');
		expect(parseCsv(source).rows).toEqual(rows);
	});
});

describe('CSV record sorting', () => {
	it.each([false, true])('keeps blanks last and ties in source order, descending=%s', descending => {
		const rows = [['10', 'A'], ['2', 'B'], ['', 'C'], ['2', 'D'], ['-4', 'E'], [' ', 'F']];
		const before = JSON.stringify(rows);
		expect(sortedCsvRows(rows, 0, descending)).toEqual(descending ? [0, 1, 3, 4, 2, 5] : [4, 1, 3, 0, 2, 5]);
		expect(JSON.stringify(rows)).toBe(before);
	});
	it('handles decimal and exponent numbers without converting displayed values', () => expect(sortedCsvRows([['1e2'], ['.25'], ['-1.5'], ['2']], 0, false)).toEqual([2, 1, 3, 0]));
	it('sorts natural text and large identifiers without floating-point rounding', () => {
		expect(sortedCsvRows([['item10'], ['Item2'], ['item1']], 0, false)).toEqual([2, 1, 0]);
		expect(sortedCsvRows([['9007199254740993'], ['9007199254740992']], 0, false)).toEqual([1, 0]);
	});
	it('retains source order for invalid columns', () => expect(sortedCsvRows([['a'], ['b']], Infinity, true)).toEqual([0, 1]));
	it.each([[0, 'A'], [25, 'Z'], [26, 'AA'], [199, 'GR']] as const)('labels column %s', (index, label) => expect(csvColumnLabel(index)).toBe(label));
});
