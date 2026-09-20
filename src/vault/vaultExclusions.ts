const MAX_EXCLUSION_PATTERNS = 256;
const MAX_PATTERN_LENGTH = 512;
const MAX_PATTERN_SEGMENTS = 64;
const MAX_RELATIVE_PATH_LENGTH = 4096;
const MAX_RELATIVE_PATH_SEGMENTS = 256;

interface CompiledExclusionPattern {
	rootAnchored: boolean;
	segments: readonly string[];
}

export type VaultExclusionMatcher = (relativePath: string) => boolean;

/** Returns only the bounded patterns that can affect extension behavior. */
export function boundedVaultExclusionPatterns(patterns: readonly unknown[]): string[] {
	const bounded: string[] = [];
	for (let index = 0; index < Math.min(patterns.length, MAX_EXCLUSION_PATTERNS); index++) {
		const rawPattern = patterns[index];
		if (typeof rawPattern !== 'string'
			|| rawPattern.length === 0
			|| rawPattern.length > MAX_PATTERN_LENGTH
			|| rawPattern.includes('\0')) continue;
		const normalizedPattern = normalize(rawPattern).replace(/^\/+/, '');
		if (!normalizedPattern) continue;
		const segments = normalizedPattern.split('/');
		if (
			segments.length > MAX_PATTERN_SEGMENTS
			|| segments.some((segment) => segment === '' || segment === '.' || segment === '..')
		) continue;
		bounded.push(rawPattern);
	}
	return bounded;
}

function normalize(value: string): string {
	return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function matchesSegment(value: string, pattern: string): boolean {
	let valueIndex = 0;
	let patternIndex = 0;
	let starIndex = -1;
	let retryValueIndex = -1;

	while (valueIndex < value.length) {
		const patternCharacter = pattern[patternIndex];
		if (patternCharacter === '?' || patternCharacter === value[valueIndex]) {
			valueIndex++;
			patternIndex++;
			continue;
		}
		if (patternCharacter === '*') {
			starIndex = patternIndex++;
			retryValueIndex = valueIndex;
			continue;
		}
		if (starIndex >= 0) {
			patternIndex = starIndex + 1;
			valueIndex = ++retryValueIndex;
			continue;
		}
		return false;
	}

	while (pattern[patternIndex] === '*') patternIndex++;
	return patternIndex === pattern.length;
}

/**
 * Matches a path against a bounded, segment-aware glob. A completed pattern
 * also matches descendants so excluding a folder excludes its entire subtree.
 */
function matchesPath(pathSegments: readonly string[], patternSegments: readonly string[], rootAnchored: boolean): boolean {
	const effectivePattern = rootAnchored || patternSegments[0] === '**'
		? patternSegments
		: ['**', ...patternSegments];
	const memo = new Map<string, boolean>();

	const visit = (pathIndex: number, patternIndex: number): boolean => {
		const key = `${pathIndex}:${patternIndex}`;
		const cached = memo.get(key);
		if (cached !== undefined) return cached;

		let result: boolean;
		if (patternIndex === effectivePattern.length) {
			result = true;
		} else if (effectivePattern[patternIndex] === '**') {
			result = visit(pathIndex, patternIndex + 1)
				|| (pathIndex < pathSegments.length && visit(pathIndex + 1, patternIndex));
		} else {
			result = pathIndex < pathSegments.length
				&& matchesSegment(pathSegments[pathIndex], effectivePattern[patternIndex])
				&& visit(pathIndex + 1, patternIndex + 1);
		}

		memo.set(key, result);
		return result;
	};

	return visit(0, 0);
}

/**
 * Returns whether a vault-relative path is excluded from extension-managed
 * views and indexes. Patterns are deliberately bounded and support `*`, `?`,
 * and whole-segment `**`. A leading slash anchors a pattern to the vault root;
 * other patterns match at any depth. Case behavior defaults to the host
 * filesystem convention and can be supplied explicitly for deterministic use.
 */
export function isVaultPathExcluded(
	relativePath: string,
	patterns: readonly string[],
	caseInsensitive = process.platform !== 'linux',
): boolean {
	return compileVaultExclusions(patterns, caseInsensitive)(relativePath);
}

/**
 * Compiles bounded workspace patterns once for a complete vault operation.
 * Large rebuilds and rewrite scans must not re-normalize up to 256 patterns
 * for every one of the 100,000 discoverable Markdown paths.
 */
export function compileVaultExclusions(
	patterns: readonly string[],
	caseInsensitive = process.platform !== 'linux',
): VaultExclusionMatcher {
	const compiled: CompiledExclusionPattern[] = [];
	for (const rawPattern of boundedVaultExclusionPatterns(patterns)) {
		const rootAnchored = rawPattern.startsWith('/') || rawPattern.startsWith('\\');
		const normalizedPattern = normalize(rawPattern).replace(/^\/+/, '');
		const rawPatternSegments = normalizedPattern.split('/');
		compiled.push({
			rootAnchored,
			segments: caseInsensitive
				? rawPatternSegments.map((segment) => segment.toLocaleLowerCase('en-US'))
				: rawPatternSegments,
		});
	}

	return (relativePath: string): boolean => {
		if (relativePath.length === 0 || relativePath.length > MAX_RELATIVE_PATH_LENGTH) return false;
		const normalizedPath = normalize(relativePath);
		if (!normalizedPath || normalizedPath.startsWith('/') || normalizedPath.includes('\0')) return false;
		const rawPathSegments = normalizedPath.split('/');
		if (
			rawPathSegments.length > MAX_RELATIVE_PATH_SEGMENTS
			|| rawPathSegments.some((segment) => segment === '' || segment === '.' || segment === '..')
		) return false;
		const pathSegments = caseInsensitive
			? rawPathSegments.map((segment) => segment.toLocaleLowerCase('en-US'))
			: rawPathSegments;

		return compiled.some((pattern) => matchesPath(pathSegments, pattern.segments, pattern.rootAnchored));
	};
}
