import type { TableEditModel } from './tableEdit';

export const MAX_SPREADSHEET_INPUT_BYTES = 256 * 1024;
export const MAX_SPREADSHEET_ROWS = 1_000;
export const MAX_SPREADSHEET_COLUMNS = 200;
export const MAX_SPREADSHEET_CELLS = 10_000;
export const MAX_SPREADSHEET_OUTPUT_BYTES = 512 * 1024;

export type SpreadsheetClipboardResult =
	| { kind: 'table'; rows: string[][] }
	| { kind: 'text' }
	| { kind: 'invalid'; reason: 'malformed' | 'tooLarge' };

const invalid = (reason: 'malformed' | 'tooLarge'): SpreadsheetClipboardResult => ({ kind: 'invalid', reason });

/** Byte counting without allocating another copy of potentially oversized text. */
function utf8Bytes(text: string): number {
	let bytes = 0;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code < 0x80) bytes++;
		else if (code < 0x800) bytes += 2;
		else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length
			&& text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
		else bytes += 3;
	}
	return bytes;
}

function isPunctuation(code: number): boolean {
	return (code >= 33 && code <= 47) || (code >= 58 && code <= 64)
		|| (code >= 91 && code <= 96) || (code >= 123 && code <= 126);
}

/** CSV-looking Markdown remains Markdown unless the clipboard declares its format. */
function looksLikeMarkdown(text: string): boolean {
	return /(?:^|[\r\n])[ \t]{0,3}(?:#{1,6}[ \t]|>[ \t]?|[-+*][ \t]|\d+[.)][ \t]|`{3,}|~{3,}|---[ \t]*(?:[\r\n]|$))/.test(text)
		// Require a pipe before the second whitespace run. Making only the pipe
		// optional lets two adjacent runs repartition a long non-table prefix in
		// quadratic time, freezing the editor on an otherwise bounded CSV paste.
		|| /(?:^|[\r\n])[ \t]*(?:\|[ \t]*)?:?-{3,}:?[ \t]*\|/.test(text)
		|| /\*\*|__|`|\]\(|\[\[/.test(text);
}

/** Hide quoted values only for format detection; the parser still validates them. */
function outsideQuotedFields(source: string): string {
	let quoted = false, fieldStart = true;
	const pieces: string[] = [];
	for (let i = 0; i < source.length; i++) {
		const char = source[i];
		if (quoted) {
			pieces.push(' ');
			if (char === '"') {
				if (source[i + 1] === '"') { pieces.push(' '); i++; }
				else quoted = false;
			}
		} else if (fieldStart && char === '"') {
			quoted = true; fieldStart = false; pieces.push(' ');
		} else {
			pieces.push(char);
			fieldStart = char === ',' || char === '\t' || char === '\r' || char === '\n';
		}
	}
	return pieces.join('');
}

/**
 * Parses bounded RFC-style quoted CSV/TSV. Auto CSV recognition is deliberately
 * conservative; an ordinary single comma, prose line, or Markdown is not a table.
 * A final record terminator is ignored, but empty records/cells are retained.
 */
export function parseSpreadsheetClipboard(text: string, mime: 'auto' | 'csv' | 'tsv' = 'auto'): SpreadsheetClipboardResult {
	if (typeof text !== 'string' || !['auto', 'csv', 'tsv'].includes(mime)) return invalid('malformed');
	const source = text.startsWith('\ufeff') ? text.slice(1) : text;
	if (mime === 'auto' && /^(?:[ \t]*\r?\n)*[ \t]{0,3}(?:`{3,}|~{3,})/.test(source)) return { kind: 'text' };
	if (mime === 'auto' && !source.includes('\t') && (!source.includes(',') || !/[\r\n]/.test(source))) return { kind: 'text' };
	if (text.length > MAX_SPREADSHEET_INPUT_BYTES || utf8Bytes(text) > MAX_SPREADSHEET_INPUT_BYTES) return invalid('tooLarge');
	const classification = mime === 'auto' ? outsideQuotedFields(source) : source;
	let delimiter: ',' | '\t';
	if (mime === 'tsv' || (mime === 'auto' && classification.includes('\t'))) delimiter = '\t';
	else {
		delimiter = ',';
		if (mime === 'auto' && (!classification.includes(',') || !/[\r\n]/.test(classification) || looksLikeMarkdown(classification))) return { kind: 'text' };
	}

	const rows: string[][] = [];
	let row: string[] = [];
	let position = 0;
	let widest = 0;
	for (;;) {
		if (rows.length >= MAX_SPREADSHEET_ROWS || row.length >= MAX_SPREADSHEET_COLUMNS) return invalid('tooLarge');
		let value: string;
		if (source[position] === '"') {
			position++;
			const chunks: string[] = [];
			for (;;) {
				const closing = source.indexOf('"', position);
				if (closing < 0) return invalid('malformed');
				chunks.push(source.slice(position, closing));
				position = closing + 1;
				if (source[position] !== '"') break;
				chunks.push('"'); position++;
			}
			value = chunks.join('');
			if (position < source.length && source[position] !== delimiter && source[position] !== '\r' && source[position] !== '\n') return invalid('malformed');
		} else {
			const start = position;
			while (position < source.length && source[position] !== delimiter && source[position] !== '\r' && source[position] !== '\n') {
				// Excel plain-text TSV commonly contains literal quotes in values
				// such as HTML or natural language. Only a leading quote is syntax.
				if (source[position] === '"' && delimiter === ',') return invalid('malformed');
				position++;
			}
			value = source.slice(start, position);
		}
		row.push(value);
		widest = Math.max(widest, row.length);
		if ((rows.length + 1) * widest > MAX_SPREADSHEET_CELLS) return invalid('tooLarge');
		if (source[position] === delimiter) { position++; continue; }
		rows.push(row); row = [];
		if (position >= source.length) break;
		position += source[position] === '\r' && source[position + 1] === '\n' ? 2 : 1;
		if (position >= source.length) break;
	}
	if (mime === 'auto' && delimiter === ',' && (rows.length < 2 || widest < 2 || rows.some(cells => cells.length !== widest))) return { kind: 'text' };
	for (const cells of rows) while (cells.length < widest) cells.push('');
	return { kind: 'table', rows };
}

