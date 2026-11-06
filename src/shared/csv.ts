/** CSV stays string data: never evaluate formulas or interpret HTML/Markdown. */
export const CSV_LIMITS = { characters: 5 * 1024 * 1024, rows: 50_000, columns: 200, cells: 250_000, field: 65_536 } as const;
export type CsvDelimiter = ',' | ';' | '\t';
export type CsvResult = { rows: string[][]; columns: number };

/** Bounded, strict quoted-field parser. Preserve empty records and whitespace. */
export function parseCsv(text: string, delimiter: CsvDelimiter = ','): CsvResult {
	if (![',', ';', '\t'].includes(delimiter)) throw new Error('Invalid CSV separator.');
	if (text.length > CSV_LIMITS.characters) throw new Error('CSV exceeds the 5 MiB character limit.');
	if (text.includes('\0')) throw new Error('CSV contains binary null characters. Open it as text to inspect its encoding.');
	const source = text.startsWith('\ufeff') ? text.slice(1) : text;
	if (!source) return { rows: [], columns: 0 };
	const rows: string[][] = [];
	let position = 0, columns = 0;
	while (position <= source.length) {
		if (rows.length >= CSV_LIMITS.rows) throw new Error('CSV exceeds 50,000 rows.');
		const row: string[] = [];
		for (;;) {
			if (row.length >= CSV_LIMITS.columns) throw new Error('CSV exceeds 200 columns.');
			let value = '';
			if (source[position] === '"') {
				position++;
				const parts: string[] = [];
				let length = 0;
				for (;;) {
					const end = source.indexOf('"', position);
					if (end < 0) throw new Error('CSV has an unclosed quoted field.');
					const part = source.slice(position, end); length += part.length;
					if (length > CSV_LIMITS.field) throw new Error('CSV field exceeds 65,536 characters.');
					parts.push(part); position = end + 1;
					if (source[position] !== '"') break;
					parts.push('"'); length++; position++;
				}
				value = parts.join('');
				if (position < source.length && ![delimiter, '\r', '\n'].includes(source[position])) throw new Error('Unexpected text after a quoted CSV field.');
			} else {
				const start = position;
				while (position < source.length && ![delimiter, '\r', '\n'].includes(source[position])) {
					if (source[position] === '"') throw new Error('Quotes inside CSV fields must be doubled and the field enclosed in quotes.');
					if (position - start >= CSV_LIMITS.field) throw new Error('CSV field exceeds 65,536 characters.');
					position++;
				}
				value = source.slice(start, position);
			}
			if (value.length > CSV_LIMITS.field) throw new Error('CSV field exceeds 65,536 characters.');
			row.push(value);
			columns = Math.max(columns, row.length);
			if ((rows.length + 1) * columns > CSV_LIMITS.cells) throw new Error('CSV exceeds a 250,000-cell grid.');
			if (source[position] !== delimiter) break;
			position++;
		}
		rows.push(row);
		if (position >= source.length) break;
		position += source[position] === '\r' && source[position + 1] === '\n' ? 2 : 1;
		if (position >= source.length) break;
	}
	return { rows, columns };
}

/** Sort whole records, with blanks last and stable source order for ties. */
export function sortedCsvRows(rows: readonly string[][], column: number, descending: boolean): number[] {
	const order = rows.map((_, index) => index);
	if (!Number.isInteger(column) || column < 0 || column >= CSV_LIMITS.columns) return order;
	const numeric = rows.some(row => (row[column] ?? '').trim() !== '') && rows.every(row => {
		const value = (row[column] ?? '').trim();
		if (!value) return true;
		const number = Number(value);
		return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
			&& Number.isFinite(number) && (!Number.isInteger(number) || Number.isSafeInteger(number));
	});
	const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
	return order.sort((left, right) => {
		const a = rows[left][column] ?? '', b = rows[right][column] ?? '';
		if (!a.trim() || !b.trim()) return !a.trim() === !b.trim() ? left - right : !a.trim() ? 1 : -1;
		const compared = numeric ? Number(a) - Number(b) : collator.compare(a, b);
		return (descending ? -compared : compared) || left - right;
	});
}

export function csvColumnLabel(index: number): string {
	if (!Number.isInteger(index) || index < 0 || index >= CSV_LIMITS.columns) throw new RangeError('Invalid CSV column.');
	let label = '';
	for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) label = String.fromCharCode(65 + (value - 1) % 26) + label;
	return label;
}
