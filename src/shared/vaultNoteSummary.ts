import type { VaultNoteSummary } from './messages';
import { isSafeWikiAlias } from '../vault/LinkResolver';

export const MAX_VAULT_NOTE_SUMMARY_BYTES = 128 * 1024;
export const MAX_VAULT_NOTE_ALIASES = 100;
export const MAX_VAULT_NOTE_HEADINGS = 10_000;
export const MAX_VAULT_NOTE_BLOCK_IDS = 10_000;
const MAX_HEADING_TEXT_LENGTH = 4096;
const FIELD_SERIALIZED_BYTE_BUDGET = 32 * 1024;
const utf8Encoder = new TextEncoder();

function utf8Length(value: string): number {
	return utf8Encoder.encode(value).byteLength;
}

interface SummarySource {
	path: string;
	basename: string;
	aliases: readonly string[];
	headings: ReadonlyArray<{ text: string; line: number }>;
	blockIds: readonly string[];
}

export function isCanonicalVaultNoteIdentity(path: unknown, basename: unknown): path is string {
	if (typeof path !== 'string' || typeof basename !== 'string' || path.length === 0 || path.length > 4096 || basename.length === 0 || basename.length > 512) return false;
	if (path.includes('\\') || /[\u0000-\u001f\u007f]/.test(path) || path.startsWith('/') || /^[a-z]:/i.test(path)) return false;
	if (!path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')) return false;
	const filename = path.slice(path.lastIndexOf('/') + 1);
	const stem = filename.replace(/\.(?:md|markdown)$/i, '');
	return stem.length > 0 && stem === basename && stem !== filename;
}

/** Builds the bounded structural metadata sent to each Live Preview webview. */
export function createVaultNoteSummary(source: SummarySource): VaultNoteSummary {
	if (!isCanonicalVaultNoteIdentity(source.path, source.basename)) {
		throw new Error('Vault note identity is invalid.');
	}
	const takeStrings = (
		values: readonly string[],
		maximum: number,
		accept: (value: string) => boolean,
	): string[] => {
		const selected: string[] = [];
		let bytes = 0;
		for (const value of values) {
			if (!accept(value)) continue;
			const size = utf8Length(JSON.stringify(value));
			if (bytes + size > FIELD_SERIALIZED_BYTE_BUDGET) break;
			selected.push(value);
			bytes += size;
			if (selected.length >= maximum) break;
		}
		return selected;
	};
	const aliases = takeStrings(source.aliases, MAX_VAULT_NOTE_ALIASES, isSafeWikiAlias);
	const blockIds = takeStrings(
		source.blockIds,
		MAX_VAULT_NOTE_BLOCK_IDS,
		(value) => /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(value),
	);
	const headings: Array<{ text: string; line: number }> = [];
	let headingBytes = 0;
	for (const heading of source.headings) {
		if (!Number.isSafeInteger(heading.line) || heading.line < 0 || heading.text.length > MAX_HEADING_TEXT_LENGTH) continue;
		const size = utf8Length(JSON.stringify({ text: heading.text, line: heading.line }));
		if (headingBytes + size > FIELD_SERIALIZED_BYTE_BUDGET) break;
		headings.push({ text: heading.text, line: heading.line });
		headingBytes += size;
		if (headings.length >= MAX_VAULT_NOTE_HEADINGS) break;
	}
	const summary = { path: source.path, basename: source.basename, aliases, headings, blockIds };
	if (utf8Length(JSON.stringify(summary)) > MAX_VAULT_NOTE_SUMMARY_BYTES) {
		throw new Error('Vault note summary exceeds its size limit.');
	}
	return summary;
}

export const MAX_VAULT_NOTE_CHUNK_BYTES = 512 * 1024;
export const MAX_VAULT_NOTES_PER_CHUNK = 100;

/** Splits note summaries by both count and exact encoded message size. */
export function chunkVaultNoteSummaries(
	notes: readonly VaultNoteSummary[],
	generation: number,
): VaultNoteSummary[][] {
	// An explicit empty chunk is a state transition, not a no-op: it tells an
	// already-open editor to discard metadata for notes that were deleted.
	if (notes.length === 0) return [[]];
	const chunks: VaultNoteSummary[][] = [];
	let offset = 0;
	while (offset < notes.length) {
		const chunk: VaultNoteSummary[] = [];
		const prefix = `{"type":"vaultNotesChunk","generation":${generation},"offset":${offset},"total":${notes.length},"notes":[`;
		let messageBytes = utf8Length(prefix) + 2; // closing `]}`
		while (offset + chunk.length < notes.length && chunk.length < MAX_VAULT_NOTES_PER_CHUNK) {
			const note = notes[offset + chunk.length];
			const noteBytes = utf8Length(JSON.stringify(note));
			const nextBytes = messageBytes + (chunk.length ? 1 : 0) + noteBytes;
			if (nextBytes > MAX_VAULT_NOTE_CHUNK_BYTES) {
				if (chunk.length === 0) throw new Error('A vault note summary exceeds the chunk size limit.');
				break;
			}
			chunk.push(note);
			messageBytes = nextBytes;
		}
		chunks.push(chunk);
		offset += chunk.length;
	}
	return chunks;
}
