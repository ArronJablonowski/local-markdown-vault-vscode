import { describe, expect, it } from 'vitest';
import { MAX_SPREADSHEET_INPUT_BYTES, parseSpreadsheetClipboard } from './spreadsheetClipboard';

describe('external reports are not rejected as oversized spreadsheets', () => {
	const paragraph = 'Ordinary explanatory paragraph with **bold** and a conclusion.\n';
	for (const opening of ['## Notes, findings', '> [!note] Notes, findings', '- Notes, findings', '**Notes, findings**']) {
		it(`retains a large Markdown report beginning with ${JSON.stringify(opening)}`, () => {
			const report = `${opening}\n\n${paragraph.repeat(5_000)}`;
			expect(report.length).toBeGreaterThan(MAX_SPREADSHEET_INPUT_BYTES);
			expect(parseSpreadsheetClipboard(report)).toEqual({ kind: 'text' });
		});
	}
	it('recognizes nonrectangular prose before reaching the spreadsheet row ceiling', () => {
		const report = 'First, ordinary paragraph.\n' + 'Another ordinary paragraph.\n'.repeat(1_100);
		expect(parseSpreadsheetClipboard(report)).toEqual({ kind: 'text' });
	});
	it('recognizes a plain line in tab-containing reports before the spreadsheet row ceiling', () => {
		const report = 'Section\tDetails\nThis is an ordinary report, not a spreadsheet.\n' + 'More explanatory text.\n'.repeat(1_100);
		expect(parseSpreadsheetClipboard(report)).toEqual({ kind: 'text' });
	});
	it.each(['csv', 'tsv'] as const)('still rejects large explicitly declared %s data', mime => {
		const report = '## Notes, findings\n\n' + paragraph.repeat(5_000);
		expect(parseSpreadsheetClipboard(report, mime)).toEqual({ kind: 'invalid', reason: 'tooLarge' });
	});
	it('declines conversion of oversized plain-text grids without discarding their text', () => {
		expect(parseSpreadsheetClipboard('Name\tValue\n' + 'x\ty\n'.repeat(70_000)))
			.toEqual({ kind: 'text' });
	});
	it('does not expand quoted Markdown or line breaks in oversized plain-text CSV', () => {
		const grid = 'Name,Value\n"## A heading, within one cell\nA plain sentence",' + 'x'.repeat(MAX_SPREADSHEET_INPUT_BYTES);
		expect(parseSpreadsheetClipboard(grid)).toEqual({ kind: 'text' });
		expect(parseSpreadsheetClipboard(grid, 'csv')).toEqual({ kind: 'invalid', reason: 'tooLarge' });
	});
	it('does not expand Markdown-looking values outside the spreadsheet budget', () => {
		const grid = '**Name**, Details\tValue\n' + 'x\ty\n'.repeat(70_000);
		expect(parseSpreadsheetClipboard(grid)).toEqual({ kind: 'text' });
		expect(parseSpreadsheetClipboard(grid, 'tsv')).toEqual({ kind: 'invalid', reason: 'tooLarge' });
	});
	it('does not infer a grid from an unfinished quoted prefix', () => {
		const grid = 'Name,Value\n"## Notes, findings\n' + paragraph.repeat(5_000);
		expect(parseSpreadsheetClipboard(grid)).toEqual({ kind: 'text' });
	});
	it('detects ragged prose records beyond the bounded prefix during parsing', () => {
		const report = 'Name,Value\n' + 'x,y\n'.repeat(1_030) + 'A plain sentence without commas.\n';
		// Once the row budget is exhausted, leave the entire source intact rather
		// than continuing to allocate rows in search of a conclusive format.
		expect(parseSpreadsheetClipboard(report)).toEqual({ kind: 'text' });
		const earlyReport = 'Name,Value\n' + 'Long header value,Row details\n'.repeat(200)
			+ 'A plain sentence without commas.\n' + paragraph.repeat(1_100);
		expect(parseSpreadsheetClipboard(earlyReport)).toEqual({ kind: 'text' });
	});
	it('preserves large reports whose first comma-containing paragraph exceeds the bounded prefix', () => {
		const report = 'Summary, ' + 'A long opening paragraph. '.repeat(300) + '\n\n' + paragraph.repeat(5_000);
		expect(report.indexOf('\n')).toBeGreaterThan(4_096);
		expect(report.length).toBeGreaterThan(MAX_SPREADSHEET_INPUT_BYTES);
		expect(parseSpreadsheetClipboard(report)).toEqual({ kind: 'text' });
	});
	it.each([
		['rows', 'Name\tValue\n' + 'x\ty\n'.repeat(1_001)],
		['columns', Array(201).fill('cell').join('\t')],
		['cells', Array(101).fill(Array(100).fill('cell').join('\t')).join('\n')],
	])('preserves plain-text grids exceeding the %s budget without relaxing explicit TSV', (_name, grid) => {
		expect(parseSpreadsheetClipboard(grid)).toEqual({ kind: 'text' });
		expect(parseSpreadsheetClipboard(grid, 'tsv')).toEqual({ kind: 'invalid', reason: 'tooLarge' });
	});
});
