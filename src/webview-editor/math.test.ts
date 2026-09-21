import { describe, expect, it } from 'vitest';
import { findMathRanges } from './math';

describe('math range detection', () => {
	it('finds inline and block math', () => {
		const text = 'Energy $E = mc^2$.\n\n$$\n\\int_0^1 x dx\n$$\n';
		expect(findMathRanges(text).map(({ source, display }) => ({ source, display }))).toEqual([
			{ source: 'E = mc^2', display: false },
			{ source: '\\int_0^1 x dx', display: true },
		]);
	});

	it('ignores code, escaped dollars, currency, and malformed input', () => {
		const text = '`$code$` \\$escaped$ $5 and $unterminated\n```\n$x$\n```';
		expect(findMathRanges(text)).toEqual([]);
	});

	it('handles long escaped and unterminated inline input in linear time', () => {
		const hostile = `$!${'\\\\#'.repeat(100_000)}`;
		expect(findMathRanges(hostile)).toEqual([]);
		expect(findMathRanges(`${hostile}$`)).toEqual([]);
	});

	it('preserves escaped characters inside a bounded inline expression', () => {
		expect(findMathRanges('before $x\\$y$ after').map((range) => range.source)).toEqual(['x\\$y']);
	});
});
