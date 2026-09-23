import { describe, expect, it } from 'vitest';
import { findMathRanges } from './math';

describe('math range detection', () => {
	it.each(['$75–$85', '$75-$85', '$75—$85', '$1,250.50–$1,500.00', '$5/$10/$15', '$34 each', '$102 total'])('keeps currency text literal: %s', (text) => {
		expect(findMathRanges(text)).toEqual([]);
	});
	it('does not consume later math delimiters after a currency range', () => {
		expect(findMathRanges('Cost $75–$85; formula $x^2$ and $2+2=4$.').map(range => range.source)).toEqual(['x^2', '2+2=4']);
		expect(findMathRanges('Price $34 each; use $x$.').map(range => range.source)).toEqual(['x']);
	});
	it('preserves numeric math and escaped dollar signs inside math', () => {
		expect(findMathRanges('$2$ + $3$; $2x+1$; $\\$75$').map(range => range.source)).toEqual(['2', '3', '2x+1', '\\$75']);
	});
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
