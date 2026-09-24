import type { Memento } from 'vscode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_EDITOR_DOCUMENT_BYTES } from '../shared/messageValidation';
import {
	MarkdownRecoveryStore, MARKDOWN_RECOVERY_STATE_KEY, MAX_MARKDOWN_RECOVERY_ENTRIES,
	MAX_MARKDOWN_RECOVERY_STORAGE_BYTES, MAX_MARKDOWN_RECOVERY_QUEUED_OPERATIONS,
} from './markdownRecoveryStore';

function storage(initial?: unknown) {
	const values = new Map<string, unknown>();
	if (initial !== undefined) values.set(MARKDOWN_RECOVERY_STATE_KEY, initial);
	const update = vi.fn(async (key: string, value: unknown) => { values.set(key, value); });
	const memento: Memento = {
		get: <T>(key: string, fallback?: T): T => (values.has(key) ? values.get(key) : fallback) as T,
		update,
		keys: () => [...values.keys()],
	};
	return { values, update, memento };
}

const source = 'file:///vault/Note%20with%20spaces.md';
const id = '01833836-5f65-4404-a0bb-343a11166038';
const validEntry = { id, sourceUri: source, text: 'Unsaved draft', createdAt: 1 };
const envelope = (entries: unknown[]) => ({ version: 1, entries });

afterEach(() => vi.restoreAllMocks());

