import { randomUUID } from 'node:crypto';
import type { Memento } from 'vscode';
import { MAX_EDITOR_DOCUMENT_BYTES } from '../shared/messageValidation';

export const MARKDOWN_RECOVERY_STATE_KEY = 'mdLivePreview.recovery.v1';
export const MAX_MARKDOWN_RECOVERY_ENTRIES = 20;
export const MAX_MARKDOWN_RECOVERY_STORAGE_BYTES = 60 * 1024 * 1024;
export const MAX_MARKDOWN_RECOVERY_QUEUED_OPERATIONS = 20;
const MAX_SOURCE_URI_LENGTH = 8192;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface MarkdownRecoveryEntry {
	readonly id: string;
	readonly sourceUri: string;
	readonly text: string;
	readonly createdAt: number;
}

interface RecoveryState {
	version: 1;
	entries: readonly MarkdownRecoveryEntry[];
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;
	const actual = Reflect.ownKeys(value);
	return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function validSourceUri(value: unknown): value is string {
	if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SOURCE_URI_LENGTH || /[\u0000-\u0020\u007f]/u.test(value)) return false;
	try { return /^[a-z][a-z0-9+.-]*:/iu.test(value) && new URL(value).protocol.length > 1; } catch { return false; }
}

function validText(value: unknown): value is string {
	return typeof value === 'string' && value.length <= MAX_EDITOR_DOCUMENT_BYTES && Buffer.byteLength(value, 'utf8') <= MAX_EDITOR_DOCUMENT_BYTES;
}

