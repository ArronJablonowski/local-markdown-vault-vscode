import { describe, expect, it } from 'vitest';
import { validateOpenIndexedPathArguments, validateSearchTagArgument } from './knowledgeCommandValidation';

describe('knowledge command validation', () => {
	it('accepts canonical indexed paths and bounded one-based lines', () => {
		expect(validateOpenIndexedPathArguments('Notes/Plan.md', undefined)).toEqual({ path: 'Notes/Plan.md' });
		expect(validateOpenIndexedPathArguments('日本語/計画.markdown', 42)).toEqual({ path: '日本語/計画.markdown', line: 42 });
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
		expect(validateSearchTagArgument('計画/進行中')).toBe('計画/進行中');
		for (const value of [undefined, {}, '', '#tag', '/tag', 'tag/', 'tag//child', 'tag OR file:secret', 'tag with spaces', 'tag\nOR path:any', 'a'.repeat(513)]) {
			expect(validateSearchTagArgument(value)).toBeUndefined();
		}
	});
});