describe('local Markdown recovery snapshots', () => {
	it('stores the exact Markdown with stable identity and timestamp and reloads it', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(123456789);
		const backing = storage();
		const store = new MarkdownRecoveryStore(backing.memento);
		const markdown = '# Draft\r\n\r\n- [x] Done 😀\r\n\r\n```js\r\nconst value = 1;\r\n```\r\n';
		const savedId = await store.preserve(source, markdown);
		expect(savedId).toMatch(/^[0-9a-f-]{36}$/u);
		expect(store.list()).toEqual([{ id: savedId, sourceUri: source, text: markdown, createdAt: 123456789 }]);
		expect(new MarkdownRecoveryStore(backing.memento).list()).toEqual(store.list());
		expect(backing.update).toHaveBeenCalledWith(MARKDOWN_RECOVERY_STATE_KEY, envelope([...store.list()]));
	});
	it('deduplicates the same source and exact text even when requests arrive together', async () => {
		const backing = storage();
		const store = new MarkdownRecoveryStore(backing.memento);
		const ids = await Promise.all([store.preserve(source, 'same'), store.preserve(source, 'same'), store.preserve(source, 'same')]);
		expect(new Set(ids).size).toBe(1);
		expect(store.list()).toHaveLength(1);
		expect(backing.update).toHaveBeenCalledOnce();
		await store.preserve(source, 'changed');
		await store.preserve('file:///vault/different.md', 'same');
		expect(store.list().map(entry => entry.text)).toEqual(['same', 'changed', 'same']);
	});
	it('preserves intentional empty content as well as every distinct draft from the same note', async () => {
		const store = new MarkdownRecoveryStore(storage().memento);
		await store.preserve(source, 'before deletion');
		await store.preserve(source, '');
		expect(store.list().map(entry => entry.text)).toEqual(['before deletion', '']);
	});
	it('does not expose entries for mutation through list()', async () => {
		const store = new MarkdownRecoveryStore(storage().memento);
		await store.preserve(source, 'original');
		const entries = store.list();
		expect(Object.isFrozen(entries)).toBe(true);
		expect(Object.isFrozen(entries[0])).toBe(true);
		expect(() => { (entries[0] as any).text = 'corrupted'; }).toThrow();
		expect(() => { (entries as any[]).push(validEntry); }).toThrow();
	});
	it('publishes changes only after persistent update resolves and serializes writes', async () => {
		const backing = storage();
		let finish!: () => void;
		backing.update.mockImplementationOnce((key, value) => new Promise<void>(resolve => {
			finish = () => { backing.values.set(key, value); resolve(); };
		}));
		const store = new MarkdownRecoveryStore(backing.memento);
		const first = store.preserve(source, 'first');
		const second = store.preserve(source, 'second');
		await Promise.resolve();
		expect(backing.update).toHaveBeenCalledOnce();
		expect(store.list()).toEqual([]);
		finish();
		await Promise.all([first, second]);
		expect(backing.update).toHaveBeenCalledTimes(2);
		expect(store.list().map(entry => entry.text)).toEqual(['first', 'second']);
	});
	it('retains previously stored snapshots after write failure and permits a later retry', async () => {
		const backing = storage();
		const store = new MarkdownRecoveryStore(backing.memento);
		const firstId = await store.preserve(source, 'first');
		backing.update.mockRejectedValueOnce(new Error('database unavailable'));
		await expect(store.preserve(source, 'second')).rejects.toThrow('Keep the original document open');
		expect(store.list().map(entry => entry.id)).toEqual([firstId]);
		expect(new MarkdownRecoveryStore(backing.memento).list()).toEqual(store.list());
		await store.preserve(source, 'second');
		expect(store.list()).toHaveLength(2);
	});
	it('does not drop recovery content if an explicit removal fails', async () => {
		const backing = storage(envelope([validEntry]));
		const store = new MarkdownRecoveryStore(backing.memento);
		backing.update.mockRejectedValueOnce(new Error('database unavailable'));
		await expect(store.remove(id)).rejects.toThrow('could not be stored locally');
		expect(store.list()).toEqual([validEntry]);
		await store.remove(id);
		expect(store.list()).toEqual([]);
		await store.remove(id);
		expect(backing.update).toHaveBeenCalledTimes(2);
	});
	it('orders removal before a new request to preserve the same text', async () => {
		const backing = storage(envelope([validEntry]));
		const store = new MarkdownRecoveryStore(backing.memento);
		const remove = store.remove(id);
		const preserve = store.preserve(source, validEntry.text);
		await remove;
		const newId = await preserve;
		expect(newId).not.toBe(id);
		expect(store.list().map(entry => entry.id)).toEqual([newId]);
	});
	it('never evicts old drafts to make room for another unique draft', async () => {
		const backing = storage();
		const store = new MarkdownRecoveryStore(backing.memento);
		for (let index = 0; index < MAX_MARKDOWN_RECOVERY_ENTRIES; index++) await store.preserve(source, `draft ${index}`);
		const original = store.list();
		await expect(store.preserve(source, 'one too many')).rejects.toThrow('storage is full');
		expect(store.list()).toBe(original);
		expect(backing.update).toHaveBeenCalledTimes(MAX_MARKDOWN_RECOVERY_ENTRIES);
		await expect(store.preserve(source, 'draft 0')).resolves.toBe(original[0].id);
		await store.remove(original[0].id);
		await store.preserve(source, 'one too many');
		expect(store.list()).toHaveLength(MAX_MARKDOWN_RECOVERY_ENTRIES);
	});
	it('enforces the aggregate byte budget without silently dropping earlier large drafts', async () => {
		const store = new MarkdownRecoveryStore(storage().memento);
		const large = 'x'.repeat(MAX_EDITOR_DOCUMENT_BYTES);
		await store.preserve('file:///vault/first.md', large);
		await store.preserve('file:///vault/second.md', large);
		await expect(store.preserve('file:///vault/third.md', large)).rejects.toThrow('storage is full');
		expect(store.list()).toHaveLength(2);
		expect(Buffer.byteLength(JSON.stringify(envelope([...store.list()])), 'utf8')).toBeLessThanOrEqual(MAX_MARKDOWN_RECOVERY_STORAGE_BYTES);
	});
	it('counts JSON escape expansion rather than allowing an oversized serialized store', async () => {
		const store = new MarkdownRecoveryStore(storage().memento);
		await expect(store.preserve(source, '\u0000'.repeat(Math.floor(MAX_MARKDOWN_RECOVERY_STORAGE_BYTES / 6)))).rejects.toThrow('queue is full');
		expect(store.list()).toEqual([]);
	});
	it('counts UTF-8 document bytes as well as UTF-16 length', async () => {
		const store = new MarkdownRecoveryStore(storage().memento);
		await expect(store.preserve(source, '😀'.repeat(Math.floor(MAX_EDITOR_DOCUMENT_BYTES / 4) + 1))).rejects.toThrow('editor size limit');
		await expect(store.preserve(source, 'x'.repeat(MAX_EDITOR_DOCUMENT_BYTES + 1))).rejects.toThrow('editor size limit');
	});
	it('bounds queued requests when storage is slow and releases queue capacity afterward', async () => {
		const backing = storage();
		let finish!: () => void;
		backing.update.mockImplementationOnce((key, value) => new Promise<void>(resolve => {
			finish = () => { backing.values.set(key, value); resolve(); };
		}));
		const store = new MarkdownRecoveryStore(backing.memento);
		const queued = Array.from({ length: MAX_MARKDOWN_RECOVERY_QUEUED_OPERATIONS }, () => store.preserve(source, 'same draft'));
		await expect(store.preserve(source, 'cannot enqueue')).rejects.toThrow('queue is full');
		expect(backing.update).toHaveBeenCalledOnce();
		finish();
		await Promise.all(queued);
		await store.preserve(source, 'now available');
		expect(store.list()).toHaveLength(2);
	});
	it.each(['', '/vault/not-a-uri.md', 'file:///vault/unsafe\n.md', 'file:///vault/unsafe .md', 'file:///%' + 'a'.repeat(8192)])('rejects malformed source metadata %j', async invalid => {
		const backing = storage();
		await expect(new MarkdownRecoveryStore(backing.memento).preserve(invalid, 'draft')).rejects.toThrow('valid source URI');
		expect(backing.update).not.toHaveBeenCalled();
	});
	it('rejects invalid removal IDs without changing recovery state', async () => {
		const backing = storage(envelope([validEntry]));
		const store = new MarkdownRecoveryStore(backing.memento);
		await expect(store.remove('../draft')).rejects.toThrow('Invalid Markdown recovery identifier');
		expect(store.list()).toEqual([validEntry]);
		expect(backing.update).not.toHaveBeenCalled();
	});
});