/** Count the JSON representation without allocating another potentially huge escaped copy. */
function jsonStringBytes(value: string): number {
	let bytes = Buffer.byteLength(value, 'utf8') + 2;
	for (const match of value.matchAll(/[\u0000-\u001f"\\\ud800-\udfff]/gu)) {
		const code = match[0].charCodeAt(0);
		if (code >= 0xd800) bytes += 3; // A lone surrogate is escaped instead of UTF-8 replacement encoding.
		else if (code === 0x22 || code === 0x5c || [8, 9, 10, 12, 13].includes(code)) bytes++;
		else bytes += 5;
		if (bytes > MAX_MARKDOWN_RECOVERY_STORAGE_BYTES) return bytes;
	}
	return bytes;
}

function entryBytes(entry: MarkdownRecoveryEntry): number {
	// The short metadata is bounded separately; the potentially large text is
	// counted without stringify, including escape expansion and Unicode.
	return Buffer.byteLength(JSON.stringify({ ...entry, text: '' }), 'utf8') - 2 + jsonStringBytes(entry.text);
}

function stateBytes(entries: readonly MarkdownRecoveryEntry[]): number {
	let bytes = Buffer.byteLength('{"version":1,"entries":[]}', 'utf8');
	for (let index = 0; index < entries.length; index++) {
		bytes += entryBytes(entries[index]) + (index === 0 ? 0 : 1);
		if (bytes > MAX_MARKDOWN_RECOVERY_STORAGE_BYTES) return bytes;
	}
	return bytes;
}

function validatedState(value: unknown): readonly MarkdownRecoveryEntry[] {
	if (value === undefined) return Object.freeze([]);
	if (!exactObject(value, ['version', 'entries']) || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > MAX_MARKDOWN_RECOVERY_ENTRIES) {
		throw new Error('Stored Markdown recovery data is invalid. It has not been overwritten.');
	}
	const ids = new Set<string>();
	const entries: MarkdownRecoveryEntry[] = [];
	for (const candidate of value.entries) {
		if (!exactObject(candidate, ['id', 'sourceUri', 'text', 'createdAt']) || typeof candidate.id !== 'string' || !UUID.test(candidate.id) || ids.has(candidate.id)
			|| !validSourceUri(candidate.sourceUri) || !validText(candidate.text) || typeof candidate.createdAt !== 'number' || !Number.isSafeInteger(candidate.createdAt) || candidate.createdAt < 0) {
			throw new Error('Stored Markdown recovery data is invalid. It has not been overwritten.');
		}
		ids.add(candidate.id);
		entries.push(Object.freeze({ id: candidate.id, sourceUri: candidate.sourceUri, text: candidate.text, createdAt: candidate.createdAt }));
	}
	if (stateBytes(entries) > MAX_MARKDOWN_RECOVERY_STORAGE_BYTES) throw new Error('Stored Markdown recovery data exceeds its safety limit. It has not been overwritten.');
	return Object.freeze(entries);
}

/**
 * Bounded, local-only workspace recovery snapshots. URI values are descriptive
 * metadata, never read/write authority: the host must supply the source URI.
 * No filesystem operation, path resolution, automatic restore, or eviction is
 * performed here. Callers must keep their original dirty draft if a write fails.
 */
export class MarkdownRecoveryStore {
	private entries: readonly MarkdownRecoveryEntry[];
	private queue: Promise<void> = Promise.resolve();
	private queuedOperations = 0;
	private queuedBytes = 0;

	constructor(private readonly state: Memento) {
		this.entries = validatedState(state.get<unknown>(MARKDOWN_RECOVERY_STATE_KEY));
	}

	list(): readonly MarkdownRecoveryEntry[] { return this.entries; }

	preserve(sourceUri: string, text: string): Promise<string> {
		if (!validSourceUri(sourceUri) || !validText(text)) return Promise.reject(new Error('Markdown recovery requires a valid source URI and a document within the editor size limit.'));
		const entry: MarkdownRecoveryEntry = Object.freeze({ id: randomUUID(), sourceUri, text, createdAt: Date.now() });
		return this.enqueue(entryBytes(entry), async () => {
			const existing = this.entries.find(item => item.sourceUri === sourceUri && item.text === text);
			if (existing) return existing.id;
			if (this.entries.some(item => item.id === entry.id)) throw new Error('A unique Markdown recovery identifier could not be created. Try preserving the draft again.');
			const next = Object.freeze([...this.entries, entry]);
			if (next.length > MAX_MARKDOWN_RECOVERY_ENTRIES || stateBytes(next) > MAX_MARKDOWN_RECOVERY_STORAGE_BYTES) {
				throw new Error('Markdown recovery storage is full. Existing drafts have been kept. Export or remove a recovered draft before trying again.');
			}
			await this.write(next);
			return entry.id;
		});
	}

	remove(id: string): Promise<void> {
		if (typeof id !== 'string' || !UUID.test(id)) return Promise.reject(new Error('Invalid Markdown recovery identifier.'));
		return this.enqueue(0, async () => {
			if (!this.entries.some(entry => entry.id === id)) return;
			await this.write(Object.freeze(this.entries.filter(entry => entry.id !== id)));
		});
	}

	private async write(entries: readonly MarkdownRecoveryEntry[]): Promise<void> {
		const stored: RecoveryState = { version: 1, entries };
		try { await this.state.update(MARKDOWN_RECOVERY_STATE_KEY, stored); }
		catch { throw new Error('The Markdown recovery draft could not be stored locally. Keep the original document open and save a copy manually.'); }
		// Publish the new list only after persistence succeeds; failures retain the old snapshots.
		this.entries = entries;
	}

	private enqueue<T>(bytes: number, action: () => Promise<T>): Promise<T> {
		if (this.queuedOperations >= MAX_MARKDOWN_RECOVERY_QUEUED_OPERATIONS || this.queuedBytes + bytes > MAX_MARKDOWN_RECOVERY_STORAGE_BYTES) {
			return Promise.reject(new Error('Markdown recovery is busy or its queue is full. Existing drafts have been kept. Try again after the current save finishes.'));
		}
		this.queuedOperations++;
		this.queuedBytes += bytes;
		const operation = this.queue.then(action);
		const settled = operation.finally(() => { this.queuedOperations--; this.queuedBytes -= bytes; });
		// Keep failures visible to this caller without blocking later recovery operations.
		this.queue = settled.then(() => {}, () => {});
		return settled;
	}
}
