import { describe, expect, it } from 'vitest';
import { validatedRecentPaths, vaultStateKey } from './vaultStateKey';

describe('vault-scoped extension state keys', () => {
	const first = 'a'.repeat(64);
	const second = 'b'.repeat(64);

	it('isolates each preference by the one-way root identifier', () => {
		expect(vaultStateKey(first, 'recent')).toBe(`mdLivePreview.vault.${first}.recent`);
		expect(vaultStateKey(first, 'backlinks.filter')).not.toBe(vaultStateKey(second, 'backlinks.filter'));
	});

	it('rejects paths and malformed identifiers instead of embedding them in storage keys', () => {
		for (const value of ['', '/Users/example/Vault', '../vault', 'A'.repeat(64), 'a'.repeat(63)]) {
			expect(() => vaultStateKey(value, 'backlinks.sort')).toThrow('SHA-256');
		}
	});

	it('bounds and validates untrusted recent-note state', () => {
		expect(validatedRecentPaths({ path: 'Note.md' })).toEqual([]);
		expect(validatedRecentPaths([
			'Note.md',
			42,
			'',
			'Note.md',
			'A'.repeat(4_097),
			'Other.md',
		])).toEqual(['Note.md', 'Other.md']);
		expect(validatedRecentPaths(Array.from({ length: 110 }, (_, index) => `${index}.md`))).toHaveLength(100);
	});
});
