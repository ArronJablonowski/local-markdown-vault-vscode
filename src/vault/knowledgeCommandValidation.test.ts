import { describe, expect, it } from 'vitest';
import { validateOpenIndexedPathArguments, validateSearchTagArgument } from './knowledgeCommandValidation';

describe('knowledge command validation', () => {
	it('accepts canonical indexed paths and bounded one-based lines', () => {
		expect(validateOpenIndexedPathArguments('Notes/Plan.md', undefined)).toEqual({ path: 'Notes/Plan.md' });
		expect(validateOpenIndexedPathArguments('\u65e5\u672c\u8a9e/\u8a08\u753b.markdown', 42)).toEqual({ path: '\u65e5\u672c\u8a9e/\u8a08\u753b.markdown', line: 42 });
	});

	it.each([
		[undefined, undefined],
		[{}, undefined],
		['', undefined],
		['/etc/passwd', undefined],
		['C:\\outside.md', undefined],
		['Notes\\Plan.md', undefined],
		['../outside.md', undefined],
		['Notes//Plan.md', undefined],
		['Notes/Plan.md\0suffix', undefined],
		['Notes/Plan.md', 0],
		['Notes/Plan.md', -1],
		['Notes/Plan.md', 1.5],
		['Notes/Plan.md', Number.NaN],
		['Notes/Plan.md', Number.POSITIVE_INFINITY],
		['Notes/Plan.md', 10_000_001],
		['Notes/Plan.md', '1'],
		[`${'a'.repeat(4094)}.md`, undefined],
	])('rejects malformed indexed navigation arguments %#', (path, line) => {
		expect(validateOpenIndexedPathArguments(path, line)).toBeUndefined();
	});

	it('accepts nested Unicode tags and rejects query syntax', () => {
		expect(validateSearchTagArgument('research/local')).toBe('research/local');
		expect(validateSearchTagArgument('\u8a08\u753b/\u9032\u884c\u4e2d')).toBe('\u8a08\u753b/\u9032\u884c\u4e2d');
		for (const value of [undefined, {}, '', '#tag', '/tag', 'tag/', 'tag//child', 'tag OR file:secret', 'tag with spaces', 'tag\nOR path:any', 'a'.repeat(513)]) {
			expect(validateSearchTagArgument(value)).toBeUndefined();
		}
	});
});
