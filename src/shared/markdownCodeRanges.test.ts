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
	it('preserves container-nested and indented code including CRLF source positions', () => {
		const source = '> > ~~~md\r\n> > [[hidden]]\r\n> > ~~~\r\n\r\n    [[indented]]\r\n\r\n[[visible]]';
		const result = masked(source);
		expect(result).not.toContain('hidden');
		expect(result).not.toContain('indented');
		expect(result).toContain('[[visible]]');
		expect(result.length).toBe(source.length);
	});
	it('supports multiline code spans without treating escaped openers as code', () => {
		expect(masked('`first\n[[hidden]]`\n\n\\` [[visible]] \\`')).not.toContain('hidden');
		expect(masked('`first\n[[hidden]]`\n\n\\` [[visible]] \\`')).toContain('[[visible]]');
	});
	it('does not pair backticks across separate GFM table cells', () => {
		expect(masked('| `unfinished | [[visible]] ` |\n| --- | --- |')).toContain('[[visible]]');
		expect(masked('| `[[hidden]]` | [[visible]] |\n| --- | --- |')).not.toContain('hidden');
	});
});
