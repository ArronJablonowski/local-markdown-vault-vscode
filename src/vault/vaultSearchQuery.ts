import type { VaultIndexRecord } from './VaultIndex';
import { RE2JS } from 're2js';
import { extractVaultPropertyValues } from './vaultMetadata';

type FilterField = 'file' | 'path' | 'tag' | 'task' | 'property';

export type VaultQueryClause =
	| { kind: 'text'; value: string; exact: boolean; negated: boolean }
	| { kind: 'regex'; value: RE2JS; negated: boolean }
	| { kind: 'filter'; field: FilterField; value: string; negated: boolean };

export interface ParsedVaultQuery {
	/** Clauses within a group are ANDed; any successful group satisfies OR. */
	groups: VaultQueryClause[][];
}

export function parseVaultQuery(query: string): ParsedVaultQuery | undefined {
	if (query.length > 2048) return undefined;
	const groups: VaultQueryClause[][] = [[]];
	for (const rawToken of tokenize(query)) {
		if (rawToken.value === 'OR' && !rawToken.quoted) {
			if (groups.at(-1)?.length) groups.push([]);
			continue;
		}
		let value = rawToken.value;
		let negated = rawToken.negated;
		if (!rawToken.quoted && value.startsWith('-') && value.length > 1) {
			negated = true;
			value = value.slice(1);
		}
		// Fully quoted text is always literal, including names that otherwise
		// introduce a filter. The tokenizer preserves negation separately.
		const filter = rawToken.quoted ? null : /^(file|path|tag|task|property):(.*)$/i.exec(value);
		if (filter) {
			groups.at(-1)!.push({ kind: 'filter', field: filter[1].toLocaleLowerCase() as FilterField, value: filter[2], negated });
			continue;
		}
		if (!rawToken.quoted && value.startsWith('/') && value.lastIndexOf('/') > 0) {
			const slash = value.lastIndexOf('/');
			const source = value.slice(1, slash);
			const flags = value.slice(slash + 1);
			if (!source || source.length > 128 || !isSupportedRegexFlags(flags)) return undefined;
			try {
				// RE2 avoids backtracking attacks; the program cap also bounds compiled query size.
				const expression = RE2JS.compile(source, flags.includes('i') ? RE2JS.CASE_INSENSITIVE : 0);
				if (expression.programSize() > 1_000) return undefined;
				groups.at(-1)!.push({ kind: 'regex', value: expression, negated });
			}
			catch { return undefined; }
			continue;
		}
		if (value) groups.at(-1)!.push({ kind: 'text', value: value.toLocaleLowerCase(), exact: rawToken.quoted, negated });
	}
	return { groups: groups.filter((group) => group.length) };
}

export function searchVaultRecords(records: readonly VaultIndexRecord[], query: string, limit = 100): VaultIndexRecord[] {
	const parsed = parseVaultQuery(query);
	if (!parsed) return [];
	if (!parsed.groups.length) return [...records].sort((a, b) => b.mtime - a.mtime).slice(0, limit);
	return records
		.map((record) => ({ record, score: score(record, parsed) }))
		.filter((result) => result.score >= 0)
		.sort((a, b) => b.score - a.score || a.record.path.localeCompare(b.record.path))
		.slice(0, Math.max(0, Math.min(limit, 500)))
		.map((result) => result.record);
}

function score(record: VaultIndexRecord, query: ParsedVaultQuery): number {
	let best = -1;
	for (const group of query.groups) {
		let groupScore = 0;
		let matches = true;
		for (const clause of group) {
			const result = matchClause(record, clause);
			// A privacy-reduced property value is deliberately unknown during the
			// candidate pass. Positive filters already retain it as a possible match;
			// negated filters must do the same or `-property:key=value` would discard
			// every note that merely has `key`, before the authoritative note can be
			// checked by `findVaultContentMatch`.
			const unknownNegatedProperty = clause.negated && isUnknownPropertyValue(record, clause);
			// Tokens retain neither order nor adjacency. Finding every word of a
			// negated phrase is not evidence that the phrase occurs in the note.
			const unknownNegatedPhrase = clause.negated && clause.kind === 'text' && clause.exact && /\s/.test(clause.value);
			if (!unknownNegatedProperty && !unknownNegatedPhrase && (clause.negated ? result.matched : !result.matched)) {
				matches = false;
				break;
			}
			if (!clause.negated) groupScore += result.score;
		}
		if (matches) best = Math.max(best, groupScore);
	}
	return best;
}

function isUnknownPropertyValue(record: VaultIndexRecord, clause: VaultQueryClause): boolean {
	if (clause.kind !== 'filter' || clause.field !== 'property') return false;
	const equal = clause.value.indexOf('=');
	if (equal < 0) return false;
	const key = clause.value.slice(0, equal).toLocaleLowerCase();
	return Object.entries(record.properties).some(([name, value]) => name.toLocaleLowerCase() === key && value === null);
}