describe('validation of stored recovery state', () => {
	it.each([
		null, [], {}, { version: 2, entries: [] }, { version: 1, entries: [], unexpected: true },
		envelope([null]), envelope([{ ...validEntry, script: 'unexpected' }]), envelope([{ ...validEntry, id: 'invalid' }]),
		envelope([validEntry, validEntry]), envelope([{ ...validEntry, sourceUri: 'not a URI' }]),
		envelope([{ ...validEntry, text: 1 }]), envelope([{ ...validEntry, createdAt: -1 }]),
		envelope([{ ...validEntry, createdAt: Infinity }]), envelope([{ ...validEntry, createdAt: 0.5 }]),
		envelope(Array.from({ length: MAX_MARKDOWN_RECOVERY_ENTRIES + 1 }, () => validEntry)),
	])('refuses malformed state without overwriting it (%#)', initial => {
		const backing = storage(initial);
		expect(() => new MarkdownRecoveryStore(backing.memento)).toThrow('has not been overwritten');
		expect(backing.update).not.toHaveBeenCalled();
		expect(backing.values.get(MARKDOWN_RECOVERY_STATE_KEY)).toBe(initial);
	});
	it('rejects an oversized stored document before publishing it to recovery commands', () => {
		const backing = storage(envelope([{ ...validEntry, text: 'x'.repeat(MAX_EDITOR_DOCUMENT_BYTES + 1) }]));
		expect(() => new MarkdownRecoveryStore(backing.memento)).toThrow('has not been overwritten');
		expect(backing.update).not.toHaveBeenCalled();
	});
	it('counts Unicode and escape sequences the same way as the JSON representation', async () => {
		const backing = storage();
		const store = new MarkdownRecoveryStore(backing.memento);
		const text = '😀é\u0000\u0001\b\t\n\f\r"\\\ud800\udfff';
		await store.preserve(source, text);
		expect(new MarkdownRecoveryStore(backing.memento).list()[0].text).toBe(text);
		expect(JSON.parse(JSON.stringify(backing.values.get(MARKDOWN_RECOVERY_STATE_KEY))).entries[0].text).toBe(text);
	});
});
