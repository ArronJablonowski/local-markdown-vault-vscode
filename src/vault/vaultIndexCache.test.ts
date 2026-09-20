import { describe, expect, it } from 'vitest';
import type { VaultIndexRecord } from './VaultIndex';
import { encodeVaultIndexCache, toPersistedVaultIndexRecord, validateVaultIndexCache } from './vaultIndexCache';
import {
	MAX_INDEX_ALIASES,
	MAX_INDEX_HEADING_TEXT_LENGTH,
	MAX_INDEX_LINK_FRAGMENT_LENGTH,
	MAX_INDEX_LINK_TARGET_LENGTH,
	MAX_INDEX_SEARCH_TOKEN_LENGTH,
	MAX_INDEX_TAG_LENGTH,
	MAX_INDEX_TASK_TEXT_LENGTH,
} from './vaultMetadata';

const identity = {
	schema: 4,
	rootHash: 'abc123',
	extensionVersion: '0.2.0',
	exclusions: ['.git', 'node_modules'],
	maxRecords: 10_000,
};

const record: VaultIndexRecord = {
	path: 'Notes/Security.md',
	basename: 'Security',
	headings: [{ level: 1, text: 'Policy', line: 1 }],
	blockIds: ['policy'],
	aliases: ['Threat model'],
	tags: ['security'],
	properties: { reviewed: true, owners: ['Alice'] },
	links: [{ kind: 'wikilink', target: 'Home', fragment: '#Start', line: 3 }],
	tasks: [{ completed: false, text: 'Review policy', line: 4 }],
	searchTokens: ['security', 'policy'],
	mtime: 1_700_000_000_000,
	size: 1234,
};

const persistedRecord = toPersistedVaultIndexRecord(record);

function envelope(records: unknown[] = [persistedRecord]): unknown {
	return { ...identity, exclusions: [...identity.exclusions], records, maxRecords: undefined };
}

