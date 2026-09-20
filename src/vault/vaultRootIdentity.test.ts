import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalVaultRootHash, legacyVaultPathHash } from './vaultRootIdentity';

describe('canonical vault root identity', () => {
	it('hashes the canonical file URI instead of embedding or hashing the raw path', () => {
		const uri = 'file:///Users/example/My%20Vault';
		const path = '/Users/example/My Vault';
		expect(canonicalVaultRootHash(uri)).toBe(createHash('sha256').update(uri).digest('hex'));
		expect(canonicalVaultRootHash(uri)).not.toBe(legacyVaultPathHash(path));
		expect(canonicalVaultRootHash(uri)).toMatch(/^[a-f0-9]{64}$/);
	});

	it('rejects raw paths, remote schemes, credentials, queries, and fragments', () => {
		for (const value of [
			'/Users/example/Vault',
			'https://example.invalid/vault',
			'file://user:password@host/Vault',
			'file:///Vault?secret=true',
			'file:///Vault#fragment',
		]) expect(() => canonicalVaultRootHash(value)).toThrow('canonical file URI');
	});
});
