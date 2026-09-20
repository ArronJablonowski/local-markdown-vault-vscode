import { describe, expect, it } from 'vitest';
import { boundedVaultExclusionPatterns, compileVaultExclusions, isVaultPathExcluded } from './vaultExclusions';

describe('vault exclusions', () => {
	it('matches names at any depth and their descendants', () => {
		expect(isVaultPathExcluded('Notes/node_modules/pkg/a.md', ['node_modules'])).toBe(true);
		expect(isVaultPathExcluded('.git/config', ['.git'])).toBe(true);
		expect(isVaultPathExcluded('Notes/ok.md', ['node_modules'])).toBe(false);
	});

	it('supports bounded glob-style patterns', () => {
		expect(isVaultPathExcluded('Private', ['Private/**'])).toBe(true);
		expect(isVaultPathExcluded('Private/secret.md', ['Private/**'])).toBe(true);
		expect(isVaultPathExcluded('Notes/draft-1.md', ['draft-?.md'])).toBe(true);
		expect(isVaultPathExcluded('Notes/finished-1.md', ['draft-?.md'])).toBe(false);
	});

	it('excludes nested folder paths and all of their descendants', () => {
		expect(isVaultPathExcluded('Notes/Private/Archive', ['Private/Archive'])).toBe(true);
		expect(isVaultPathExcluded('Notes/Private/Archive/secret.md', ['Private/Archive'])).toBe(true);
		expect(isVaultPathExcluded('Notes/Private/Public/ok.md', ['Private/Archive'])).toBe(false);
	});

	it('supports vault-root anchored patterns', () => {
		expect(isVaultPathExcluded('Private/secret.md', ['/Private/**'])).toBe(true);
		expect(isVaultPathExcluded('Notes/Private/secret.md', ['/Private/**'])).toBe(false);
	});

	it('uses explicit filesystem case behavior', () => {
		expect(isVaultPathExcluded('Notes/PRIVATE/a.md', ['private'], true)).toBe(true);
		expect(isVaultPathExcluded('Notes/PRIVATE/a.md', ['private'], false)).toBe(false);
	});

	it('ignores invalid and excessive pattern input without throwing', () => {
		const excessive = Array.from({ length: 300 }, (_, index) => index === 299 ? 'secret.md' : `ignored-${index}`);
		expect(isVaultPathExcluded('secret.md', excessive)).toBe(false);
		expect(isVaultPathExcluded('secret.md', ['x'.repeat(513), '../secret.md', ''])).toBe(false);
		expect(isVaultPathExcluded('../secret.md', ['**'])).toBe(false);
		expect(isVaultPathExcluded(`${'a/'.repeat(256)}secret.md`, ['**'])).toBe(false);
		expect(() => isVaultPathExcluded('secret.md', [42 as unknown as string])).not.toThrow();
	});

	it('compiles an immutable bounded matcher for reuse across a vault scan', () => {
		const patterns = ['/Private/**', 'draft-?.md'];
		const isExcluded = compileVaultExclusions(patterns, false);
		patterns[0] = '/Changed/**';
		expect(isExcluded('Private/secret.md')).toBe(true);
		expect(isExcluded('Changed/secret.md')).toBe(false);
		expect(isExcluded('Notes/draft-1.md')).toBe(true);
	});

	it('retains only effective bounded patterns for cache identity', () => {
		const excessive = Array.from({ length: 300 }, (_, index) => `/Folder-${index}/**`);
		expect(boundedVaultExclusionPatterns([
			'/Private/**', '../outside', '', 'x'.repeat(513), 42, ...excessive,
		])).toEqual(['/Private/**', ...excessive.slice(0, 251)]);
	});
});
