import type { VaultIndex, VaultIndexRecord } from './VaultIndex';
import { findVaultContentMatch, parseVaultQuery } from './vaultSearchQuery';

// Keep on-demand reads within the index's existing 500-candidate search cap.
const MAX_CONTEXT_SEARCH_CANDIDATES = 500;

export interface VaultSearchResult {
	record: VaultIndexRecord;
	line?: number;
	heading?: string;
	context?: string;
}

export async function searchVaultWithContext(
	index: VaultIndex,
	query: string,
	limit = 200,
	signal?: AbortSignal,
): Promise<VaultSearchResult[]> {
	const resultLimit = Math.max(0, Math.min(Math.floor(limit), 200));
	const parsed = parseVaultQuery(query);
	if (!parsed || !Number.isFinite(resultLimit) || resultLimit === 0 || signal?.aborted) return [];
	await index.flushDocumentUpdates();
	if (signal?.aborted) return [];
	const requiresAuthoritativeText = parsed.groups.some((group) => group.some((clause) =>
		clause.kind !== 'filter' || (clause.field === 'property' && clause.value.includes('='))));
	const candidateLimit = requiresAuthoritativeText ? MAX_CONTEXT_SEARCH_CANDIDATES : resultLimit;
	const candidates = index.search(query, candidateLimit).slice(0, candidateLimit);
	if (!requiresAuthoritativeText) {
		return !signal?.aborted ? candidates.map((record) => ({ record })) : [];
	}
	const results: Array<VaultSearchResult | undefined> = new Array(candidates.length);
	let cursor = 0;
	let matchedCount = 0;
	const worker = async (): Promise<void> => {
		while (!signal?.aborted && cursor < candidates.length && matchedCount < resultLimit) {
			const position = cursor++;
			const record = candidates[position];
			const text = await index.readText(record.path);
			if (signal?.aborted) return;
			if (text === undefined) continue;
			const match = findVaultContentMatch(record, text, query);
			if (!match) continue;
			results[position] = toResult(record, text, match.index, match.length);
			matchedCount++;
		}
	};
	await Promise.all(Array.from({ length: Math.min(8, candidates.length) }, () => worker()));
	if (signal?.aborted) return [];
	return results.filter((result): result is VaultSearchResult => Boolean(result)).slice(0, resultLimit);
}

function toResult(record: VaultIndexRecord, text: string, index: number, length: number): VaultSearchResult {
	if (!text || length === 0) {
		const heading = record.headings.find((item) => item.text.toLocaleLowerCase().includes(record.basename.toLocaleLowerCase()))?.text;
		return { record, ...(heading ? { heading } : {}) };
	}
	const before = text.slice(0, index);
	const line = before.split(/\r?\n/).length;
	const lineStart = Math.max(before.lastIndexOf('\n') + 1, index - 100);
	const newline = text.indexOf('\n', index + length);
	const lineEnd = Math.min(newline < 0 ? text.length : newline, index + length + 140);
	const raw = text.slice(lineStart, lineEnd).replace(/\s+/g, ' ').trim();
	const context = `${lineStart > before.lastIndexOf('\n') + 1 ? '…' : ''}${raw}${lineEnd < (newline < 0 ? text.length : newline) ? '…' : ''}`;
	const heading = [...record.headings].reverse().find((item) => item.line <= line)?.text;
	return { record, line, ...(heading ? { heading } : {}), ...(context ? { context } : {}) };
}
