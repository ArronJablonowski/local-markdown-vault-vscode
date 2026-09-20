import { describe, expect, it } from 'vitest';
import { MAX_DISCOVERED_MARKDOWN_FILES, MAX_INDEXED_VAULT_NOTES, selectIndexCandidates } from './vaultIndexSelection';

describe('vault index candidate selection', () => {
	it('does not charge excluded notes against the included-note limit', () => {
		const candidates = [
			...Array.from({ length: MAX_INDEXED_VAULT_NOTES }, (_, index) => ({ item: index, path: `Notes/${index}.md` })),
			...Array.from({ length: 5_000 }, (_, index) => ({ item: index, path: `Ignored/${index}.md` })),
		];
		const result = selectIndexCandidates(candidates, ['/Ignored/**'], false, false);
		expect(result.kind).toBe('ok');
		if (result.kind === 'ok') expect(result.candidates).toHaveLength(MAX_INDEXED_VAULT_NOTES);
	});

	it('distinguishes the included-note limit from the bounded discovery limit', () => {
		const included = Array.from({ length: MAX_INDEXED_VAULT_NOTES + 1 }, (_, index) => ({ item: index, path: `${index}.md` }));
		expect(MAX_DISCOVERED_MARKDOWN_FILES).toBeGreaterThan(MAX_INDEXED_VAULT_NOTES);
		expect(selectIndexCandidates(included, [], false, false).kind).toBe('noteLimit');
		expect(selectIndexCandidates(
			[{ item: 1, path: 'Ignored/note.md' }],
			['/Ignored/**'],
			true,
			false,
		).kind).toBe('scanLimit');
	});

	it('reads exclusion configuration once instead of reparsing it for every candidate', () => {
		let patternReads = 0;
		const source = Array.from({ length: 256 }, (_, index) => `/Ignored-${index}/**`);
		const exclusions = new Proxy(source, {
			get(target, property, receiver) {
				if (typeof property === 'string' && /^\d+$/.test(property)) patternReads++;
				return Reflect.get(target, property, receiver);
			},
		});
		const candidates = Array.from({ length: 5_000 }, (_, index) => ({ item: index, path: `Notes/${index}.md` }));
		expect(selectIndexCandidates(candidates, exclusions, false, false).kind).toBe('ok');
		expect(patternReads).toBe(256);
	});
});