function whitespaceBounds(value: string): { leading: number; trailing: number } {
	let leading = 0;
	let trailing = value.length;
	while (leading < value.length && /\s/.test(value[leading])) leading++;
	while (trailing > leading && /\s/.test(value[trailing - 1])) trailing--;
	return { leading, trailing };
}

/**
 * Treat values as literal text, never as authored Markdown, HTML, math, or links.
 * Only our own <br> and boundary-whitespace character references are generated;
 * user-supplied angle brackets and ampersands are always escaped.
 */
export function spreadsheetCellSource(value: string): string {
	const { leading, trailing } = whitespaceBounds(value);
	return value.replace(/[!-/:-@\[-`{-~]|\r\n?|\n|\s/g, (token: string, offset: number) => {
		if (token === '\n' || token[0] === '\r') return '<br>';
		if (isPunctuation(token.charCodeAt(0))) return `\\${token}`;
		return offset < leading || offset >= trailing ? `&#${token.charCodeAt(0)};` : token;
	});
}

function literalSourceBytes(value: string): number {
	let bytes = utf8Bytes(value);
	const { leading, trailing } = whitespaceBounds(value);
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code === 13 || code === 10) {
			bytes += 3; // One newline byte becomes the four bytes in our bare <br>.
			if (code === 13 && value.charCodeAt(i + 1) === 10) { bytes--; i++; }
		} else if (isPunctuation(code)) bytes++;
		else if (i < leading || i >= trailing) bytes += String(code).length + 3 - utf8Bytes(value[i]);
	}
	return bytes;
}

/** Conservative rendered size: preserve source; count any extra pipe escapes. */
function authoredSourceBytes(value: string): number {
	let bytes = utf8Bytes(value);
	let backslashes = 0;
	for (const char of value) {
		if (char === '|') bytes += backslashes % 2 === 0 ? 1 : 0;
		backslashes = char === '\\' ? backslashes + 1 : 0;
	}
	return bytes;
}

