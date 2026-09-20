import { createHash } from 'node:crypto';

/** One-way identifier for a canonical local vault URI, never the readable path. */
export function canonicalVaultRootHash(canonicalRootUri: string): string {
	let parsed: URL;
	try { parsed = new URL(canonicalRootUri); }
	catch { throw new Error('Vault identity requires a canonical file URI.'); }
	if (parsed.protocol !== 'file:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
		throw new Error('Vault identity requires a canonical file URI.');
	}
	return createHash('sha256').update(canonicalRootUri).digest('hex');
}

/** Pre-URI identifier retained only to migrate development caches and state. */
export function legacyVaultPathHash(canonicalRootPath: string): string {
	return createHash('sha256').update(canonicalRootPath).digest('hex');
}
