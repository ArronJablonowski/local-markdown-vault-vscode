import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Memento } from 'vscode';
import { MAX_EDITOR_DOCUMENT_BYTES } from '../shared/messageValidation';

const mocks = vi.hoisted(() => ({ open: vi.fn(), show: vi.fn(), warning: vi.fn(), error: vi.fn(), command: vi.fn() }));
vi.mock('vscode', () => ({
	workspace: { openTextDocument: mocks.open },
	window: { showTextDocument: mocks.show, showWarningMessage: mocks.warning, showErrorMessage: mocks.error },
	commands: { executeCommand: mocks.command }, l10n: { t: (value: string) => value },
}));
import { MarkdownDraftPreserver } from './markdownDraftPreserver';
import { MarkdownRecoveryStore } from './markdownRecoveryStore';

const source = 'file:///vault/Note.md';
function store() {
	return new MarkdownRecoveryStore({ get: () => undefined, update: vi.fn().mockResolvedValue(undefined) } as unknown as Memento);
}
function nativeDocument(text: string) {
	return { isClosed: false, getText: () => text, uri: { scheme: 'untitled' } };
}

beforeEach(() => {
	for (const mock of Object.values(mocks)) mock.mockReset();
	mocks.open.mockImplementation(async ({ content }) => nativeDocument(content));
	mocks.show.mockResolvedValue(undefined);
	mocks.warning.mockResolvedValue(undefined);
	mocks.error.mockResolvedValue(undefined);
});

