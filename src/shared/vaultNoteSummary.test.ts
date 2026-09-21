import { describe, expect, it } from 'vitest';
import {
	chunkVaultNoteSummaries,
	createVaultNoteSummary,
	MAX_VAULT_NOTE_CHUNK_BYTES,
	MAX_VAULT_NOTE_SUMMARY_BYTES,
	isCanonicalVaultNoteIdentity,
} from './vaultNoteSummary';

describe('vault note webview summaries', () => {
	it('accepts only canonical Markdown identities with a usable note name', () => {
		expect(isCanonicalVaultNoteIdentity('Folder/Note.markdown', 'Note')).toBe(true);
		for (const [path, basename] of [
			['.md', ''], ['../Note.md', 'Note'], ['/Note.md', 'Note'], ['Folder\\Note.md', 'Note'],
			['Folder/Other.md', 'Note'], ['Folder/Note.txt', 'Note'], ['Folder/Note.md', ''],
		] as const) expect(isCanonicalVaultNoteIdentity(path, basename)).toBe(false);
	});

	it('emits an explicit empty chunk so consumers can clear stale metadata', () => {
		expect(chunkVaultNoteSummaries([], 1)).toEqual([[]]);
	});

	it('drops unsafe aliases and bounds every high-cardinality field', () => {
		const summary = createVaultNoteSummary({
			path: 'Note.md', basename: 'Note',
			aliases: ['Safe', 'bad|alias', 'x'.repeat(600), ...Array.from({ length: 200 }, (_, index) => `Alias ${index}`)],
			headings: Array.from({ length: 10_000 }, (_, index) => ({ text: `Heading ${index} ${'x'.repeat(100)}`, line: index + 1 })),
			blockIds: Array.from({ length: 10_000 }, (_, index) => `block-${index}`),
		});
		expect(summary.aliases[0]).toBe('Safe');
		expect(summary.aliases).not.toContain('bad|alias');
		expect(summary.aliases.length).toBeLessThanOrEqual(100);
		expect(summary.headings.length).toBeLessThan(10_000);
		expect(summary.blockIds.length).toBeLessThan(10_000);
		expect(new TextEncoder().encode(JSON.stringify(summary)).byteLength).toBeLessThanOrEqual(MAX_VAULT_NOTE_SUMMARY_BYTES);
	});

	it('budgets the serialized form of expansion-heavy labels', () => {
		const summary = createVaultNoteSummary({
			path: 'Escapes.md', basename: 'Escapes',
			aliases: Array.from({ length: 100 }, () => '\\'.repeat(500)),
			headings: Array.from({ length: 100 }, (_, index) => ({ text: '\\'.repeat(4_096), line: index + 1 })),
			blockIds: [],
		});
		expect(summary.aliases.length).toBeGreaterThan(0);
		expect(summary.headings.length).toBeGreaterThan(0);
		expect(new TextEncoder().encode(JSON.stringify(summary)).byteLength).toBeLessThanOrEqual(MAX_VAULT_NOTE_SUMMARY_BYTES);
	});

	it('chunks by exact UTF-8 message size as well as note count', () => {
		const notes = Array.from({ length: 250 }, (_, index) => createVaultNoteSummary({
			path: `Note-${index}.md`, basename: `Note-${index}`,
			aliases: Array.from({ length: 100 }, (_, alias) => `alias-${index}-${alias}-${'\u754c'.repeat(400)}`),
			headings: [], blockIds: [],
		}));
		const chunks = chunkVaultNoteSummaries(notes, 7);
		expect(chunks.flat()).toEqual(notes);
		expect(chunks.length).toBeGreaterThan(3);
		let offset = 0;
		for (const chunk of chunks) {
			expect(chunk.length).toBeLessThanOrEqual(100);
			const message = { type: 'vaultNotesChunk', generation: 7, offset, total: notes.length, notes: chunk };
			expect(new TextEncoder().encode(JSON.stringify(message)).byteLength).toBeLessThanOrEqual(MAX_VAULT_NOTE_CHUNK_BYTES);
			offset += chunk.length;
		}
	});

	it('handles the full 10,000-note PRD scale without dropping or reordering entries', () => {
		const notes = Array.from({ length: 10_000 }, (_, index) => createVaultNoteSummary({
			path: `Folder/Note-${index}.md`, basename: `Note-${index}`,
			aliases: [`Alias ${index}`], headings: [{ text: `Heading ${index}`, line: 1 }], blockIds: [`block-${index}`],
		}));
		const chunks = chunkVaultNoteSummaries(notes, 9);
		expect(chunks).toHaveLength(100);
		expect(chunks.flat().map((note) => note.path)).toEqual(notes.map((note) => note.path));
	});
});
