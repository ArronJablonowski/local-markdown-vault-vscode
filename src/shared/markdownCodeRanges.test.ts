import { describe, expect, it } from 'vitest';
import { markdownCodeRanges } from './markdownCodeRanges';

function masked(text: string): string {
	const characters = text.split('');
	for (const [from, to] of markdownCodeRanges(text)) {
		for (let index = from; index < to; index++) {
			if (characters[index] !== '\n' && characters[index] !== '\r') characters[index] = ' ';
		}
	}
	return characters.join('');
}

describe('Markdown code ranges', () => {
	it('requires a fence closer to match the marker and opener length', () => {
		const source = '````md\n```\n[[hidden]]\n````\n[[visible]]';
		expect(masked(source)).toBe('      \n   \n          \n    \n[[visible]]');
	});

	it('keeps shorter runs inside a longer inline span', () => {
		const source = '``code ` [[hidden]]`` and [[visible]]';
		expect(masked(source)).toBe('                      and [[visible]]');
	});

	it('remains linear for many unmatched delimiter runs', () => {
		const source = Array.from({ length: 20_000 }, (_, index) => '`'.repeat(index % 7 + 1)).join('x');
		const started = performance.now();
		markdownCodeRanges(source);
		expect(performance.now() - started).toBeLessThan(200);
	});
});
