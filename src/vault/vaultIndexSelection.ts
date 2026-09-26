import { compileVaultExclusions } from './vaultExclusions';

export const MAX_INDEXED_VAULT_NOTES = 10_000;
export const MAX_DISCOVERED_MARKDOWN_FILES = 100_000;

export type IndexCandidateSelection<T> =
	| { kind: 'ok'; candidates: Array<{ item: T; path: string }> }
	| { kind: 'scanLimit' }
	| { kind: 'noteLimit' };

/**
 * Applies extension exclusions before enforcing the user-visible note limit.
 * Discovery has a separate, higher ceiling so a large ignored subtree cannot
 * silently create an unbounded URI list, but also does not consume the 10,000
 * useful-note budget.
 */
export function selectIndexCandidates<T>(
	candidates: readonly { item: T; path: string }[],
	exclusions: readonly string[],
	discoveryTruncated: boolean,
	caseInsensitive = process.platform !== 'linux',
): IndexCandidateSelection<T> {
	// A truncated discovery cannot establish completeness, even if its visible subset is small.
	if (discoveryTruncated) return { kind: 'scanLimit' };
	const isExcluded = compileVaultExclusions(exclusions, caseInsensitive);
	const included = candidates.filter(({ path }) => !isExcluded(path));
	if (included.length > MAX_INDEXED_VAULT_NOTES) return { kind: 'noteLimit' };
	return { kind: 'ok', candidates: included };
}