describe('provider-owned emergency Markdown recovery', () => {
	it('uses durable storage without creating a native draft when storage succeeds', async () => {
		const durable = store();
		const preserver = new MarkdownDraftPreserver(durable);
		await preserver.preserve(source, 'Exact draft 🐱\r\n');
		expect(durable.list()[0].text).toBe('Exact draft 🐱\r\n');
		expect(mocks.open).not.toHaveBeenCalled();
		expect(preserver.list()).toEqual([]);
	});

	it('keeps all 20 durable entries and opens an exact pinned untitled copy when storage is full', async () => {
		const durable = store();
		for (let index = 0; index < 20; index++) await durable.preserve(source, `older ${index}`);
		const preserver = new MarkdownDraftPreserver(durable);
		const text = '---\ncount: invalid numeric draft\n---\n| A | B |\n| - | - |\n| : | 🐱 |\n';
		await preserver.preserve(source, text);
		expect(durable.list()).toHaveLength(20);
		expect(durable.list()[0].text).toBe('older 0');
		expect(mocks.open).toHaveBeenCalledExactlyOnceWith({ language: 'markdown', content: text });
		expect(mocks.show).toHaveBeenCalledWith(expect.objectContaining({ uri: { scheme: 'untitled' } }), { preview: false });
		expect(preserver.list()).toEqual([]);
		expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining('Use Save As now'));
	});

	it('uses the same safe untitled fallback if the recovery store failed to initialize', async () => {
		await new MarkdownDraftPreserver().preserve(source, 'only remaining draft');
		expect(mocks.open).toHaveBeenCalledWith({ language: 'markdown', content: 'only remaining draft' });
		expect(mocks.open.mock.calls.flat()).not.toContain(source);
	});

	it('retains an exact provider-owned snapshot after native opening fails, but rejects success', async () => {
		mocks.open.mockRejectedValueOnce(new Error('native editor unavailable'));
		const preserver = new MarkdownDraftPreserver();
		await expect(preserver.preserve(source, 'unsaved draft\n')).rejects.toThrow('still needs');
		const entries = preserver.list();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ sourceUri: source, text: 'unsaved draft\n' });
		expect(Object.isFrozen(entries)).toBe(true);
		expect(Object.isFrozen(entries[0])).toBe(true);
		expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('held only in memory'), 'Open Recovered Drafts');
		await preserver.open(entries[0].id);
		expect(mocks.open).toHaveBeenLastCalledWith({ language: 'markdown', content: 'unsaved draft\n' });
		expect(preserver.list()).toEqual([]);
	});

	it('keeps and reuses a native untitled buffer after showing it failed', async () => {
		mocks.show.mockRejectedValueOnce(new Error('window unavailable'));
		const preserver = new MarkdownDraftPreserver();
		await expect(preserver.preserve(source, 'draft')).rejects.toThrow();
		expect(preserver.list()).toHaveLength(1);
		await preserver.open(preserver.list()[0].id);
		expect(mocks.open).toHaveBeenCalledOnce();
		expect(mocks.show).toHaveBeenCalledTimes(2);
		expect(preserver.list()).toEqual([]);
	});

	it.each(['closed', 'edited'])('recreates the exact emergency draft if a hidden native buffer was %s before retry', async (change) => {
		const document = nativeDocument('draft');
		mocks.open.mockResolvedValueOnce(document);
		mocks.show.mockRejectedValueOnce(new Error('window unavailable'));
		const preserver = new MarkdownDraftPreserver();
		await expect(preserver.preserve(source, 'draft')).rejects.toThrow();
		if (change === 'closed') document.isClosed = true;
		else document.getText = () => 'different user edits';
		await preserver.open(preserver.list()[0].id);
		expect(mocks.open).toHaveBeenCalledTimes(2);
		expect(mocks.open).toHaveBeenLastCalledWith({ language: 'markdown', content: 'draft' });
	});

	it('deduplicates repeated and concurrent preservation without replacing other unique drafts', async () => {
		mocks.open.mockRejectedValue(new Error('unavailable'));
		const preserver = new MarkdownDraftPreserver();
		await Promise.allSettled([preserver.preserve(source, 'draft'), preserver.preserve(source, 'draft')]);
		expect(mocks.open).toHaveBeenCalledOnce();
		expect(preserver.list()).toHaveLength(1);
		await expect(preserver.preserve(source, 'newer draft')).rejects.toThrow();
		expect(preserver.list().map(entry => entry.text)).toEqual(['draft', 'newer draft']);
	});

	it('does not evict older emergency entries at capacity and explicitly reports a total preservation failure', async () => {
		mocks.open.mockRejectedValue(new Error('unavailable'));
		const preserver = new MarkdownDraftPreserver();
		for (let index = 0; index < 20; index++) await expect(preserver.preserve(source, `draft ${index}`)).rejects.toThrow();
		await expect(preserver.preserve(source, 'overflow')).rejects.toThrow();
		expect(preserver.list()).toHaveLength(20);
		expect(preserver.list()[0].text).toBe('draft 0');
		expect(mocks.error).toHaveBeenLastCalledWith(expect.stringContaining('This draft could not be preserved'));
		mocks.open.mockImplementation(async ({ content }) => nativeDocument(content));
		await preserver.preserve(source, 'overflow');
		expect(mocks.show).toHaveBeenLastCalledWith(expect.objectContaining({ getText: expect.any(Function) }), { preview: false });
		expect(preserver.list()).toHaveLength(20);
	});

	it('bounds emergency draft bytes without discarding already retained drafts', async () => {
		mocks.open.mockRejectedValue(new Error('unavailable'));
		const preserver = new MarkdownDraftPreserver();
		const text = 'x'.repeat(MAX_EDITOR_DOCUMENT_BYTES);
		for (let index = 0; index < 3; index++) await expect(preserver.preserve(`file:///vault/${index}.md`, text)).rejects.toThrow();
		await expect(preserver.preserve(source, 'overflow')).rejects.toThrow();
		expect(preserver.list()).toHaveLength(3);
		expect(mocks.error).toHaveBeenLastCalledWith(expect.stringContaining('This draft could not be preserved'));
	});

	it('rejects invalid metadata and oversized documents before creating native editors', async () => {
		const preserver = new MarkdownDraftPreserver();
		await expect(preserver.preserve('not a URI', 'draft')).rejects.toThrow();
		await expect(preserver.preserve(source, 'x'.repeat(MAX_EDITOR_DOCUMENT_BYTES + 1))).rejects.toThrow();
		expect(mocks.open).not.toHaveBeenCalled();
		expect(preserver.list()).toEqual([]);
	});

	it('releases the opening state even when native opening throws synchronously', async () => {
		mocks.open.mockImplementationOnce(() => { throw new Error('sync failure'); });
		const preserver = new MarkdownDraftPreserver();
		await expect(preserver.preserve(source, 'draft')).rejects.toThrow();
		await preserver.open(preserver.list()[0].id);
		expect(preserver.list()).toEqual([]);
	});

	it.each(['closed', 'edited'])('retains the original draft if the native copy is %s during reveal', async change => {
		mocks.show.mockImplementationOnce(async document => {
			if (change === 'closed') document.isClosed = true;
			else document.getText = () => 'unexpected change';
		});
		const preserver = new MarkdownDraftPreserver();
		await expect(preserver.preserve(source, 'original exact draft')).rejects.toThrow();
		expect(preserver.list()[0].text).toBe('original exact draft');
		await preserver.open(preserver.list()[0].id);
		expect(mocks.open).toHaveBeenLastCalledWith({ language: 'markdown', content: 'original exact draft' });
	});

	it('reuses a still-exact native copy for repeated checkpoint/close preservation', async () => {
		const preserver = new MarkdownDraftPreserver();
		await preserver.preserve(source, 'exact draft');
		await preserver.preserve(source, 'exact draft');
		expect(mocks.open).toHaveBeenCalledOnce();
		expect(mocks.show).toHaveBeenCalledTimes(2);
	});

	it('drops a stale emergency entry only after the same text is successfully persisted later', async () => {
		const durable = store();
		const preserve = vi.spyOn(durable, 'preserve').mockRejectedValueOnce(new Error('storage failure'));
		mocks.open.mockRejectedValueOnce(new Error('native failure'));
		const preserver = new MarkdownDraftPreserver(durable);
		await expect(preserver.preserve(source, 'draft')).rejects.toThrow();
		expect(preserver.list()).toHaveLength(1);
		await preserver.preserve(source, 'draft');
		expect(preserve).toHaveBeenCalledTimes(2);
		expect(durable.list()[0].text).toBe('draft');
		expect(preserver.list()).toEqual([]);
		expect(mocks.open).toHaveBeenCalledOnce();
	});
});