function matchClause(record: VaultIndexRecord, clause: VaultQueryClause): { matched: boolean; score: number } {
	const name = record.basename.toLocaleLowerCase();
	const path = record.path.toLocaleLowerCase();
	const searchable = boundedSearchText(record);
	if (clause.kind === 'regex') return { matched: clause.value.test(searchable), score: 15 };
	if (clause.kind === 'filter') {
		const value = clause.value.toLocaleLowerCase();
		switch (clause.field) {
			case 'file': return { matched: name.includes(value), score: 50 };
			case 'path': return { matched: path.includes(value), score: 40 };
			case 'tag': return { matched: record.tags.some((tag) => tag === value.replace(/^#/, '') || tag.startsWith(`${value.replace(/^#/, '')}/`)), score: 50 };
			case 'task': {
				const wanted = value || 'any';
				return { matched: record.tasks.some((task) => wanted === 'any' || (wanted === 'done' && task.completed) || ((wanted === 'open' || wanted === 'todo') && !task.completed) || task.text.toLocaleLowerCase().includes(wanted)), score: 30 };
			}
			case 'property': {
				const equal = value.indexOf('=');
				const key = equal < 0 ? value : value.slice(0, equal);
				const expected = equal < 0 ? undefined : value.slice(equal + 1);
				const entry = Object.entries(record.properties).find(([name]) => name.toLocaleLowerCase() === key);
				// A null value is the privacy-preserving producer form: the key is a
				// candidate and authoritative text verification decides value matches.
				return { matched: Boolean(entry && (expected === undefined || entry[1] === null || propertyText(entry[1]).includes(expected))), score: 40 };
			}
		}
	}
	const value = clause.value;
	// The index intentionally retains only lightweight tokens, not note bodies or
	// positional data. A quoted phrase therefore uses all of its words for the
	// candidate pass; `findVaultContentMatch` verifies adjacency and order against
	// the authoritative text before a result is shown.
	const matched = clause.exact && /\s/.test(value)
		? value.split(/\s+/).filter(Boolean).every((part) => searchable.includes(part))
		: searchable.includes(value);
	if (!matched) return { matched: false, score: 0 };
	if (name === value) return { matched: true, score: 100 };
	if (name.startsWith(value)) return { matched: true, score: 70 };
	if (record.aliases.some((alias) => alias.toLocaleLowerCase() === value)) return { matched: true, score: 80 };
	return { matched: true, score: clause.exact ? 30 : 10 };
}

export interface VaultContentMatch { index: number; length: number }

/** Literal, case-insensitive title/body matching for the default search UI. */
export function findVaultKeywordMatch(record: VaultIndexRecord, text: string, keyword: string): VaultContentMatch | undefined {
	const value = keyword.toLocaleLowerCase();
	const body = text.toLocaleLowerCase();
	const index = body.indexOf(value);
	if (index >= 0) return originalTextMatch(text, body, index, value.length);
	return record.basename.toLocaleLowerCase().includes(value) ? { index: 0, length: 0 } : undefined;
}

/** Rechecks an index candidate against authoritative note text and locates its first body match. */
export function findVaultContentMatch(record: VaultIndexRecord, text: string, query: string): VaultContentMatch | undefined {
	const parsed = parseVaultQuery(query);
	if (!parsed) return undefined;
	return findParsedVaultContentMatch(record, text, parsed);
}

/** Reuses a parsed query across a full-vault search without retaining note bodies. */
export function findParsedVaultContentMatch(record: VaultIndexRecord, text: string, parsed: ParsedVaultQuery): VaultContentMatch | undefined {
	if (!parsed.groups.length) return { index: 0, length: 0 };
	const body = text.toLocaleLowerCase();
	const metadataFields = [
		record.basename, record.path, ...record.aliases, ...record.headings.map((heading) => heading.text),
		...record.tags, ...Object.entries(record.properties).flatMap(([key, value]) => [key, propertyText(value)]),
	];
	const foldedMetadata = metadataFields.map((value) => value.toLocaleLowerCase());
	// Keep this memo per note, never across edits or searches with different content.
	const textMatches = new Map<string, { bodyMatch?: VaultContentMatch; metadataMatched: boolean }>();
	let authoritativeProperties: Readonly<Record<string, unknown>> | undefined;
	for (const group of parsed.groups) {
		let valid = true;
		let firstText: { match: VaultContentMatch; order: number } | undefined;
		let firstRegex: { match: VaultContentMatch; order: number } | undefined;
		for (const [order, clause] of group.entries()) {
			if (clause.kind === 'filter') {
				const matched = clause.field === 'property' && clause.value.includes('=')
					? matchAuthoritativeProperty(
						record,
						clause.value,
						() => authoritativeProperties ??= extractVaultPropertyValues(text),
					)
					: matchClause(record, clause).matched;
				if (clause.negated ? matched : !matched) { valid = false; break; }
				continue;
			}
			let bodyMatch: VaultContentMatch | undefined;
			let metadataMatched = false;
			if (clause.kind === 'text') {
				let cached = textMatches.get(clause.value);
				if (!cached) {
					const index = body.indexOf(clause.value);
					cached = {
						...(index >= 0 ? { bodyMatch: { index, length: clause.value.length } } : {}),
						metadataMatched: foldedMetadata.some((field) => field.includes(clause.value)),
					};
					textMatches.set(clause.value, cached);
				}
				({ bodyMatch, metadataMatched } = cached);
			} else {
				const bodyResult = clause.value.matchAll(text).next().value;
				if (bodyResult?.index !== undefined) bodyMatch = { index: bodyResult.index, length: bodyResult[0].length };
				metadataMatched = metadataFields.some((field) => clause.value.test(field));
			}
			const matched = Boolean(bodyMatch || metadataMatched);
			if (clause.negated ? matched : !matched) { valid = false; break; }
			if (!clause.negated && bodyMatch) {
				if (clause.kind === 'text' && (!firstText || bodyMatch.index < firstText.match.index)) firstText = { match: bodyMatch, order };
				if (clause.kind === 'regex' && (!firstRegex || bodyMatch.index < firstRegex.match.index)) firstRegex = { match: bodyMatch, order };
			}
		}
		if (valid) {
			// Folded text offsets are monotonic, so only the earliest successful
			// text match needs conversion. Mapping every clause can multiply a
			// multi-megabyte Unicode walk by hundreds of query terms.
			const first = firstText && originalTextMatch(text, body, firstText.match.index, firstText.match.length);
			if (!first) return firstRegex?.match ?? { index: 0, length: 0 };
			if (firstRegex && (firstRegex.match.index < first.index || (firstRegex.match.index === first.index && firstRegex.order < firstText!.order))) return firstRegex.match;
			return first;
		}
	}
	return undefined;
}

function originalTextMatch(text: string, folded: string, index: number, length: number): VaultContentMatch {
	if (text.length === folded.length) return { index, length };
	// Lowercasing can expand characters such as U+0130 into two code points.
	// Search offsets must refer to the original document, not the folded copy.
	let originalOffset = 0;
	let foldedOffset = 0;
	let start = 0;
	for (const character of text) {
		const nextOriginal = originalOffset + character.length;
		const nextFolded = foldedOffset + character.toLocaleLowerCase().length;
		if (foldedOffset <= index && index < nextFolded) start = originalOffset;
		if (nextFolded >= index + length) return { index: start, length: nextOriginal - start };
		originalOffset = nextOriginal;
		foldedOffset = nextFolded;
	}
	return { index: start, length: text.length - start };
}

function matchAuthoritativeProperty(
	record: VaultIndexRecord,
	clauseValue: string,
	properties: () => Readonly<Record<string, unknown>>,
): boolean {
	const value = clauseValue.toLocaleLowerCase();
	const equal = value.indexOf('=');
	const key = value.slice(0, equal);
	const expected = value.slice(equal + 1);
	if (!Object.keys(record.properties).some((name) => name.toLocaleLowerCase() === key)) return false;
	const entry = Object.entries(properties()).find(([name]) => name.toLocaleLowerCase() === key);
	return Boolean(entry && propertyText(entry[1]).includes(expected));
}

function boundedSearchText(record: VaultIndexRecord): string {
	return collectBoundedSearchText(searchableRecordFields(record));
}

function* searchableRecordFields(record: VaultIndexRecord): Generator<string> {
	yield record.basename;
	yield record.path;
	yield* record.aliases;
	for (const heading of record.headings) yield heading.text;
	yield* record.tags;
	for (const task of record.tasks) yield task.text;
	yield* record.searchTokens;
	for (const [key, value] of Object.entries(record.properties)) {
		yield key;
		yield propertyText(value);
	}
}

export const MAX_SEARCH_CANDIDATE_TEXT_LENGTH = 200_000;

/** Builds candidate text without first joining every retained metadata field. */
export function collectBoundedSearchText(values: Iterable<string>): string {
	const parts: string[] = [];
	let length = 0;
	for (const value of values) {
		if (length >= MAX_SEARCH_CANDIDATE_TEXT_LENGTH) break;
		if (parts.length > 0) {
			parts.push('\n');
			length++;
		}
		const remaining = MAX_SEARCH_CANDIDATE_TEXT_LENGTH - length;
		if (remaining <= 0) break;
		const part = value.length <= remaining ? value : value.slice(0, remaining);
		parts.push(part);
		length += part.length;
		if (length >= MAX_SEARCH_CANDIDATE_TEXT_LENGTH) break;
	}
	return parts.join('').toLocaleLowerCase().slice(0, MAX_SEARCH_CANDIDATE_TEXT_LENGTH);
}

function propertyText(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).toLocaleLowerCase();
	if (Array.isArray(value)) return value.slice(0, 100).map(propertyText).join(' ');
	return '';
}

function tokenize(query: string): Array<{ value: string; quoted: boolean; negated: boolean }> {
	const tokens: Array<{ value: string; quoted: boolean; negated: boolean }> = [];
	const pattern = /(-?)"([^"\n]{0,512})"|(\S+)/g;
	for (const match of query.matchAll(pattern)) tokens.push({
		value: match[2] ?? match[3], quoted: match[2] !== undefined, negated: match[1] === '-',
	});
	return tokens;
}

function isSupportedRegexFlags(flags: string): boolean {
	return flags.length <= 2 && /^[iu]*$/.test(flags) && new Set(flags).size === flags.length;
}