/**
 * Replace a rectangle with literal spreadsheet values. Check the entire expanded
 * shape and serialized byte budget before allocating a new grid or escaped cells.
 * Existing cell source, alignment, indentation, and caller-owned arrays survive.
 */
export function pasteSpreadsheetCells(model: TableEditModel, rows: string[][], row: number, col: number): TableEditModel {
	const reject = (): never => { throw new RangeError('Spreadsheet paste exceeds safe table limits or has invalid dimensions.'); };
	if (!Number.isSafeInteger(row) || !Number.isSafeInteger(col) || row < 0 || col < 0
		|| !Array.isArray(rows) || rows.length === 0 || rows.length > MAX_SPREADSHEET_ROWS
		|| !Array.isArray(model.rows) || model.rows.length > MAX_SPREADSHEET_ROWS
		|| !Array.isArray(model.align) || model.align.length > MAX_SPREADSHEET_COLUMNS
		|| typeof model.indent !== 'string' || !Number.isSafeInteger(model.headerRowCount)
		|| model.headerRowCount < 0 || model.headerRowCount > MAX_SPREADSHEET_ROWS) reject();
	let pasteWidth = 0;
	let inputBytes = 0;
	for (const cells of rows) {
		if (!Array.isArray(cells) || cells.length === 0 || cells.length > MAX_SPREADSHEET_COLUMNS) reject();
		pasteWidth = Math.max(pasteWidth, cells.length);
		for (const value of cells) {
			if (typeof value !== 'string' || value.length > MAX_SPREADSHEET_INPUT_BYTES) reject();
			inputBytes += utf8Bytes(value);
			if (inputBytes > MAX_SPREADSHEET_INPUT_BYTES) reject();
		}
	}
	const width = Math.max(model.align.length || model.rows[0]?.length || 0, col + pasteWidth);
	const height = Math.max(model.rows.length, Math.max(1, model.headerRowCount), row + rows.length);
	let widest = width;
	for (const cells of model.rows) {
		if (!Array.isArray(cells) || cells.length > MAX_SPREADSHEET_COLUMNS) reject();
		widest = Math.max(widest, cells.length);
		for (const value of cells) if (typeof value !== 'string' || value.length > MAX_SPREADSHEET_OUTPUT_BYTES) reject();
	}
	if (height > MAX_SPREADSHEET_ROWS || widest > MAX_SPREADSHEET_COLUMNS || height * widest > MAX_SPREADSHEET_CELLS) reject();
	for (const alignment of model.align) if (alignment !== null && alignment !== 'left' && alignment !== 'right' && alignment !== 'center') reject();
	if (model.indent.length > MAX_SPREADSHEET_OUTPUT_BYTES) reject();
	const indentBytes = utf8Bytes(model.indent);
	// One separator line plus the Markdown line separators; aligned delimiters
	// have at most four bytes, and a row's framing is 3 * columns + 1 bytes.
	let outputBytes = indentBytes + 7 * width + 1 + height;
	for (let r = 0; r < height; r++) {
		const rowWidth = Math.max(width, model.rows[r]?.length ?? 0);
		outputBytes += indentBytes + 3 * rowWidth + 1;
		for (let c = 0; c < rowWidth; c++) {
			if (r >= row && r < row + rows.length && c >= col && c < col + pasteWidth) {
				outputBytes += literalSourceBytes(rows[r - row][c - col] ?? '');
			} else outputBytes += authoredSourceBytes(model.rows[r]?.[c] ?? '');
			if (outputBytes > MAX_SPREADSHEET_OUTPUT_BYTES) reject();
		}
	}
	const nextRows = Array.from({ length: height }, (_, r) => {
		const cells = model.rows[r]?.slice() ?? [];
		while (cells.length < width) cells.push('');
		if (r >= row && r < row + rows.length) {
			for (let c = 0; c < pasteWidth; c++) cells[col + c] = spreadsheetCellSource(rows[r - row][c] ?? '');
		}
		return cells;
	});
	const align = model.align.slice();
	while (align.length < width) align.push(null);
	return { ...model, rows: nextRows, align };
}
