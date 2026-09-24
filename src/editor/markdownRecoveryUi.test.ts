import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarkdownRecoveryStore } from './markdownRecoveryStore';

const mocks = vi.hoisted(() => ({
	command: undefined as undefined | (() => Promise<void>),
	picker: undefined as any,
	open: vi.fn(), show: vi.fn(), warning: vi.fn(), error: vi.fn(), information: vi.fn(),
}));
vi.mock('vscode', () => ({
	commands: { registerCommand: (_name: string, callback: () => Promise<void>) => { mocks.command = callback; return { dispose() {} }; } },
	l10n: { t: (text: string) => text },
	Uri: { parse: (uri: string) => ({ path: decodeURIComponent(new URL(uri).pathname) }) },
	ThemeIcon: class { constructor(readonly id: string) {} },
	workspace: { openTextDocument: mocks.open },
	window: {
		showTextDocument: mocks.show, showWarningMessage: mocks.warning,
		showErrorMessage: mocks.error, showInformationMessage: mocks.information,
		createQuickPick: () => mocks.picker,
	},
}));
import { registerMarkdownRecovery } from './markdownRecoveryUi';

describe('recovered draft picker', () => {
	let accept: () => void;
	let remove: (event: any) => Promise<void>;
	let hide: () => void;
	let entries: any[];
	let store: MarkdownRecoveryStore;
	let deleteEntry: ReturnType<typeof vi.fn>;
	const draft = { id: 'copy-1', sourceUri: 'file:///vault/Original%20note.md', text: '# Exact recovered draft\r\n', createdAt: 1 };
	beforeEach(() => {
		vi.clearAllMocks();
		entries = [{ ...draft }];
		deleteEntry = vi.fn(async (id: string) => { entries = entries.filter(entry => entry.id !== id); });
		store = { list: () => entries, remove: deleteEntry } as unknown as MarkdownRecoveryStore;
		mocks.open.mockReset().mockResolvedValue({ uri: { scheme: 'untitled' } });
		mocks.show.mockReset().mockResolvedValue(undefined);
		mocks.warning.mockReset().mockResolvedValue(undefined);
		mocks.error.mockReset().mockResolvedValue(undefined);
		mocks.picker = {
			items: [], selectedItems: [], show: vi.fn(), dispose: vi.fn(),
			hide: vi.fn(() => hide()),
			onDidAccept: (callback: () => void) => { accept = callback; return { dispose: vi.fn() }; },
			onDidTriggerItemButton: (callback: typeof remove) => { remove = callback; return { dispose: vi.fn() }; },
			onDidHide: (callback: () => void) => { hide = callback; return { dispose: vi.fn() }; },
		};
	});
	const openPicker = async () => { registerMarkdownRecovery(store); await mocks.command!(); };
	it('opens exact text as a new document and retains its recovery copy', async () => {
		await openPicker();
		expect(mocks.picker.items[0].label).toBe('Original note.md');
		mocks.picker.selectedItems = [mocks.picker.items[0]];
		accept();
		await vi.waitFor(() => expect(mocks.show).toHaveBeenCalled());
		expect(mocks.open).toHaveBeenCalledWith({ language: 'markdown', content: draft.text });
		expect(mocks.show).toHaveBeenCalledWith({ uri: { scheme: 'untitled' } }, { preview: false });
		expect(deleteEntry).not.toHaveBeenCalled();
		expect(entries).toHaveLength(1);
	});
	it('does not delete a recovery copy when confirmation is canceled', async () => {
		await openPicker();
		await remove({ item: mocks.picker.items[0] });
		expect(mocks.warning).toHaveBeenCalledWith(expect.any(String), { modal: true }, 'Delete recovery copy');
		expect(deleteEntry).not.toHaveBeenCalled();
		expect(entries).toHaveLength(1);
	});
	it('deletes only the explicitly confirmed recovery entry and refreshes the picker', async () => {
		await openPicker();
		mocks.warning.mockResolvedValueOnce('Delete recovery copy');
		await remove({ item: mocks.picker.items[0] });
		expect(deleteEntry).toHaveBeenCalledExactlyOnceWith(draft.id);
		expect(mocks.picker.items).toEqual([]);
		expect(mocks.open).not.toHaveBeenCalled();
	});
	it('reports a failed deletion without hiding the retained copy', async () => {
		await openPicker();
		mocks.warning.mockResolvedValueOnce('Delete recovery copy');
		deleteEntry.mockRejectedValueOnce(new Error('storage unavailable'));
		await remove({ item: mocks.picker.items[0] });
		expect(mocks.error).toHaveBeenCalledWith('The recovery copy could not be deleted.');
		expect(entries).toHaveLength(1);
		expect(mocks.picker.items).toHaveLength(1);
	});
	it('keeps the recovery entry if opening the copy fails', async () => {
		await openPicker();
		mocks.open.mockRejectedValueOnce(new Error('editor unavailable'));
		mocks.picker.selectedItems = [mocks.picker.items[0]];
		accept();
		await vi.waitFor(() => expect(mocks.error).toHaveBeenCalled());
		expect(entries).toHaveLength(1);
		expect(deleteEntry).not.toHaveBeenCalled();
	});
	it('reports empty and unavailable stores without changing any document', async () => {
		entries = [];
		await openPicker();
		expect(mocks.information).toHaveBeenCalled();
		registerMarkdownRecovery();
		await mocks.command!();
		expect(mocks.error).toHaveBeenCalled();
		expect(mocks.picker.show).not.toHaveBeenCalled();
		expect(mocks.open).not.toHaveBeenCalled();
	});
	it('offers an emergency copy even when the persistent store is unavailable', async () => {
		const emergency = { list: () => [draft], open: vi.fn(async () => {}) };
		registerMarkdownRecovery(undefined, emergency);
		await mocks.command!();
		expect(mocks.picker.show).toHaveBeenCalled();
		expect(mocks.picker.items[0].description).toContain('memory only');
		mocks.picker.selectedItems = [mocks.picker.items[0]];
		accept();
		expect(emergency.open).toHaveBeenCalledExactlyOnceWith(draft.id);
		expect(mocks.open).not.toHaveBeenCalled();
		expect(mocks.error).not.toHaveBeenCalled();
	});
	it('never exposes a delete action for an emergency memory-only copy', async () => {
		const emergency = { list: () => [draft], open: vi.fn(async () => {}) };
		registerMarkdownRecovery(store, emergency);
		await mocks.command!();
		expect(mocks.picker.items).toHaveLength(2);
		expect(mocks.picker.items[0].buttons).toBeUndefined();
		expect(mocks.picker.items[1].buttons).toHaveLength(1);
		await remove({ item: mocks.picker.items[0] });
		expect(deleteEntry).not.toHaveBeenCalled();
		expect(mocks.warning).not.toHaveBeenCalled();
	});
});
