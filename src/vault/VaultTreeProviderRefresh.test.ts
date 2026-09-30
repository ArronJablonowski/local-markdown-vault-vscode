import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), watchers: [] as Array<{
	create(uri: unknown): void; change(uri: unknown): void; remove(uri: unknown): void;
}>, order: 'nameAsc', exclude: [] as string[] }));

vi.mock('vscode', async () => {
	const { posix } = await import('node:path');
	const uri = (path: string): unknown => ({ scheme: 'file', fsPath: path, path, toString: () => `file://${path}` });
	class EventEmitter {
		private listeners = new Set<(value: unknown) => void>();
		event = (listener: (value: unknown) => void) => {
			this.listeners.add(listener);
			return { dispose: () => this.listeners.delete(listener) };
		};
		fire(value: unknown) { for (const listener of this.listeners) listener(value); }
		dispose() { this.listeners.clear(); }
	}
	return {
		TreeItem: class { constructor(public resourceUri: unknown, public collapsibleState: unknown) {} },
		EventEmitter,
		CancellationError: class extends Error {},
		FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
		TreeItemCollapsibleState: { None: 0, Collapsed: 1 },
		ThemeIcon: class {},
		RelativePattern: class {},
		Uri: { file: uri, joinPath: (parent: { path: string }, name: string) => uri(posix.join(parent.path, name)) },
		l10n: { t: (value: string) => value },
		workspace: {
			getConfiguration: () => ({ get: (key: string, fallback: unknown) => key === 'sortOrder' ? mocks.order : key === 'exclude' ? mocks.exclude : fallback }),
			createFileSystemWatcher: () => {
				const created = new EventEmitter(); const changed = new EventEmitter(); const deleted = new EventEmitter();
				mocks.watchers.push({ create: value => created.fire(value), change: value => changed.fire(value), remove: value => deleted.fire(value) });
				return { onDidCreate: created.event, onDidChange: changed.event, onDidDelete: deleted.event, dispose: () => {
					created.dispose(); changed.dispose(); deleted.dispose();
				} };
			},
		},
	};
});
vi.mock('./VaultService', () => ({ VaultService: { resolve: mocks.resolve } }));

import * as vscode from 'vscode';
import { VaultEntry, VaultTreeProvider } from './VaultTreeProvider';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}

type Entries = Array<[string, vscode.FileType]>;
const files: Entries = ['Alpha.md', 'Beta.md', 'Delta.md', 'Gamma.md'].map(name => [name, vscode.FileType.File]);
const providers: VaultTreeProvider[] = [];

async function setup() {
	const rootUri = vscode.Uri.file('/vault');
	const service = {
		rootUri,
		relativePath: (uri: vscode.Uri) => uri.path === '/vault' ? '' : uri.path.startsWith('/vault/') ? uri.path.slice(7) : undefined,
		readDirectoryInside: vi.fn(async (): Promise<Entries> => files),
		statEntryInside: vi.fn(async () => ({ birthtimeMs: 1, mtimeMs: 1 })),
	};
	mocks.resolve.mockResolvedValue({ available: true, service });
	const provider = new VaultTreeProvider(); providers.push(provider);
	await provider.initialize();
	const changed = vi.fn(); provider.onDidChangeTreeData(changed);
	return { provider, service, changed, watcher: mocks.watchers.at(-1)! };
}

beforeEach(() => { vi.useFakeTimers(); mocks.watchers.length = 0; mocks.order = 'nameAsc'; mocks.exclude = []; });
afterEach(() => { for (const provider of providers.splice(0)) provider.dispose(); vi.clearAllTimers(); vi.useRealTimers(); });

