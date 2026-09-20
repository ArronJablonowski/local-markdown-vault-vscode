import { describe, expect, it } from 'vitest';
import type { VaultIndexRecord } from './VaultIndex';
import type { VaultLink } from './vaultMetadata';
import { indexedLinkTargetsPath } from './backlinkResolution';

function note(path: string, aliases: string[] = []): VaultIndexRecord {
	return {
		path,
		basename: path.replace(/\.(?:md|markdown)$/i, '').split('/').pop()!,
		headings: [],
		blockIds: [],
		aliases,
		tags: [],
		properties: {},
		links: [],
		tasks: [],
		searchTokens: [],
		mtime: 0,
		size: 0,
	};
}

function link(kind: VaultLink['kind'], target: string): VaultLink {
	return { kind, target, line: 1 };
}

describe('backlink resolution', () => {
	it('resolves unique wikilink aliases and embeds', () => {
		const records = [note('People/Ada.md', ['Countess']), note('Index.md')];
		expect(indexedLinkTargetsPath('Index.md', link('wikilink', 'Countess'), 'People/Ada.md', records, true)).toBe(true);
		expect(indexedLinkTargetsPath('Index.md', link('wikiEmbed', 'Countess'), 'People/Ada.md', records, true)).toBe(true);
	});

	it('does not assign ambiguous basenames or aliases to every candidate', () => {
		const records = [note('A/Daily.md', ['Journal']), note('B/Daily.md', ['Journal'])];
		for (const target of ['A/Daily.md', 'B/Daily.md']) {
			expect(indexedLinkTargetsPath('Index.md', link('wikilink', 'Daily'), target, records, true)).toBe(false);
			expect(indexedLinkTargetsPath('Index.md', link('wikilink', 'Journal'), target, records, true)).toBe(false);
		}
		expect(indexedLinkTargetsPath('Index.md', link('wikilink', 'A/Daily'), 'A/Daily.md', records, true)).toBe(true);
	});

	it('prefers an exact root path over colliding basenames and aliases', () => {
		const records = [note('Note.md'), note('Archive/Note.md'), note('Other.md', ['Note'])];
		expect(indexedLinkTargetsPath('Source.md', link('wikilink', 'Note'), 'Note.md', records, true)).toBe(true);
		expect(indexedLinkTargetsPath('Source.md', link('wikilink', 'Note'), 'Archive/Note.md', records, true)).toBe(false);
	});

	it('resolves relative, vault-root, encoded, and query-bearing Markdown links', () => {
		const records = [note('Guides/API Notes.md'), note('Home.md')];
		expect(indexedLinkTargetsPath('Guides/Index.md', link('markdown', 'API%20Notes.md?view=1'), 'Guides/API Notes.md', records, true)).toBe(true);
		expect(indexedLinkTargetsPath('Guides/Index.md', link('markdownEmbed', '/Home.md'), 'Home.md', records, true)).toBe(true);
		expect(indexedLinkTargetsPath('Guides/Index.md', link('markdown', '../Outside.md'), 'Home.md', records, true)).toBe(false);
	});

	it('keeps wikilinks case-insensitive while honoring Markdown filesystem case', () => {
		const records = [note('People/Ada.md')];
		expect(indexedLinkTargetsPath('Index.md', link('wikilink', 'ada'), 'People/Ada.md', records, false)).toBe(true);
		expect(indexedLinkTargetsPath('People/Index.md', link('markdown', 'ada.md'), 'People/Ada.md', records, true)).toBe(true);
		expect(indexedLinkTargetsPath('People/Index.md', link('markdown', 'ada.md'), 'People/Ada.md', records, false)).toBe(false);
	});
});
