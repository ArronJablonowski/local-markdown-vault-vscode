import { describe, expect, it } from 'vitest';
import { splitEmbeddedTableRow } from './embeddedMarkdown';

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
