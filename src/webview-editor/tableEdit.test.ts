import { describe, it, expect } from 'vitest';
import {
	renderTableMarkdown,
	insertRow,
	insertColumn,
	deleteRow,
	deleteColumn,
	moveRow,
	moveColumn,
	sortRows,
	setColumnAlignment,
	delimiterFor,
	type TableEditModel,
} from './tableEdit';

function model(over: Partial<TableEditModel> = {}): TableEditModel {
	return {
		rows: [
			['a', 'b'],
			['1', '2'],
		],
		headerRowCount: 1,
		align: [null, null],
		indent: '',
		...over,
	};
}

describe('delimiterFor', () => {
	it.each([
		['left', ':---'],
		['center', ':--:'],
		['right', '---:'],
		[null, '---'],
	] as const)('renders %s alignment as %s', (align, expected) => {
		expect(delimiterFor(align)).toBe(expected);
	});
});

describe('renderTableMarkdown', () => {
	it('renders header, delimiter and data rows', () => {
		expect(renderTableMarkdown(model())).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
	});

	it('carries column alignment into the delimiter row', () => {
		expect(renderTableMarkdown(model({ align: ['left', 'right'] }))).toBe(
			'| a | b |\n| :--- | ---: |\n| 1 | 2 |',
		);
	});

	// A table nested under a list item must keep its indentation, or it falls out
	// of the item and stops being part of it.
	it('reapplies the table indentation to every line', () => {
		expect(renderTableMarkdown(model({ indent: '  ' }))).toBe('  | a | b |\n  | --- | --- |\n  | 1 | 2 |');
	});

	// Both would break the row apart, exactly as in sanitizeCellInput.
	it('escapes a pipe and flattens a newline in cell text', () => {
		const out = renderTableMarkdown(model({ rows: [['a|b', 'c\nd'], ['1', '2']] }));
		expect(out.split('\n')[0]).toBe('| a\\|b | c d |');
	});

	it('leaves an already-escaped pipe alone', () => {
		const out = renderTableMarkdown(model({ rows: [['a\\|b', 'c'], ['1', '2']] }));
		expect(out.split('\n')[0]).toBe('| a\\|b | c |');
	});

	it('escapes adjacent pipes and lone carriage returns in rebuilt cells', () => {
		const out = renderTableMarkdown(model({ rows: [['a||b', 'c\rd'], ['1', '2']] }));
		expect(out.split('\n')[0]).toBe('| a\\|\\|b | c d |');
	});

	it('retains overflow source cells when adding rows or moving visible columns', () => {
		const original = model({ rows: [['a', 'b'], ['1', '2', 'hidden source content']] });
		expect(renderTableMarkdown(insertRow(original, 2))).toContain('| 1 | 2 | hidden source content |');
		expect(renderTableMarkdown(moveColumn(original, 0, 1))).toContain('| 2 | 1 | hidden source content |');
	});

	it('pads a short row so every line has the same column count', () => {
		const out = renderTableMarkdown(model({ rows: [['a', 'b'], ['1']] }));
		expect(out).toBe('| a | b |\n| --- | --- |\n| 1 |  |');
	});

	it('keeps a header-only table renderable', () => {
		expect(renderTableMarkdown(model({ rows: [['a', 'b']] }))).toBe('| a | b |\n| --- | --- |');
	});
});

describe('insertRow', () => {
	it('inserts an empty row at the given index', () => {
		expect(renderTableMarkdown(insertRow(model(), 1))).toBe('| a | b |\n| --- | --- |\n|  |  |\n| 1 | 2 |');
	});

	it('appends when the index is past the end', () => {
		expect(renderTableMarkdown(insertRow(model(), 99))).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |\n|  |  |');
	});

	// A row inserted above the header would become the header itself and
	// silently retitle the table's columns.
	it('never inserts above the header row', () => {
		expect(renderTableMarkdown(insertRow(model(), 0))).toBe('| a | b |\n| --- | --- |\n|  |  |\n| 1 | 2 |');
	});
});

