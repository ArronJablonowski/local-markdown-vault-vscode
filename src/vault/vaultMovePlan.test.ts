import { describe, expect, it } from 'vitest';
import { assignWikiTargets, assertIndependentMoves, minimalTextReplacement } from './vaultMovePlan';

describe('multi-item vault move planning', () => {
	it('accepts independent moves with distinct destinations', () => {
		expect(() => assertIndependentMoves([
			{ oldPath: 'A.md', newPath: 'Archive/A.md', isFolder: false },
			{ oldPath: 'B.md', newPath: 'Archive/B.md', isFolder: false },
		], false)).not.toThrow();
	});

	it('rejects duplicates and destination collisions before mutation', () => {
		expect(() => assertIndependentMoves([
			{ oldPath: 'A.md', newPath: 'X/A.md', isFolder: false },
			{ oldPath: 'A.md', newPath: 'Y/A.md', isFolder: false },
		], false)).toThrow(/selected more than once/);
		expect(() => assertIndependentMoves([
			{ oldPath: 'A.md', newPath: 'X/Same.md', isFolder: false },
			{ oldPath: 'B.md', newPath: 'X/Same.md', isFolder: false },
		], false)).toThrow(/same destination/);
	});

	it('rejects parent-child selections and move chains', () => {
		expect(() => assertIndependentMoves([
			{ oldPath: 'Folder', newPath: 'Archive/Folder', isFolder: true },
			{ oldPath: 'Folder/Child.md', newPath: 'Archive/Child.md', isFolder: false },
		], false)).toThrow(/descendants/);
		expect(() => assertIndependentMoves([
			{ oldPath: 'A.md', newPath: 'Folder/A.md', isFolder: false },
			{ oldPath: 'Folder', newPath: 'Archive/Folder', isFolder: true },
		], false)).toThrow(/Move chains/);
	});

	it('applies case-folded collision rules on case-insensitive systems', () => {
		expect(() => assertIndependentMoves([
			{ oldPath: 'A.md', newPath: 'Folder/Note.md', isFolder: false },
			{ oldPath: 'B.md', newPath: 'folder/note.md', isFolder: false },
		], true)).toThrow(/same destination/);
	});

	it('rejects canonically equivalent Unicode destinations before mutation', () => {
		expect(() => assertIndependentMoves([
			{ oldPath: 'A.md', newPath: 'Archive/Café.md', isFolder: false },
			{ oldPath: 'B.md', newPath: 'Archive/Cafe\u0301.md', isFolder: false },
		], false)).toThrow(/same destination/);
	});

	it('returns the smallest contiguous text replacement', () => {
		expect(minimalTextReplacement('before OLD after', 'before NEW after')).toEqual({
			from: 7,
			to: 10,
			text: 'NEW',
		});
		expect(minimalTextReplacement('same', 'same')).toBeUndefined();
	});

	it('chooses basename wikilinks when unique and paths when ambiguous', () => {
		expect(assignWikiTargets([
			{ oldPath: 'Old.md', newPath: 'Archive/New.md', isFolder: false },
		], ['Old.md', 'Other.md'], false)[0].wikiTarget).toBe('New');
		expect(assignWikiTargets([
			{ oldPath: 'Old.md', newPath: 'Archive/New.md', isFolder: false },
		], ['Old.md', 'Elsewhere/New.md'], false)[0].wikiTarget).toBe('Archive/New');
	});
});
