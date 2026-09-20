import { describe, expect, it } from 'vitest';
import { fuzzySubsequenceScore, hasExactQuickSwitcherRecord, searchQuickSwitcherRecords } from './quickSwitcher';
import type { VaultIndexRecord } from './VaultIndex';

function note(path: string, aliases: string[] = [], headings: string[] = [], mtime = 0): VaultIndexRecord {
	return {
		path, basename: path.replace(/\.(?:md|markdown)$/i, '').split('/').pop()!, aliases,
		headings: headings.map((text, index) => ({ level: 1, text, line: index + 1 })),
		blockIds: [], tags: [], properties: {}, links: [], tasks: [], searchTokens: [], size: 0, mtime,
	};
}

describe('Quick Switcher fuzzy ranking', () => {
	const records = [
		note('Projects/Network Plan.md', ['Infrastructure Roadmap'], ['Deployment Notes'], 1),
		note('Personal/Notebook.md', [], [], 3),
		note('Archive/Networking.md', [], [], 2),
	];

	it('finds filename abbreviations that are not substrings', () => {
		expect(searchQuickSwitcherRecords(records, 'ntpln')[0]?.basename).toBe('Network Plan');
	});

	it('matches aliases, paths, and headings while preferring exact filenames', () => {
		expect(searchQuickSwitcherRecords(records, 'Infrastructure Roadmap')[0]?.basename).toBe('Network Plan');
		expect(searchQuickSwitcherRecords(records, 'projects network')[0]?.basename).toBe('Network Plan');
		expect(searchQuickSwitcherRecords(records, 'deploy notes')[0]?.basename).toBe('Network Plan');
		expect(searchQuickSwitcherRecords(records, 'Notebook')[0]?.basename).toBe('Notebook');
	});

	it('rejects non-subsequences and bounds pathological inputs', () => {
		expect(fuzzySubsequenceScore('network plan', 'xyz')).toBe(-1);
		expect(fuzzySubsequenceScore('network plan', 'x'.repeat(257))).toBe(-1);
	});

	it('detects exact basename and vault-relative path targets before offering creation', () => {
		expect(hasExactQuickSwitcherRecord(records, 'Network Plan')).toBe(true);
		expect(hasExactQuickSwitcherRecord(records, 'Projects/Network Plan.md')).toBe(true);
		expect(hasExactQuickSwitcherRecord(records, '.\\Projects\\Network Plan')).toBe(true);
		expect(hasExactQuickSwitcherRecord(records, 'Other/Network Plan')).toBe(false);
	});
});
