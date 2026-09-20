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
});
