import { describe, expect, it } from 'vitest';
import {
	findInlineHighlightRanges,
	MAX_HIGHLIGHT_LINE_CHARACTERS,
	MAX_HIGHLIGHTS_PER_VIEWPORT,
} from './inlineHighlight';

describe('bounded inline highlight scanning', () => {
	it('finds ordinary highlights and ignores incomplete markers', () => {
		expect(findInlineHighlightRanges('Before ==one== and ==two words== after')).toEqual([
			{ from: 7, to: 14 },
			{ from: 19, to: 32 },
		]);
		expect(findInlineHighlightRanges('Before ==incomplete')).toEqual([]);
	});

	it('caps adversarial decoration counts', () => {
		const source = '==x=='.repeat(MAX_HIGHLIGHTS_PER_VIEWPORT * 4);
		const ranges = findInlineHighlightRanges(source);
		expect(ranges).toHaveLength(MAX_HIGHLIGHTS_PER_VIEWPORT);
		expect(ranges.at(-1)?.to).toBe(MAX_HIGHLIGHTS_PER_VIEWPORT * 5);
	});

	it('does not inspect an unbounded single line', () => {
		const source = `${'a'.repeat(MAX_HIGHLIGHT_LINE_CHARACTERS)}==outside==`;
		expect(findInlineHighlightRanges(source)).toEqual([]);
	});
});
