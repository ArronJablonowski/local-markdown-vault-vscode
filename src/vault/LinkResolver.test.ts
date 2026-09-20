import { describe, expect, it } from 'vitest';
import type { VaultNoteSummary } from '../shared/messages';
import { parseWikiLinkBody, resolveWikiLinkSummary, wikiHeadingSlug } from './LinkResolver';

const notes = [
	{ path: 'Folder/Note.md', basename: 'Note', aliases: ['Alias'], headings: [], blockIds: [] },
	{ path: 'Other/Note.md', basename: 'Note', aliases: [], headings: [], blockIds: [] },
];

describe('wikilink resolver', () => {
	it('parses targets, fragments, and aliases', () => {
		expect(parseWikiLinkBody('Folder/Note#Heading|Label')).toEqual({
			target: 'Folder/Note', fragment: '#Heading', alias: 'Label',
		});
	});

	it('distinguishes resolved, ambiguous, and unresolved targets', () => {
		expect(resolveWikiLinkSummary('Folder/Note', notes).kind).toBe('resolved');
		expect(resolveWikiLinkSummary('Alias', notes).kind).toBe('resolved');
		expect(resolveWikiLinkSummary('Note', notes).kind).toBe('ambiguous');
		expect(resolveWikiLinkSummary('Missing', notes).kind).toBe('unresolved');
	});

	it('prefers an exact vault path over colliding basenames and aliases', () => {
		const colliding: VaultNoteSummary[] = [
			{ path: 'Note.md', basename: 'Note', aliases: [], headings: [], blockIds: [] },
			{ path: 'Archive/Note.md', basename: 'Note', aliases: ['Note'], headings: [], blockIds: [] },
			{ path: 'Other.md', basename: 'Other', aliases: ['Note'], headings: [], blockIds: [] },
		];
		expect(resolveWikiLinkSummary('Note', colliding)).toEqual({ kind: 'resolved', note: colliding[0] });
		expect(resolveWikiLinkSummary('Archive/Note', colliding)).toEqual({ kind: 'resolved', note: colliding[1] });
	});

	it('normalizes heading slugs without executing markup', () => {
		expect(wikiHeadingSlug('Hello, World!')).toBe('hello-world');
	});
});
