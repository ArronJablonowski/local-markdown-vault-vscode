/**
 * Structural edits to a Markdown table.
 *
 * Kept as pure functions over plain data, separate from the widget that calls
 * them. Cell editing can write back one span at a time because only one cell
 * changes; adding a row or a column changes the shape of every line (a new
 * column touches the header, the delimiter row, and every data row), so the
 * table is rebuilt and replaced whole. That makes getting the *text* right the
 * whole problem, and text is exactly what can be unit-tested without a DOM.
 */

import type { ColumnAlign } from './livePreviewPlugin';
import { escapeTableCellSource } from './tableCellSource';

/** The pieces of a table needed to rewrite it. */
export interface TableEditModel {
	/** Cell text, header row(s) first. */
	rows: string[][];
	/** How many leading entries of `rows` are header rows (GFM allows only 1). */
	headerRowCount: number;
	align: ColumnAlign[];
	/**
	 * Indentation carried by every line of the table, e.g. the two spaces of a
	 * table nested under a list item. Reapplied to each rebuilt line so the
	 * table stays inside its list item.
	 */
	indent: string;
}

/** The delimiter-row spec for one column's alignment (`:--`, `:-:`, `--:`, `---`). */
export function delimiterFor(align: ColumnAlign): string {
	switch (align) {
		case 'left':
			return ':---';
		case 'center':
			return ':--:';
		case 'right':
			return '---:';
		default:
			return '---';
	}
}

/** Renders a table back to Markdown, one line per row plus the delimiter row. */
export function renderTableMarkdown(model: TableEditModel): string {
	const width = model.align.length || model.rows[0]?.length || 0;
	const line = (cells: string[]): string => {
		// GFM hides overflow cells, but that is not permission for an unrelated
		// structural edit to delete their authored source.
		const padded = Array.from({ length: Math.max(width, cells.length) }, (_, i) => escapeTableCellSource(cells[i] ?? '').trim());
		return `${model.indent}| ${padded.join(' | ')} |`;
	};
	const out: string[] = [];
	// GFM requires exactly one header row followed by the delimiter row. A model
	// with no header at all still needs one, or the result is not a table.
	const headerCount = Math.max(1, model.headerRowCount);
	for (let i = 0; i < headerCount; i++) out.push(line(model.rows[i] ?? []));
	out.push(`${model.indent}| ${Array.from({ length: width }, (_, i) => delimiterFor(model.align[i] ?? null)).join(' | ')} |`);
	for (let i = headerCount; i < model.rows.length; i++) out.push(line(model.rows[i]));
	return out.join('\n');
}

/**
 * Inserts an empty row at `index` (counted in `rows`, header rows included).
 *
 * `index` is clamped, and never allowed above the header: a row inserted before
 * the header row would become the header itself and silently retitle the table.
 */
export function insertRow(model: TableEditModel, index: number): TableEditModel {
	const width = model.align.length || model.rows[0]?.length || 0;
	const headerCount = Math.max(1, model.headerRowCount);
	const at = Math.min(Math.max(index, headerCount), model.rows.length);
	const rows = model.rows.slice();
	rows.splice(at, 0, new Array(width).fill(''));
	return { ...model, rows };
}

/**
 * Inserts an empty column at `index`, in every row and in the alignment list.
 *
 * The new column is unaligned; the delimiter row grows with it, which is what
 * keeps the table's column count — fixed by that row under GFM — consistent
 * with the rows above and below.
 */
export function insertColumn(model: TableEditModel, index: number): TableEditModel {
	const width = model.align.length || model.rows[0]?.length || 0;
	const at = Math.min(Math.max(index, 0), width);
	const rows = model.rows.map((cells) => {
		const next = cells.slice();
		// Pad a short row out to `at` first, or `splice` would land the new cell
		// at the end of that row instead of in the intended column.
		while (next.length < at) next.push('');
		next.splice(at, 0, '');
		return next;
	});
	const align = model.align.slice();
	while (align.length < at) align.push(null);
	align.splice(at, 0, null);
	return { ...model, rows, align };
}

/**
 * Removes the row at `index`. The header row is never removed — a table without
 * one is not a table — and neither is the last remaining data row's absence a
 * problem, since a header-only table is valid.
 */
export function deleteRow(model: TableEditModel, index: number): TableEditModel {
	const headerCount = Math.max(1, model.headerRowCount);
	if (index < headerCount || index >= model.rows.length) return model;
	const rows = model.rows.slice();
	rows.splice(index, 1);
	return { ...model, rows };
}

/** Removes the column at `index`, from every row and from the alignment list. */
export function deleteColumn(model: TableEditModel, index: number): TableEditModel {
	const width = model.align.length || model.rows[0]?.length || 0;
	// A table needs at least one column; removing the last would leave `||`.
	if (width <= 1 || index < 0 || index >= width) return model;
	const rows = model.rows.map((cells) => {
		const next = cells.slice();
		next.splice(index, 1);
		return next;
	});
	const align = model.align.slice();
	align.splice(index, 1);
	return { ...model, rows, align };
}

/** Moves a data row by one position without ever crossing into the header. */
export function moveRow(model: TableEditModel, index: number, delta: -1 | 1): TableEditModel {
	const headerCount = Math.max(1, model.headerRowCount);
	const target = index + delta;
	if (index < headerCount || index >= model.rows.length || target < headerCount || target >= model.rows.length) {
		return model;
	}
	const rows = model.rows.slice();
	[rows[index], rows[target]] = [rows[target], rows[index]];
	return { ...model, rows };
}

/** Moves a column, carrying its delimiter alignment and every cell with it. */
export function moveColumn(model: TableEditModel, index: number, delta: -1 | 1): TableEditModel {
	const width = model.align.length || model.rows[0]?.length || 0;
	const target = index + delta;
	if (index < 0 || index >= width || target < 0 || target >= width) return model;
	const rows = model.rows.map((cells) => {
		const padded = Array.from({ length: Math.max(width, cells.length) }, (_, i) => cells[i] ?? '');
		[padded[index], padded[target]] = [padded[target], padded[index]];
		return padded;
	});
	const align = Array.from({ length: width }, (_, i) => model.align[i] ?? null);
	[align[index], align[target]] = [align[target], align[index]];
	return { ...model, rows, align };
}

/** Sorts data rows by one column, preserving the header and equal-value order. */
export function sortRows(model: TableEditModel, column: number, direction: 'asc' | 'desc'): TableEditModel {
	const width = model.align.length || model.rows[0]?.length || 0;
	if (column < 0 || column >= width) return model;
	const headerCount = Math.max(1, model.headerRowCount);
	const headers = model.rows.slice(0, headerCount);
	const factor = direction === 'asc' ? 1 : -1;
	const data = model.rows
		.slice(headerCount)
		.map((row, originalIndex) => ({ row, originalIndex }))
		.sort((a, b) => {
			const compared = (a.row[column] ?? '').localeCompare(b.row[column] ?? '', undefined, {
				numeric: true,
				sensitivity: 'base',
			});
			return compared === 0 ? a.originalIndex - b.originalIndex : compared * factor;
		})
		.map(({ row }) => row);
	return { ...model, rows: [...headers, ...data] };
}

/** Sets the GFM delimiter alignment for one column. */
export function setColumnAlignment(model: TableEditModel, index: number, alignAt: ColumnAlign): TableEditModel {
	const width = model.align.length || model.rows[0]?.length || 0;
	if (index < 0 || index >= width) return model;
	const align = Array.from({ length: width }, (_, i) => model.align[i] ?? null);
	align[index] = alignAt;
	return { ...model, align };
}