describe('vault index cache validation', () => {
	it('accepts a complete bounded cache envelope', () => {
		const value = envelope() as Record<string, unknown>;
		delete value.maxRecords;
		expect(validateVaultIndexCache(value, identity)).toEqual([persistedRecord]);
	});

	it('invalidates caches with the wrong identity or exclusion settings', () => {
		const value = envelope() as Record<string, unknown>;
		delete value.maxRecords;
		expect(validateVaultIndexCache({ ...value, schema: 2 }, identity)).toBeUndefined();
		expect(validateVaultIndexCache({ ...value, exclusions: ['.git'] }, identity)).toBeUndefined();
		expect(validateVaultIndexCache({ ...value, rootHash: 'other' }, identity)).toBeUndefined();
	});

	it('rejects duplicate, malformed, and content-bearing records atomically', () => {
		const make = (records: unknown[]) => {
			const value = envelope(records) as Record<string, unknown>;
			delete value.maxRecords;
			return value;
		};
		expect(validateVaultIndexCache(make([persistedRecord, persistedRecord]), identity)).toBeUndefined();
		expect(validateVaultIndexCache(make([{ ...persistedRecord, tags: 'security' }]), identity)).toBeUndefined();
		expect(validateVaultIndexCache(make([{ ...persistedRecord, content: '# Secret' }]), identity)).toBeUndefined();
		expect(validateVaultIndexCache(make([{ ...persistedRecord, path: '../outside.md' }]), identity)).toBeUndefined();
	});

	it('rejects non-finite numbers and excessive nested property data', () => {
		const make = (candidate: unknown) => {
			const value = envelope([candidate]) as Record<string, unknown>;
			delete value.maxRecords;
			return value;
		};
		expect(validateVaultIndexCache(make({ ...persistedRecord, mtime: Number.NaN }), identity)).toBeUndefined();
		expect(validateVaultIndexCache(make({ ...persistedRecord, properties: { secret: 'must not be cached' } }), identity)).toBeUndefined();
		expect(validateVaultIndexCache(make({ ...persistedRecord, properties: { nested: { value: null } } }), identity)).toBeUndefined();
	});

	it('rejects metadata fields that exceed the live producer limits', () => {
		const make = (candidate: unknown) => {
			const value = envelope([candidate]) as Record<string, unknown>;
			delete value.maxRecords;
			return value;
		};
		expect(validateVaultIndexCache(make({ ...persistedRecord, aliases: ['bad|alias'] }), identity)).toBeUndefined();
		expect(validateVaultIndexCache(make({ ...persistedRecord, aliases: Array(MAX_INDEX_ALIASES + 1).fill('safe') }), identity)).toBeUndefined();
		expect(validateVaultIndexCache(make({ ...persistedRecord, headings: [{ level: 1, text: 'h'.repeat(MAX_INDEX_HEADING_TEXT_LENGTH + 1), line: 1 }] }), identity)).toBeUndefined();
		expect(validateVaultIndexCache(make({ ...persistedRecord, tags: ['t'.repeat(MAX_INDEX_TAG_LENGTH + 1)] }), identity)).toBeUndefined();
		expect(validateVaultIndexCache(make({ ...persistedRecord, tasks: [{ completed: false, text: 'x'.repeat(MAX_INDEX_TASK_TEXT_LENGTH + 1), line: 1 }] }), identity)).toBeUndefined();
		expect(validateVaultIndexCache(make({ ...persistedRecord, links: [{ kind: 'wikilink', target: 'n'.repeat(MAX_INDEX_LINK_TARGET_LENGTH + 1), line: 1 }] }), identity)).toBeUndefined();
		expect(validateVaultIndexCache(make({ ...persistedRecord, links: [{ kind: 'wikilink', target: 'Note', fragment: `#${'f'.repeat(MAX_INDEX_LINK_FRAGMENT_LENGTH)}`, line: 1 }] }), identity)).toBeUndefined();
		expect(validateVaultIndexCache(make({ ...persistedRecord, searchTokens: ['s'.repeat(MAX_INDEX_SEARCH_TOKEN_LENGTH + 1)] }), identity)).toBeUndefined();
	});

	it('persists structural metadata without duplicating note-content values', () => {
		const persisted = toPersistedVaultIndexRecord({
			...record,
			properties: { password: 'hunter2', status: 'private draft', nested: { token: 'abc' } },
			tasks: [{ completed: false, text: 'Send api-key-123456789 to Alice', line: 4 }],
			searchTokens: ['security', 'api-key-123456789', 'private', 'draft'],
		});
		expect(persisted.properties).toEqual({ password: null, status: null, nested: null });
		expect(persisted.tasks).toEqual([{ completed: false, text: '', line: 4 }]);
		expect(persisted.searchTokens).toContain('security');
		expect(JSON.stringify(persisted)).not.toMatch(/hunter2|api-key-123456789|private draft/);
	});

	it('does not persist structural search terms above the live token limit', () => {
		const persisted = toPersistedVaultIndexRecord({
			...record,
			headings: [{ level: 1, text: 'h'.repeat(MAX_INDEX_SEARCH_TOKEN_LENGTH + 1), line: 1 }],
		});
		expect(persisted.searchTokens).not.toContain('h'.repeat(MAX_INDEX_SEARCH_TOKEN_LENGTH + 1));
		const value = envelope([persisted]) as Record<string, unknown>;
		delete value.maxRecords;
		expect(validateVaultIndexCache(value, identity)).toEqual([persisted]);
	});

	it('incrementally encodes a cache that round-trips through strict validation', () => {
		const encoded = encodeVaultIndexCache({
			schema: identity.schema,
			rootHash: identity.rootHash,
			extensionVersion: identity.extensionVersion,
			exclusions: identity.exclusions,
			records: [record],
		});
		expect(encoded).toBeDefined();
		const decoded = JSON.parse(new TextDecoder().decode(encoded));
		expect(validateVaultIndexCache(decoded, identity)).toEqual([persistedRecord]);
	});

	it('stops consuming records as soon as the exact cache budget is exceeded', () => {
		function* records(): Generator<VaultIndexRecord> {
			yield record;
			throw new Error('records after the byte limit must not be consumed');
		}
		expect(encodeVaultIndexCache({
			schema: identity.schema,
			rootHash: identity.rootHash,
			extensionVersion: identity.extensionVersion,
			exclusions: identity.exclusions,
			records: records(),
		}, 100)).toBeUndefined();
	});
});
