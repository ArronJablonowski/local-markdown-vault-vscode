import { describe, expect, it } from 'vitest';
import { findBrokenVaultLinks } from './brokenLinks';
import type { VaultIndexRecord } from './VaultIndex';

function record(path: string, links: VaultIndexRecord['links'] = [], extra: Partial<VaultIndexRecord> = {}): VaultIndexRecord {
	const basename = path.replace(/\.(?:md|markdown)$/i, '').split('/').pop()!;
	return { path, basename, aliases: [], headings: [], blockIds: [], tags: [], properties: {}, links, tasks: [], searchTokens: [], mtime: 0, size: 0, ...extra };
}

describe('broken vault links', () => {
	it('finds missing Markdown and wikilink targets while ignoring attachments', () => {
		const records = [
			record('Notes/Source.md', [
				{ kind: 'markdown', target: '../Existing.md', line: 1 },
				{ kind: 'markdown', target: '../Missing.md', line: 2 },
				{ kind: 'wikilink', target: 'Alias', line: 3 },
				{ kind: 'wikiEmbed', target: 'Assets/image.png', line: 4 },
			]),
			record('Existing.md', [], { aliases: ['Alias'] }),
		];
		expect(findBrokenVaultLinks(records, false)).toEqual([
			{ sourcePath: 'Notes/Source.md', target: '../Missing.md', line: 2, kind: 'markdown', reason: 'missing' },
		]);
	});

	it('surfaces missing headings, blocks, and ambiguous wikilinks', () => {
		const records = [
			record('Source.md', [
				{ kind: 'wikilink', target: 'Target', fragment: '#Missing', line: 1 },
				{ kind: 'wikilink', target: 'Target', fragment: '^missing', line: 2 },
				{ kind: 'wikilink', target: 'Duplicate', line: 3 },
			]),
			record('Target.md', [], { headings: [{ level: 1, text: 'Present', line: 1 }], blockIds: ['present'] }),
			record('A/Duplicate.md'), record('B/Duplicate.md'),
		];
		expect(findBrokenVaultLinks(records, false).map(({ reason, line }) => ({ reason, line }))).toEqual([
			{ reason: 'fragment', line: 1 }, { reason: 'fragment', line: 2 }, { reason: 'ambiguous', line: 3 },
		]);
	});

	it('does not report an exact root path as ambiguous with basename and alias collisions', () => {
		const records = [
			record('Source.md', [{ kind: 'wikilink', target: 'Note', line: 1 }]),
			record('Note.md'),
			record('Archive/Note.md'),
			record('Other.md', [], { aliases: ['Note'] }),
		];
		expect(findBrokenVaultLinks(records)).toEqual([]);
	});

	it('keeps wikilinks case-insensitive on case-sensitive filesystems', () => {
		const records = [
			record('Source.md', [
				{ kind: 'wikilink', target: 'target', line: 1 },
				{ kind: 'wikilink', target: 'alternate name', line: 2 },
				{ kind: 'markdown', target: 'target.md', line: 3 },
			]),
			record('Target.md', [], { aliases: ['Alternate Name'] }),
		];
		expect(findBrokenVaultLinks(records, false)).toEqual([
			{ sourcePath: 'Source.md', target: 'target.md', line: 3, kind: 'markdown', reason: 'missing' },
		]);
	});
});
