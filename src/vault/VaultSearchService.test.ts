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
		const index = {
			search: () => [record],
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
			search: (query: string, limit: number) => searchVaultRecords([privateRecord], query, limit),
			readText: async () => text,
		} as unknown as VaultIndex;
		expect(JSON.stringify(privateRecord)).not.toMatch(/ready|hunter2/);
		await expect(searchVaultWithContext(index, 'property:status=ready', 10)).resolves.toEqual([{ record: privateRecord }]);
		await expect(searchVaultWithContext(index, 'property:status=wrong', 10)).resolves.toEqual([]);
		await expect(searchVaultWithContext(index, '-property:status=archived', 10)).resolves.toEqual([{ record: privateRecord }]);
		await expect(searchVaultWithContext(index, '-property:status=ready', 10)).resolves.toEqual([]);
	});

	it('stops scheduling note reads when an obsolete search is cancelled', async () => {
		const records = Array.from({ length: 40 }, (_, index) => ({
			...record,
			path: `Notes/${index}.md`,
			basename: String(index),
		}));
		const waiting: Array<() => void> = [];
		let reads = 0;
		const index = {
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

	it('does not begin work for a search cancelled while queued', async () => {
		let reads = 0;
		const index = {
			search: () => [record],
			readText: async () => { reads++; return 'remote images'; },
		} as unknown as VaultIndex;
		const controller = new AbortController();
		controller.abort();
		await expect(searchVaultWithContext(index, 'remote', 10, controller.signal)).resolves.toEqual([]);
		expect(reads).toBe(0);
	});
});
