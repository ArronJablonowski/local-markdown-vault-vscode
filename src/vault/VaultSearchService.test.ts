import { describe, expect, it, vi } from 'vitest';
import { RE2JS } from 're2js';
import type { VaultIndexRecord } from './VaultIndex';
import type { VaultIndex } from './VaultIndex';
import { findVaultContentMatch, searchVaultRecords } from './vaultSearchQuery';
import { searchVaultDocuments, searchVaultWithContext, type VaultSearchProgress } from './VaultSearchService';

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

describe('complete vault document search', () => {
	function note(name: string): VaultIndexRecord {
		return { ...record, path: `Notes/${name}.md`, basename: name, aliases: [], headings: [], tags: [], properties: {}, searchTokens: [] };
	}

	function makeIndex(records: VaultIndexRecord[], readText: (path: string) => Promise<string | undefined>): VaultIndex {
		return { waitForRebuild: async () => true, flushDocumentUpdates: async () => undefined, all: () => records, readText } as unknown as VaultIndex;
	}

	it('searches every note beyond the old 500 candidates and returns more than 200 matches', async () => {
		const records = Array.from({ length: 800 }, (_, i) => note(`Note ${String(i).padStart(4, '0')}`));
		const readText = vi.fn(async (path: string) => path.includes('0000') ? 'not a match' : 'needle');
		const progress: VaultSearchProgress[] = [];
		const result = await searchVaultDocuments(makeIndex(records, readText), 'needle', { onProgress: (update) => progress.push(update) });
		expect(result.status).toBe('complete');
		expect(result.results).toHaveLength(799);
		expect(result.results.at(-1)?.record.path).toBe('Notes/Note 0799.md');
		expect(readText).toHaveBeenCalledTimes(800);
		expect(result).toMatchObject({ total: 800, scanned: 800, matches: 799, unreadable: 0 });
		expect(progress[0]).toEqual({ total: 800, scanned: 0, matches: 0, unreadable: 0 });
		expect(progress.at(-1)).toEqual({ total: 800, scanned: 800, matches: 799, unreadable: 0 });
	});

	it('returns every match at the existing 10,000-note vault limit without retaining bodies', async () => {
		const records = Array.from({ length: 10_000 }, (_, i) => note(String(i)));
		const result = await searchVaultDocuments(makeIndex(records, async () => 'needle'), 'needle');
		expect(result).toMatchObject({ status: 'complete', total: 10_000, scanned: 10_000, matches: 10_000, unreadable: 0 });
		expect(result.results).toHaveLength(10_000);
		expect(Object.keys(result.results[0]).sort()).toEqual(['context', 'line', 'record']);
	});

	it('compiles an advanced regex only once for the entire scan', async () => {
		const compile = vi.spyOn(RE2JS, 'compile');
		try {
			const index = makeIndex(Array.from({ length: 100 }, (_, i) => note(String(i))), async () => 'needle');
			expect((await searchVaultDocuments(index, '/needle/', { mode: 'advanced' })).results).toHaveLength(100);
			expect(compile).toHaveBeenCalledTimes(1);
		} finally { compile.mockRestore(); }
	});

	it('finds authoritative content beyond retained tokens and preserves punctuation and emoji', async () => {
		const text = `${Array.from({ length: 10_100 }, (_, i) => `word${i}`).join(' ')}\nC++ foo.bar [!warning] :smile: 😀`;
		const index = makeIndex([note('Unrelated')], async () => text);
		for (const query of ['C++', 'foo.bar', '[!warning]', ':smile:', '😀']) {
			const result = await searchVaultDocuments(index, query);
			expect(result.results, query).toHaveLength(1);
			expect(result.results[0].line).toBe(2);
			expect(result.results[0].context).toContain(query);
		}
	});

	it.each(['OR', '-dash', 'tag:value', '/a(?=b)/', 'file:note', 'two words', '"quoted"'])('treats %j as a literal keyword by default', async (keyword) => {
		const records = [note('Matching body'), note('Unrelated')];
		const index = makeIndex(records, async (path) => path === records[0].path ? `before ${keyword} after` : 'entirely different');
		expect((await searchVaultDocuments(index, keyword)).results.map((result) => result.record)).toEqual([records[0]]);
	});

	it('matches readable titles but excludes folder paths and stale metadata from default keyword results', async () => {
		const title = note('Needle title');
		const metadata = { ...note('Unrelated'), path: 'Needle/Unrelated.md', aliases: ['Needle'], headings: [{ text: 'Needle', line: 1, level: 1 }], tags: ['needle'] };
		const index = makeIndex([metadata, title], async () => 'no match here');
		expect((await searchVaultDocuments(index, 'needle')).results).toEqual([{ record: title }]);
		expect((await searchVaultDocuments(index, 'needle', { mode: 'advanced' })).results).toHaveLength(2);
	});

	it('reports an unavailable index rather than a successful empty search', async () => {
		const index = { waitForRebuild: async () => false, flushDocumentUpdates: vi.fn(), all: vi.fn(), readText: vi.fn() } as unknown as VaultIndex;
		expect(await searchVaultDocuments(index, 'needle')).toMatchObject({ status: 'unavailable', results: [] });
		expect(index.flushDocumentUpdates).not.toHaveBeenCalled();
		expect(index.all).not.toHaveBeenCalled();
	});

	it('waits for rebuilds both before and after flushing unsaved documents', async () => {
		const events: string[] = [];
		const index = {
			waitForRebuild: async () => { events.push('wait'); return true; },
			flushDocumentUpdates: async () => { events.push('flush'); },
			all: () => { events.push('all'); return []; },
		} as unknown as VaultIndex;
		expect((await searchVaultDocuments(index, 'needle')).status).toBe('complete');
		expect(events).toEqual(['wait', 'flush', 'wait', 'all']);
	});

	it('prioritizes exact and partial titles deterministically regardless of read completion order', async () => {
		const records = ['Zulu', 'Keyword notes', 'A keyword note', 'Keyword', 'Alpha'].map(note);
		const index = makeIndex(records, async (path) => {
			await new Promise<void>((resolve) => setTimeout(resolve, path.includes('Keyword') ? 4 : 0));
			return 'keyword appears in every body';
		});
		const result = await searchVaultDocuments(index, 'KEYWORD');
		expect(result.results.map((item) => item.record.basename)).toEqual(['Keyword', 'Keyword notes', 'A keyword note', 'Alpha', 'Zulu']);
	});

	it('skips unreadable files even when their indexed titles match and never mistakes missing content for a negative match', async () => {
		const records = [note('Needle'), note('Other')];
		const index = makeIndex(records, async () => undefined);
		const result = await searchVaultDocuments(index, 'needle');
		expect(result.results).toEqual([]);
		expect(result.unreadable).toBe(2);
		expect((await searchVaultDocuments(index, 'needle -obsolete', { mode: 'advanced' })).results).toEqual([]);
		expect((await searchVaultDocuments(index, '-obsolete', { mode: 'advanced' })).results).toEqual([]);
	});

	it('reports individual read failures while completing other notes', async () => {
		const records = [note('Broken'), note('Readable')];
		const result = await searchVaultDocuments(makeIndex(records, async (path) => {
			if (path.includes('Broken')) throw new Error('read failed');
			return 'needle';
		}), 'needle');
		expect(result).toMatchObject({ status: 'complete', scanned: 2, unreadable: 1, matches: 1 });
		expect(result.results[0].record).toBe(records[1]);
	});

	it('flushes current document edits before selecting records', async () => {
		let records: VaultIndexRecord[] = [];
		const fresh = note('Fresh title');
		const index = {
			waitForRebuild: async () => true,
			flushDocumentUpdates: async () => { records = [fresh]; },
			all: () => records,
			readText: async () => 'fresh unsaved body',
		} as unknown as VaultIndex;
		expect((await searchVaultDocuments(index, 'unsaved')).results[0].record).toBe(fresh);
	});

	it.each(['', ' ', '\n\t'])('does not flush or read documents for an empty query %j', async (query) => {
		const index = { flushDocumentUpdates: vi.fn(), all: vi.fn(), readText: vi.fn() } as unknown as VaultIndex;
		expect(await searchVaultDocuments(index, query)).toMatchObject({ status: 'empty', results: [] });
		expect(index.flushDocumentUpdates).not.toHaveBeenCalled();
		expect(index.all).not.toHaveBeenCalled();
		expect(index.readText).not.toHaveBeenCalled();
	});

	it.each(['/a(?=b)/', '/a/ii', 'x'.repeat(2049)])('reports invalid queries without reading notes', async (query) => {
		const index = { flushDocumentUpdates: vi.fn(), all: vi.fn(), readText: vi.fn() } as unknown as VaultIndex;
		expect(await searchVaultDocuments(index, query, { mode: 'advanced' })).toMatchObject({ status: 'invalid', results: [] });
		expect(index.flushDocumentUpdates).not.toHaveBeenCalled();
	});

	it('bounds concurrent reads and discards canceled results without scheduling further reads', async () => {
		const waiting: Array<() => void> = [];
		const readText = vi.fn(async () => {
			await new Promise<void>((resolve) => waiting.push(resolve));
			return 'needle';
		});
		const controller = new AbortController();
		const result = searchVaultDocuments(makeIndex(Array.from({ length: 80 }, (_, i) => note(String(i))), readText), 'needle', { signal: controller.signal });
		await vi.waitFor(() => expect(readText).toHaveBeenCalledTimes(8));
		controller.abort();
		waiting.forEach((resolve) => resolve());
		expect(await result).toMatchObject({ status: 'canceled', results: [] });
		expect(readText).toHaveBeenCalledTimes(8);
	});

	it('does not begin reads when cancellation occurs during the document flush', async () => {
		const controller = new AbortController();
		const index = { waitForRebuild: async () => true, flushDocumentUpdates: async () => { controller.abort(); }, all: vi.fn(), readText: vi.fn() } as unknown as VaultIndex;
		expect(await searchVaultDocuments(index, 'needle', { signal: controller.signal })).toMatchObject({ status: 'canceled', results: [] });
		expect(index.all).not.toHaveBeenCalled();
	});

	it('does not await indexing for an already canceled search', async () => {
		const controller = new AbortController();
		controller.abort();
		const index = { waitForRebuild: vi.fn() } as unknown as VaultIndex;
		expect(await searchVaultDocuments(index, 'needle', { signal: controller.signal })).toMatchObject({ status: 'canceled', results: [] });
		expect(index.waitForRebuild).not.toHaveBeenCalled();
	});

	it('cooperatively yields so cancellation can interrupt synchronous open-document reads', async () => {
		const controller = new AbortController();
		const readText = vi.fn(async () => 'needle');
		setTimeout(() => controller.abort(), 0);
		const result = await searchVaultDocuments(makeIndex(Array.from({ length: 1000 }, (_, i) => note(String(i))), readText), 'needle', { signal: controller.signal });
		expect(result.status).toBe('canceled');
		expect(readText.mock.calls.length).toBeLessThan(1000);
	});

	it('keeps regex result snippets bounded even when an expression matches the entire note', async () => {
		const result = await searchVaultDocuments(makeIndex([note('Long')], async () => 'a'.repeat(100_000)), '/a+/', { mode: 'advanced' });
		expect(result.results).toHaveLength(1);
		expect(result.results[0].context!.length).toBeLessThanOrEqual(402);
	});

	it('supports phrases, alternatives, negation, and metadata filters with authoritative content', async () => {
		const record = { ...note('Note'), tags: ['work'], properties: { status: null } };
		const index = makeIndex([record], async () => '---\nstatus: ready\n---\nRemote images are local.');
		expect((await searchVaultDocuments(index, '"remote images" tag:work property:status=ready -obsolete', { mode: 'advanced' })).results).toHaveLength(1);
		expect((await searchVaultDocuments(index, '"images remote"', { mode: 'advanced' })).results).toHaveLength(0);
		expect((await searchVaultDocuments(index, 'absent OR file:note', { mode: 'advanced' })).results).toHaveLength(1);
	});

	it('keeps original-document offsets after Unicode case-fold expansion', async () => {
		const text = 'İstanbul\nneedle on this line';
		const result = await searchVaultDocuments(makeIndex([note('Unicode')], async () => text), 'needle');
		expect(result.results[0]).toMatchObject({ line: 2, context: 'needle on this line' });
		expect(findVaultContentMatch(note('Unicode'), text, 'needle')).toEqual({ index: 9, length: 6 });
	});
});
