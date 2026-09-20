import { describe, expect, it } from 'vitest';
import { extractWikiEmbedContent } from './embedContent';

const note = `---
title: Test
---
# One
Intro

## Child
Child text

# Two
Before
target paragraph ^block-id
After
`;

describe('extractWikiEmbedContent', () => {
	it('omits frontmatter from a whole-note embed', () => {
		const result = extractWikiEmbedContent(note, '')!;
		expect(result).toContain('# One');
		expect(result).not.toContain('title: Test');
	});

	it('extracts a heading through its child headings', () => {
		expect(extractWikiEmbedContent(note, '#One')).toBe('# One\nIntro\n\n## Child\nChild text');
	});

	it('extracts and removes a block marker', () => {
		expect(extractWikiEmbedContent(note, '^block-id')).toBe('Before\ntarget paragraph\nAfter');
	});

	it('returns undefined for a missing or malformed fragment', () => {
		expect(extractWikiEmbedContent(note, '#Missing')).toBeUndefined();
		expect(extractWikiEmbedContent(note, '^../bad')).toBeUndefined();
	});
});
