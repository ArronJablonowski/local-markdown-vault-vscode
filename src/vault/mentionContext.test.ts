import { describe, expect, it } from 'vitest';
import { findMentionContext } from './mentionContext';

describe('mention context', () => {
	it('returns a bounded line and skips fenced code', () => {
		const text = '```\nProject Atlas in code\n```\nSee [[Project Atlas]] for details.\n';
		expect(findMentionContext(text, ['Project Atlas'])).toEqual({ line: 4, context: 'See [[Project Atlas]] for details.' });
	});

	it('matches aliases case-insensitively', () => {
		expect(findMentionContext('Discuss PRIMARY plan', ['missing', 'Primary'])).toEqual({ line: 1, context: 'Discuss PRIMARY plan' });
	});

	it('requires Unicode-aware word edges and ignores inline code', () => {
		expect(findMentionContext('A partial result is not the same as art.', ['Art'])).toEqual({
			line: 1,
			context: 'A partial result is not the same as art.',
		});
		expect(findMentionContext('Only partial exists.', ['Art'])).toBeUndefined();
		expect(findMentionContext('`Project Atlas` is code.\nDiscuss Project Atlas here.', ['Project Atlas'])).toEqual({
			line: 2,
			context: 'Discuss Project Atlas here.',
		});
		expect(findMentionContext('超芸術家 and 芸術 are different.', ['芸術'])).toEqual({
			line: 1,
			context: '超芸術家 and 芸術 are different.',
		});
	});
});
