import { describe, expect, it, vi } from 'vitest';
import type { VaultIndexRecord } from './VaultIndex';
import type { VaultIndex } from './VaultIndex';
import { findVaultContentMatch, searchVaultRecords } from './vaultSearchQuery';
import { searchVaultWithContext } from './VaultSearchService';

const record: VaultIndexRecord = {
	path: 'Notes/Security.md', basename: 'Security', aliases: ['Threat model'],
	headings: [{ level: 1, text: 'Network policy', line: 3 }], blockIds: [], tags: ['secure'], properties: {}, links: [], tasks: [],
	searchTokens: ['security', 'network', 'remote', 'images'], mtime: 1, size: 100,
};

describe('authoritative vault search matching', () => {
	it('uses the note body to verify quoted phrases and locate them', () => {
		const text = '# Security\n\n# Network policy\nRemote images are blocked by default.\n';
		expect(searchVaultRecords([record], '"remote images"')).toEqual([record]);
		expect(findVaultContentMatch(record, text, '"remote images"')).toEqual({ index: 29, length: 13 });
		expect(findVaultContentMatch(record, text, '"images remote"')).toBeUndefined();
	});

	it('keeps metadata and filter-only matches without inventing body context', () => {
		expect(findVaultContentMatch(record, '', 'tag:secure')).toEqual({ index: 0, length: 0 });
		expect(findVaultContentMatch(record, '', '"Threat model"')).toEqual({ index: 0, length: 0 });
	});

	it('applies negative terms to current content', () => {
		expect(findVaultContentMatch(record, 'network policy', 'network -obsolete')).toBeDefined();
		expect(findVaultContentMatch(record, 'network policy obsolete', 'network -obsolete')).toBeUndefined();
	});

	it('builds a bounded snippet and nearest heading from on-demand text', async () => {
		const text = '# Security\n\n# Network policy\nRemote images are blocked by default.\n';
		let flushed = false;
		const index = {
			flushDocumentUpdates: async () => { flushed = true; },
			search: () => {
				expect(flushed).toBe(true);
				return [record];
			},
			readText: async () => text,
		} as unknown as VaultIndex;
		await expect(searchVaultWithContext(index, 'remote', 10)).resolves.toEqual([{
			record,
			line: 4,
			heading: 'Network policy',
			context: 'Remote images are blocked by default.',
		}]);
	});

	it('verifies property values on demand without retaining them in the index', async () => {
		const privateRecord: VaultIndexRecord = {
			...record,
			properties: { status: null, password: null },
		};
		const text = '---\nstatus: ready\npassword: hunter2\n---\n# Security\n';
		const index = {
			flushDocumentUpdates: async () => undefined,
			search: (query: string, limit: number) => searchVaultRecords([privateRecord], query, limit),
			readText: async () => text,
		} as unknown as VaultIndex;
		expect(JSON.stringify(privateRecord)).not.toMatch(/ready|hunter2/);
		await expect(searchVaultWithContext(index, 'property:status=ready', 10)).resolves.toEqual([{ record: privateRecord }]);
		await expect(searchVaultWithContext(index, 'property:status=wrong', 10)).resolves.toEqual([]);
		await expect(searchVaultWithContext(index, '-property:status=archived', 10)).resolves.toEqual([{ record: privateRecord }]);
		await expect(searchVaultWithContext(index, '-property:status=ready', 10)).resolves.toEqual([]);
	});

	it('applies the result limit after authoritative property verification', async () => {
		const candidates = ['A', 'B', 'C'].map(name => ({ ...record, path: `${name}.md`, basename: name, properties: { status: null } }));
		const index = {
			flushDocumentUpdates: async () => undefined,
			search: (query: string, limit: number) => searchVaultRecords(candidates, query, limit),
			readText: async (path: string) => `---\nstatus: ${path === 'B.md' ? 'ready' : 'draft'}\n---\n`,
		} as unknown as VaultIndex;
		await expect(searchVaultWithContext(index, 'property:status=ready', 1)).resolves.toEqual([{ record: candidates[1] }]);
	});

	it('does not read note bodies when the caller requests no results', async () => {
		const readText = vi.fn(async () => 'remote images');
		const index = { flushDocumentUpdates: async () => undefined, search: () => [record], readText } as unknown as VaultIndex;
		await expect(searchVaultWithContext(index, 'remote', 0)).resolves.toEqual([]);
		expect(readText).not.toHaveBeenCalled();
	});

	it('skips unreadable authoritative candidates instead of treating missing text as a negative match', async () => {
		const candidate = { ...record, properties: { status: null } };
		const index = { flushDocumentUpdates: async () => undefined, search: () => [candidate], readText: async () => undefined } as unknown as VaultIndex;
		await expect(searchVaultWithContext(index, '-property:status=archived', 10)).resolves.toEqual([]);
	});

	it('stops scheduling candidates once the requested result count is verified', async () => {
		const candidates = Array.from({ length: 500 }, (_, index) => ({ ...record, path: `${index}.md` }));
		const readText = vi.fn(async () => 'remote images');
		const index = { flushDocumentUpdates: async () => undefined, search: () => candidates, readText } as unknown as VaultIndex;
		await expect(searchVaultWithContext(index, 'remote', 1)).resolves.toHaveLength(1);
		expect(readText.mock.calls.length).toBeLessThanOrEqual(8);
	});

	it('stops scheduling note reads when an obsolete search is canceled', async () => {
		const records = Array.from({ length: 40 }, (_, index) => ({
			...record,
			path: `Notes/${index}.md`,
			basename: String(index),
		}));
		const waiting: Array<() => void> = [];
		let reads = 0;
		const index = {
			flushDocumentUpdates: async () => undefined,
			search: () => records,
			readText: async () => {
				reads++;
				await new Promise<void>((resolve) => waiting.push(resolve));
				return 'remote images';
			},
		} as unknown as VaultIndex;
		const controller = new AbortController();
		const result = searchVaultWithContext(index, 'remote', 40, controller.signal);
		await vi.waitFor(() => expect(reads).toBe(8));
		controller.abort();
		for (const resolve of waiting) resolve();
		await expect(result).resolves.toEqual([]);
		expect(reads).toBe(8);
	});

	it('does not begin work for a search canceled while queued', async () => {
		let reads = 0;
		const index = {
			flushDocumentUpdates: async () => undefined,
			search: () => [record],
			readText: async () => { reads++; return 'remote images'; },
		} as unknown as VaultIndex;
		const controller = new AbortController();
		controller.abort();
		await expect(searchVaultWithContext(index, 'remote', 10, controller.signal)).resolves.toEqual([]);
		expect(reads).toBe(0);
	});
});