describe('vault tree refresh races', () => {
	it('does not publish an empty file list when autosave overlaps a slow directory read', async () => {
		const { provider, service, watcher } = await setup();
		const read = deferred<Entries>();
		service.readDirectoryInside.mockImplementationOnce(() => read.promise);
		const pending = provider.getChildren();
		for (let index = 0; index < 20; index++) watcher.change(vscode.Uri.file('/vault/Alpha.md'));
		read.resolve(files);
		expect((await pending).map(node => (node as VaultEntry).vaultPath)).toEqual(files.map(([name]) => name));
	});

	it('coalesces content-change bursts without delaying structural create/delete notifications', async () => {
		const { changed, watcher } = await setup();
		for (let index = 0; index < 20; index++) watcher.change(vscode.Uri.file('/vault/Alpha.md'));
		expect(changed).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(50);
		expect(changed).toHaveBeenCalledTimes(1);
		watcher.create(vscode.Uri.file('/vault/New.md'));
		expect(changed).toHaveBeenCalledTimes(2);
		watcher.remove(vscode.Uri.file('/vault/New.md'));
		expect(changed).toHaveBeenCalledTimes(3);
		await vi.advanceTimersByTimeAsync(50);
		expect(changed).toHaveBeenCalledTimes(4);
	});

	it('retries a directory read if the settled autosave refresh arrives before it finishes', async () => {
		const { provider, service, watcher } = await setup();
		const read = deferred<Entries>(); service.readDirectoryInside.mockImplementationOnce(() => read.promise);
		const pending = provider.getChildren();
		watcher.change(vscode.Uri.file('/vault/Alpha.md'));
		await vi.advanceTimersByTimeAsync(50);
		read.resolve(files);
		expect((await pending).map(node => (node as VaultEntry).vaultPath)).toEqual(files.map(([name]) => name));
		expect(service.readDirectoryInside).toHaveBeenCalledTimes(2);
	});

	it('rereads a superseded directory instead of returning stale or empty children', async () => {
		const { provider, service, watcher } = await setup();
		const read = deferred<Entries>();
		service.readDirectoryInside.mockImplementationOnce(() => read.promise).mockResolvedValue([['New.md', vscode.FileType.File]]);
		const pending = provider.getChildren();
		watcher.remove(vscode.Uri.file('/vault/Alpha.md'));
		read.resolve(files);
		expect((await pending).map(node => (node as VaultEntry).vaultPath)).toEqual(['New.md']);
		expect(service.readDirectoryInside).toHaveBeenCalledTimes(2);
	});

	it('reapplies current exclusions when a configuration refresh overtakes a read', async () => {
		const { provider, service } = await setup();
		const read = deferred<Entries>(); service.readDirectoryInside.mockImplementationOnce(() => read.promise);
		const pending = provider.getChildren();
		mocks.exclude = ['Alpha.md']; provider.refresh(); read.resolve(files);
		expect((await pending).map(node => (node as VaultEntry).vaultPath)).toEqual(['Beta.md', 'Delta.md', 'Gamma.md']);
	});

	it('does not reuse a directory result after vault authority is invalidated', async () => {
		const { provider, service } = await setup();
		const read = deferred<Entries>(); service.readDirectoryInside.mockImplementationOnce(() => read.promise);
		const pending = provider.getChildren(); provider.invalidate(); read.resolve(files);
		expect(await pending).toEqual([]); expect(service.readDirectoryInside).toHaveBeenCalledTimes(1);
	});

	for (const order of ['modifiedNewest', 'modifiedOldest', 'createdNewest', 'createdOldest']) {
		it(`retries an overtaken metadata read and preserves ${order} sorting`, async () => {
			mocks.order = order;
			const { provider, service } = await setup();
			const stat = deferred<{ birthtimeMs: number; mtimeMs: number }>();
			const started = deferred<void>();
			service.statEntryInside.mockImplementation(async () => ({ birthtimeMs: 2, mtimeMs: 2 }));
			service.statEntryInside.mockImplementationOnce(() => { started.resolve(); return stat.promise; });
			service.readDirectoryInside.mockResolvedValue([['Alpha.md', vscode.FileType.File], ['Beta.md', vscode.FileType.File]]);
			const pending = provider.getChildren();
			await started.promise; provider.refresh();
			service.statEntryInside.mockImplementation(async (uri?: unknown) => {
				const rank = (uri as vscode.Uri).path.endsWith('/Alpha.md') ? 1 : 2;
				return { birthtimeMs: rank, mtimeMs: rank };
			});
			stat.resolve({ birthtimeMs: 99, mtimeMs: 99 });
			expect((await pending).map(node => (node as VaultEntry).vaultPath)).toEqual(order.endsWith('Newest') ? ['Beta.md', 'Alpha.md'] : ['Alpha.md', 'Beta.md']);
			expect(service.readDirectoryInside).toHaveBeenCalledTimes(2);
		});
	}

	it('bounds retries during an endless refresh storm and requests one later refresh', async () => {
		const { provider, service, changed } = await setup();
		service.readDirectoryInside.mockImplementation(async () => { provider.refresh(); return files; });
		expect(await provider.getChildren()).toEqual([]);
		expect(service.readDirectoryInside).toHaveBeenCalledTimes(3);
		expect(changed).toHaveBeenCalledTimes(3);
		service.readDirectoryInside.mockResolvedValue(files);
		await vi.advanceTimersByTimeAsync(50);
		expect(changed).toHaveBeenCalledTimes(4);
		expect(await provider.getChildren()).toHaveLength(4);
	});

	it('abandons pending reads and deferred refreshes after disposal', async () => {
		const { provider, service, watcher, changed } = await setup();
		const read = deferred<Entries>(); service.readDirectoryInside.mockImplementationOnce(() => read.promise);
		const pending = provider.getChildren(); watcher.change(vscode.Uri.file('/vault/Alpha.md'));
		provider.dispose(); read.resolve(files);
		expect(await pending).toEqual([]);
		await vi.advanceTimersByTimeAsync(100);
		expect(changed).not.toHaveBeenCalled(); expect(service.readDirectoryInside).toHaveBeenCalledTimes(1);
		expect(await provider.getChildren()).toEqual([]);
	});

	it('does not install a late watcher when initialization finishes after disposal', async () => {
		const resolution = deferred<unknown>(); mocks.resolve.mockReturnValueOnce(resolution.promise);
		const provider = new VaultTreeProvider(); providers.push(provider);
		const initializing = provider.initialize(); provider.dispose();
		resolution.resolve({ available: true, service: { rootUri: vscode.Uri.file('/vault') } });
		await initializing;
		expect(mocks.watchers).toHaveLength(0); expect(provider.service).toBeUndefined();
	});

	it('still discovers symbolic-link replacements reported only as change events', async () => {
		const { provider, service, watcher, changed } = await setup();
		await provider.getChildren();
		service.readDirectoryInside.mockResolvedValue([['Alpha.md', vscode.FileType.SymbolicLink]]);
		watcher.change(vscode.Uri.file('/vault/Alpha.md')); await vi.advanceTimersByTimeAsync(50);
		expect(changed).toHaveBeenCalledOnce();
		const [link] = await provider.getChildren();
		expect((link as VaultEntry).fileType).toBe(vscode.FileType.SymbolicLink);
		expect(link.contextValue).toBe('vaultSymlink');
	});

	it('does not follow symbolic-link directories or suppress guarded read failures', async () => {
		const { provider, service } = await setup();
		const link = new VaultEntry(vscode.Uri.file('/vault/Link'), vscode.FileType.Directory | vscode.FileType.SymbolicLink, service.rootUri, 'Link');
		expect(await provider.getChildren(link)).toEqual([]); expect(service.readDirectoryInside).not.toHaveBeenCalled();
		service.readDirectoryInside.mockRejectedValueOnce(new Error('The directory resolves outside the Document Vault.'));
		expect(await provider.getChildren()).toEqual([]);
	});
});
