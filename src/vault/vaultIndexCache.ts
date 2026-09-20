import { basename, extname } from 'node:path';
import type { VaultIndexRecord } from './VaultIndex';
import { MAX_WIKI_ALIAS_LENGTH, isSafeWikiAlias } from './LinkResolver';
import {
	collectBoundedSearchTokens,
	MAX_INDEX_ENTRIES_PER_FIELD,
	MAX_INDEX_FILE_BYTES,
	MAX_INDEX_HEADING_TEXT_LENGTH,
	MAX_INDEX_ALIASES,
	MAX_INDEX_LINK_FRAGMENT_LENGTH,
	MAX_INDEX_LINK_TARGET_LENGTH,
	MAX_INDEX_SEARCH_TOKEN_LENGTH,
	MAX_INDEX_TAG_LENGTH,
	MAX_INDEX_TASK_TEXT_LENGTH,
} from './vaultMetadata';

export const MAX_INDEX_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_PATH_LENGTH = 4096;
const MAX_PROPERTY_NODES = 5_000;

export interface VaultIndexCacheIdentity {
	schema: number;
	rootHash: string;
	extensionVersion: string;
	exclusions: readonly string[];
	maxRecords: number;
}

export interface VaultIndexCacheData {
	schema: number;
	rootHash: string;
	extensionVersion: string;
	exclusions: readonly string[];
	records: Iterable<VaultIndexRecord>;
}

/**
 * Keeps the on-disk cache useful for structural navigation without creating a
 * second copy of task text, frontmatter values, or body-derived search terms.
 * A startup rebuild restores the complete in-memory record from the Markdown
 * files before the vault UI is registered.
 */
export function toPersistedVaultIndexRecord(record: VaultIndexRecord): VaultIndexRecord {
	const structuralTokens = collectBoundedSearchTokens([
		record.basename,
		record.path,
		...record.aliases,
		...record.headings.map((heading) => heading.text),
		...record.tags,
		...record.blockIds,
	]);
	return {
		...record,
		properties: Object.fromEntries(Object.keys(record.properties).map((key) => [key, null])),
		tasks: record.tasks.map((task) => ({ ...task, text: '' })),
		searchTokens: structuralTokens,
	};
}

/**
 * Encodes the rebuildable cache incrementally and stops before consuming later
 * records once the exact UTF-8 budget is exhausted. This avoids first cloning
 * the complete index and only then discovering that its JSON is too large.
 */
export function encodeVaultIndexCache(
	data: VaultIndexCacheData,
	maxBytes = MAX_INDEX_CACHE_BYTES,
): Uint8Array | undefined {
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return undefined;
	const encoder = new TextEncoder();
	const prefix = `{"schema":${JSON.stringify(data.schema)},"rootHash":${JSON.stringify(data.rootHash)},"extensionVersion":${JSON.stringify(data.extensionVersion)},"exclusions":${JSON.stringify(data.exclusions)},"records":[`;
	const suffix = ']}';
	let used = encoder.encode(prefix).byteLength + encoder.encode(suffix).byteLength;
	if (used > maxBytes) return undefined;
	const parts = [prefix];
	let first = true;
	for (const record of data.records) {
		const serialized = JSON.stringify(toPersistedVaultIndexRecord(record));
		const recordBytes = encoder.encode(serialized).byteLength + (first ? 0 : 1);
		if (used + recordBytes > maxBytes) return undefined;
		if (!first) parts.push(',');
		parts.push(serialized);
		used += recordBytes;
		first = false;
	}
	parts.push(suffix);
	const encoded = encoder.encode(parts.join(''));
	return encoded.byteLength <= maxBytes ? encoded : undefined;
}

const RECORD_KEYS = new Set([
	'path', 'basename', 'headings', 'blockIds', 'aliases', 'tags', 'properties',
	'links', 'tasks', 'searchTokens', 'mtime', 'size',
]);

/** Returns a completely validated cache or rejects the entire envelope. */
export function validateVaultIndexCache(value: unknown, identity: VaultIndexCacheIdentity): VaultIndexRecord[] | undefined {
	if (!isPlainObject(value) || !hasExactKeys(value, ['schema', 'rootHash', 'extensionVersion', 'exclusions', 'records'])) return undefined;
	if (value.schema !== identity.schema || value.rootHash !== identity.rootHash || value.extensionVersion !== identity.extensionVersion) return undefined;
	if (!isStringArray(value.exclusions, 256, 512) || !sameStrings(value.exclusions, identity.exclusions)) return undefined;
	if (!Array.isArray(value.records) || value.records.length > identity.maxRecords) return undefined;
	const seen = new Set<string>();
	const records: VaultIndexRecord[] = [];
	for (const candidate of value.records) {
		if (!isVaultIndexRecord(candidate) || seen.has(candidate.path)) return undefined;
		seen.add(candidate.path);
		records.push(candidate);
	}
	return records;
}

