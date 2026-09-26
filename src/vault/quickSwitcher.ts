import type { VaultIndexRecord } from './VaultIndex';

/** Ranks note metadata for the Quick Switcher without reading note bodies. */
export function searchQuickSwitcherRecords(
	records: readonly VaultIndexRecord[],
	query: string,
	limit = 100,
): VaultIndexRecord[] {
	const wanted = normalize(query);
	if (!wanted) return [];
	return records
		.map((record) => ({ record, score: recordScore(record, wanted) }))
		.filter((item) => item.score >= 0)
		.sort((a, b) => b.score - a.score || b.record.mtime - a.record.mtime || a.record.path.localeCompare(b.record.path))
		.slice(0, Math.max(0, Math.min(limit, 500)))
		.map((item) => item.record);
}

/** Whether explicit creation would collide with an existing note target. */
export function hasExactQuickSwitcherRecord(records: readonly VaultIndexRecord[], query: string): boolean {
	const wanted = exactPathKey(query);
	if (!wanted) return false;
	return records.some((record) => exactPathKey(record.path) === wanted || exactPathKey(record.basename) === wanted);
}

function recordScore(record: VaultIndexRecord, query: string): number {
	const fields: Array<{ value: string; weight: number }> = [
		{ value: record.basename, weight: 1_000 },
		...record.aliases.map((value) => ({ value, weight: 900 })),
		{ value: record.path.replace(/\.(?:md|markdown)$/i, ''), weight: 800 },
		...record.headings.map((heading) => ({ value: heading.text, weight: 650 })),
	];
	let best = -1;
	for (const field of fields) {
		const value = normalize(field.value);
		if (value === query) best = Math.max(best, field.weight + 300);
		else if (value.startsWith(query)) best = Math.max(best, field.weight + 200 - Math.min(100, value.length - query.length));
		else if (value.includes(query)) best = Math.max(best, field.weight + 100 - Math.min(100, value.indexOf(query)));
		else {
			const fuzzy = fuzzySubsequenceScore(value, query);
			if (fuzzy >= 0) best = Math.max(best, field.weight + fuzzy);
		}
	}
	return best;
}

/** Returns a bounded subsequence score, rewarding adjacency and word starts. */
export function fuzzySubsequenceScore(candidate: string, query: string): number {
	if (!query || query.length > 256 || candidate.length > 4_096) return -1;
	let cursor = 0;
	let previous = -2;
	let score = 0;
	for (const character of query) {
		const found = candidate.indexOf(character, cursor);
		if (found < 0) return -1;
		const wordStart = found === 0 || /[\s/_.-]/.test(candidate[found - 1]);
		score += wordStart ? 18 : found === previous + 1 ? 12 : 4;
		score -= Math.min(8, Math.max(0, found - previous - 1));
		previous = found;
		cursor = found + character.length;
	}
	return score - Math.min(100, candidate.length - query.length);
}

function normalize(value: string): string {
	return value.normalize('NFKC').trim().toLocaleLowerCase().replace(/[\/_.-]+/g, ' ').replace(/\s+/g, ' ');
}

function exactPathKey(value: string): string {
	// Creation checks retain separators that fuzzy ranking intentionally treats like spaces.
	return value.normalize('NFKC').trim().replace(/\\/g, '/').replace(/^\.\//, '')
		.replace(/\.(?:md|markdown)$/i, '').toLocaleLowerCase();
}
