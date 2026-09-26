export type VaultStateKind = 'recent' | 'backlinks.filter' | 'backlinks.sort';

const SHA256_HEX = /^[a-f0-9]{64}$/;
const MAX_RECENT_PATH_LENGTH = 4_096;
const MAX_RECENT_PATHS = 100;

/** Builds a vault-scoped state key without retaining or exposing the root URI. */
export function vaultStateKey(rootHash: string, kind: VaultStateKind): string {
	if (!SHA256_HEX.test(rootHash)) throw new Error('Vault state requires a SHA-256 root identifier.');
	return `mdLivePreview.vault.${rootHash}.${kind}`;
}

/** Treat extension storage as an untrusted runtime boundary. */
export function validatedRecentPaths(value: unknown): string[] {
	// This bounds stored history only; callers must resolve every returned path in the live index.
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const paths: string[] = [];
	for (const candidate of value) {
		if (
			typeof candidate !== 'string'
			|| candidate.length === 0
			|| candidate.length > MAX_RECENT_PATH_LENGTH
			|| seen.has(candidate)
		) continue;
		seen.add(candidate);
		paths.push(candidate);
		if (paths.length === MAX_RECENT_PATHS) break;
	}
	return paths;
}