describe('insertColumn', () => {
	it('inserts an empty column in every row and in the delimiter', () => {
		expect(renderTableMarkdown(insertColumn(model(), 1))).toBe('| a |  | b |\n| --- | --- | --- |\n| 1 |  | 2 |');
	});

	it('appends a column at the end', () => {
		expect(renderTableMarkdown(insertColumn(model(), 2))).toBe('| a | b |  |\n| --- | --- | --- |\n| 1 | 2 |  |');
	});

	it('keeps existing alignments with their own columns', () => {
		const out = insertColumn(model({ align: ['left', 'right'] }), 1);
		expect(out.align).toEqual(['left', null, 'right']);
		expect(renderTableMarkdown(out)).toBe('| a |  | b |\n| :--- | --- | ---: |\n| 1 |  | 2 |');
	});

	// Without padding first, `splice` on a short row lands the new cell at that
	// row's end rather than in the intended column, shifting the rest left.
	it('inserts into the right column of a row that is too short', () => {
		const out = insertColumn(model({ rows: [['a', 'b', 'c'], ['1']], align: [null, null, null] }), 2);
		expect(renderTableMarkdown(out)).toBe('| a | b |  | c |\n| --- | --- | --- | --- |\n| 1 |  |  |  |');
	});
});

describe('deleteRow', () => {
	it('removes a data row', () => {
		const m = model({ rows: [['a', 'b'], ['1', '2'], ['3', '4']] });
		expect(renderTableMarkdown(deleteRow(m, 1))).toBe('| a | b |\n| --- | --- |\n| 3 | 4 |');
	});

	it('refuses to remove the header row', () => {
		expect(deleteRow(model(), 0)).toEqual(model());
	});

	it('ignores an out-of-range index', () => {
		expect(deleteRow(model(), 99)).toEqual(model());
	});

	it('allows deleting down to a header-only table', () => {
		expect(renderTableMarkdown(deleteRow(model(), 1))).toBe('| a | b |\n| --- | --- |');
	});
});

describe('deleteColumn', () => {
	it('removes the column from every row and from the delimiter', () => {
		const m = model({ rows: [['a', 'b', 'c'], ['1', '2', '3']], align: [null, 'center', null] });
		expect(renderTableMarkdown(deleteColumn(m, 1))).toBe('| a | c |\n| --- | --- |\n| 1 | 3 |');
	});

	// Removing the last column would leave `||`, which is not a table.
	it('refuses to remove the only column', () => {
		const m = model({ rows: [['a'], ['1']], align: [null] });
		expect(deleteColumn(m, 0)).toEqual(m);
	});

	it('ignores an out-of-range index', () => {
		expect(deleteColumn(model(), 5)).toEqual(model());
	});
});

describe('moveRow', () => {
	it('moves data rows but never crosses the header', () => {
		const m = model({ rows: [['h1', 'h2'], ['a', '1'], ['b', '2']] });
		expect(moveRow(m, 2, -1).rows).toEqual([['h1', 'h2'], ['b', '2'], ['a', '1']]);
		expect(moveRow(m, 1, -1)).toBe(m);
		expect(moveRow(m, 2, 1)).toBe(m);
	});
});

describe('moveColumn', () => {
	it('moves cells and their alignment together', () => {
		const m = model({ rows: [['a', 'b'], ['1', '2']], align: ['left', 'right'] });
		const out = moveColumn(m, 0, 1);
		expect(out.rows).toEqual([['b', 'a'], ['2', '1']]);
		expect(out.align).toEqual(['right', 'left']);
	});

	it('ignores an edge move', () => {
		const m = model();
		expect(moveColumn(m, 0, -1)).toBe(m);
	});
});

describe('sortRows', () => {
	it('sorts naturally and keeps the header and equal-value order', () => {
		const m = model({ rows: [['name', 'n'], ['z', '10'], ['a', '2'], ['A', '2']] });
		expect(sortRows(m, 1, 'asc').rows).toEqual([['name', 'n'], ['a', '2'], ['A', '2'], ['z', '10']]);
		expect(sortRows(m, 1, 'desc').rows).toEqual([['name', 'n'], ['z', '10'], ['a', '2'], ['A', '2']]);
	});
});

describe('setColumnAlignment', () => {
	it('changes only the selected delimiter', () => {
		const out = setColumnAlignment(model(), 1, 'center');
		expect(out.align).toEqual([null, 'center']);
		expect(renderTableMarkdown(out)).toContain('| --- | :--: |');
	});
});
