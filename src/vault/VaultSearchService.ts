import type { VaultIndex, VaultIndexRecord } from './VaultIndex';
import { findParsedVaultContentMatch, findVaultContentMatch, findVaultKeywordMatch, parseVaultQuery, type ParsedVaultQuery } from './vaultSearchQuery';

// Keep on-demand reads within the index's existing 500-candidate search cap.
const MAX_CONTEXT_SEARCH_CANDIDATES = 500;

export interface VaultSearchResult {
	record: VaultIndexRecord;
	line?: number;
	heading?: string;
	context?: string;
}

export interface VaultSearchProgress {
	total: number;
	scanned: number;
	matches: number;
	unreadable: number;
}

export interface VaultDocumentSearch extends VaultSearchProgress {
	status: 'complete' | 'empty' | 'invalid' | 'canceled' | 'unavailable';
	results: VaultSearchResult[];
}

export interface VaultDocumentSearchOptions {
	mode?: 'keyword' | 'advanced';
	signal?: AbortSignal;
	onProgress?: (progress: VaultSearchProgress) => void;
}

/**
 * Searches every indexed note using current, containment-checked text instead
 * of the intentionally incomplete token index. Only bounded result snippets,
 * not note bodies, survive each read. Existing index limits still apply.
 */
export async function searchVaultDocuments(
	index: VaultIndex,
	query: string,
	options: VaultDocumentSearchOptions = {},
): Promise<VaultDocumentSearch> {
	const { signal, onProgress, mode = 'keyword' } = options;
	const progress: VaultSearchProgress = { total: 0, scanned: 0, matches: 0, unreadable: 0 };
	const report = (status: VaultDocumentSearch['status'], results: VaultSearchResult[] = []): VaultDocumentSearch => ({
		...progress, status, results,
	});
	if (signal?.aborted) return report('canceled');
	if (query.length > 2048) return report('invalid');
	const keyword = query.trim();
	const parsed: ParsedVaultQuery | undefined = mode === 'advanced' ? parseVaultQuery(query)
		: { groups: keyword ? [[{ kind: 'text', value: keyword.toLocaleLowerCase(), exact: true, negated: false }]] : [] };
	if (!parsed) return report('invalid');
	if (!parsed.groups.length) return report('empty');
	if (!await index.waitForRebuild(signal)) return report(signal?.aborted ? 'canceled' : 'unavailable');
	if (signal?.aborted) return report('canceled');
	await index.flushDocumentUpdates();
	if (signal?.aborted) return report('canceled');
	if (!await index.waitForRebuild(signal)) return report(signal?.aborted ? 'canceled' : 'unavailable');
	if (signal?.aborted) return report('canceled');
	const candidates = index.all();
	progress.total = candidates.length;
	onProgress?.({ ...progress });
	const results: VaultSearchResult[] = [];
	let cursor = 0;
	const worker = async (): Promise<void> => {
		let processed = 0;
		while (!signal?.aborted && cursor < candidates.length) {
			const record = candidates[cursor++];
			let text: string | undefined;
			try { text = await index.readText(record.path); }
			catch { /* A failed read is reported, never mistaken for an empty note. */ }
			if (signal?.aborted) return;
			progress.scanned++;
			if (text === undefined) progress.unreadable++;
			const match = text === undefined ? undefined : mode === 'advanced'
				? findParsedVaultContentMatch(record, text, parsed)
				: findVaultKeywordMatch(record, text, keyword);
			if (match) {
				results.push(toResult(record, text ?? '', match.index, match.length));
				progress.matches++;
			}
			if (progress.scanned % 32 === 0 || progress.scanned === progress.total) onProgress?.({ ...progress });
			// Open-document reads can resolve synchronously. Yield periodically so
			// typing and cancellation are not starved by a large in-memory vault.
			if (++processed % 8 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
		}
	};
	await Promise.all(Array.from({ length: Math.min(8, candidates.length) }, () => worker()));
	if (signal?.aborted) return report('canceled');
	const ranked = results.map((result) => ({ result, titleScore: scoreTitle(result.record, parsed) }));
	ranked.sort((a, b) => b.titleScore - a.titleScore || a.result.record.path.localeCompare(b.result.record.path));
	return report('complete', ranked.map(({ result }) => result));
}

function scoreTitle(record: VaultIndexRecord, query: ParsedVaultQuery): number {
	const title = record.basename.toLocaleLowerCase();
	let score = 0;
	for (const group of query.groups) {
		for (const clause of group) {
			if (clause.negated) continue;
			if (clause.kind === 'text' && title.includes(clause.value)) {
				score = Math.max(score, title === clause.value ? 3 : title.startsWith(clause.value) ? 2 : 1);
			} else if (clause.kind === 'regex' && clause.value.test(record.basename)) score = Math.max(score, 1);
		}
	}
	return score;
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
	// A regular expression may match nearly the entire document. Its result
	// still needs a small snippet, not a second retained copy of the note.
	const lineEnd = Math.min(newline < 0 ? text.length : newline, index + Math.min(length, 160) + 140);
	const raw = text.slice(lineStart, lineEnd).replace(/\s+/g, ' ').trim();
	const context = `${lineStart > before.lastIndexOf('\n') + 1 ? '…' : ''}${raw}${lineEnd < (newline < 0 ? text.length : newline) ? '…' : ''}`;
	const heading = [...record.headings].reverse().find((item) => item.line <= line)?.text;
	return { record, line, ...(heading ? { heading } : {}), ...(context ? { context } : {}) };
}