function isVaultIndexRecord(value: unknown): value is VaultIndexRecord {
	if (!isPlainObject(value) || Object.keys(value).some((key) => !RECORD_KEYS.has(key)) || Object.keys(value).length !== RECORD_KEYS.size) return false;
	if (!isRelativeVaultPath(value.path) || typeof value.basename !== 'string' || value.basename.length > 255) return false;
	if (basename(value.path, extname(value.path)) !== value.basename) return false;
	if (!isFiniteNumber(value.mtime, 0) || !isFiniteNumber(value.size, 0, MAX_INDEX_FILE_BYTES)) return false;
	if (!Array.isArray(value.headings) || value.headings.length > MAX_INDEX_ENTRIES_PER_FIELD || !value.headings.every(isHeading)) return false;
	if (!isStringArray(value.blockIds, MAX_INDEX_ENTRIES_PER_FIELD, 128)) return false;
	if (!isStringArray(value.aliases, MAX_INDEX_ALIASES, MAX_WIKI_ALIAS_LENGTH) || !value.aliases.every(isSafeWikiAlias)) return false;
	if (!isStringArray(value.tags, MAX_INDEX_ENTRIES_PER_FIELD, MAX_INDEX_TAG_LENGTH)) return false;
	if (!Array.isArray(value.links) || value.links.length > MAX_INDEX_ENTRIES_PER_FIELD || !value.links.every(isLink)) return false;
	if (!Array.isArray(value.tasks) || value.tasks.length > MAX_INDEX_ENTRIES_PER_FIELD || !value.tasks.every(isTask)) return false;
	if (!isStringArray(value.searchTokens, MAX_INDEX_ENTRIES_PER_FIELD, MAX_INDEX_SEARCH_TOKEN_LENGTH)) return false;
	return isPersistedPropertyMap(value.properties);
}

function isHeading(value: unknown): boolean {
	return isPlainObject(value)
		&& hasExactKeys(value, ['level', 'text', 'line'])
		&& Number.isInteger(value.level) && (value.level as number) >= 1 && (value.level as number) <= 6
		&& typeof value.text === 'string' && value.text.length <= MAX_INDEX_HEADING_TEXT_LENGTH
		&& isFiniteNumber(value.line, 1, 10_000_000, true);
}

function isLink(value: unknown): boolean {
	if (!isPlainObject(value) || !hasOnlyKeys(value, ['kind', 'target', 'fragment', 'line'])) return false;
	if (!['markdown', 'markdownEmbed', 'wikilink', 'wikiEmbed'].includes(String(value.kind))) return false;
	if (typeof value.target !== 'string' || value.target.length > MAX_INDEX_LINK_TARGET_LENGTH) return false;
	if (value.fragment !== undefined && (typeof value.fragment !== 'string' || value.fragment.length > MAX_INDEX_LINK_FRAGMENT_LENGTH)) return false;
	return isFiniteNumber(value.line, 1, 10_000_000, true);
}

function isTask(value: unknown): boolean {
	return isPlainObject(value)
		&& hasExactKeys(value, ['completed', 'text', 'line'])
		&& typeof value.completed === 'boolean'
		&& typeof value.text === 'string' && value.text.length <= MAX_INDEX_TASK_TEXT_LENGTH
		&& isFiniteNumber(value.line, 1, 10_000_000, true);
}

function isRelativeVaultPath(value: unknown): value is string {
	if (typeof value !== 'string' || !value || value.length > MAX_PATH_LENGTH || value.includes('\\') || /[\0\r\n]/.test(value)) return false;
	if (value.startsWith('/') || /^[a-z]:/i.test(value)) return false;
	return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function isStringArray(value: unknown, maxItems: number, maxLength: number): value is string[] {
	return Array.isArray(value)
		&& value.length <= maxItems
		&& value.every((item) => typeof item === 'string' && item.length <= maxLength && !item.includes('\0'));
}

function isPersistedPropertyMap(value: unknown): value is Record<string, null> {
	if (!isPlainObject(value)) return false;
	const entries = Object.entries(value);
	return entries.length <= MAX_PROPERTY_NODES
		&& entries.every(([key, item]) => key.length <= 512 && !key.includes('\0') && item === null);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(value).length === keys.length && hasOnlyKeys(value, keys);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const allowed = new Set(keys);
	return Object.keys(value).every((key) => allowed.has(key));
}

function isFiniteNumber(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER, integer = false): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum && (!integer || Number.isInteger(value));
}

function sameStrings(actual: readonly string[], expected: readonly string[]): boolean {
	return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}
