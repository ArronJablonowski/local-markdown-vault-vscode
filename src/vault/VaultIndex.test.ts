import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { VaultService } from './VaultService';

const mocks = vi.hoisted(() => ({
	documents: [] as Array<{ uri: unknown; getText(): string }>,
	exclusions: [] as string[],
	findFiles: vi.fn<() => Promise<unknown[]>>(),
	deleteFile: vi.fn<() => Promise<void>>(),
}));

vi.mock('vscode', () => ({
	workspace: {
		get textDocuments() { return mocks.documents; },
		getConfiguration: () => ({ get: () => mocks.exclusions }),
		findFiles: () => mocks.findFiles(),
		fs: {
			delete: () => mocks.deleteFile(),
			createDirectory: async () => {}, writeFile: async () => {}, rename: async () => {},
		},
	},
	Uri: {
		joinPath: (base: { fsPath: string }, ...segments: string[]) => {
			const fsPath = `${base.fsPath}/${segments.join('/')}`;
			return { fsPath, toString: () => `file://${fsPath}` };
		},
	},
	EventEmitter: class {
		private listeners = new Set<(value: unknown) => void>();
		event = (listener: (value: unknown) => void) => {
			this.listeners.add(listener);
			return { dispose: () => this.listeners.delete(listener) };
		};
		fire(value: unknown) { for (const listener of this.listeners) listener(value); }
		dispose() { this.listeners.clear(); }
	},
	RelativePattern: class {},
	CancellationError: class extends Error {},
}));
vi.mock('./VaultService', () => ({}));
import { VaultIndex, type VaultIndexRecord } from './VaultIndex';

function uri(path: string): vscode.Uri {
	return { fsPath: path, toString: () => `file://${path}` } as vscode.Uri;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
}

const instances: VaultIndex[] = [];
function fixture() {
	const note = uri('/vault/Note.md');
	const content = {
		bytes: new TextEncoder().encode('# Note\nsearchable content\n'),
		mtimeMs: 1, size: 26, identity: { dev: 1, ino: 2, birthtimeMs: 1 },
	};
	const vault = {
		rootUri: uri('/vault'), canonicalRootUri: uri('/vault'), canonicalRootPath: '/vault',
		uriForRelative: (path: string) => uri(`/vault/${path}`),
		relativePath: (value: vscode.Uri) => value.fsPath.slice('/vault/'.length),
		assertExistingInside: vi.fn(async () => {}),
		readFileInside: vi.fn(async () => content),
	};
	const index = new VaultIndex(vault as unknown as VaultService, {
		globalStorageUri: uri('/storage'), extension: { packageJSON: { version: '0.2.0' } },
	} as unknown as vscode.ExtensionContext);
	instances.push(index);
	const records = (index as unknown as { records: Map<string, VaultIndexRecord> }).records;
	records.set('Note.md', {
		path: 'Note.md', basename: 'Note', mtime: 1, size: 26,
		headings: [], aliases: [], blockIds: [], tags: [], properties: {}, links: [], tasks: [], searchTokens: [],
	});
	return { index, vault, note, content, records };
}

beforeEach(() => {
	vi.useFakeTimers();
	mocks.documents = [];
	mocks.exclusions = [];
	mocks.findFiles.mockReset().mockResolvedValue([]);
	mocks.deleteFile.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
	for (const index of instances.splice(0)) index.dispose();
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe('vault index on-demand read boundaries', () => {
	it('does not authorize or read a note newly excluded before the rebuild runs', async () => {
		const { index, vault } = fixture();
		mocks.exclusions = ['Note.md'];
		await expect(index.readText('Note.md')).resolves.toBeUndefined();
		expect(vault.assertExistingInside).not.toHaveBeenCalled();
		expect(vault.readFileInside).not.toHaveBeenCalled();
	});

	it('rechecks exclusions after authorization before exposing an open dirty buffer', async () => {
		const { index, vault, note } = fixture();
		const authorization = deferred<void>();
		vault.assertExistingInside.mockReturnValueOnce(authorization.promise);
		const getText = vi.fn(() => 'private unsaved content');
		mocks.documents = [{ uri: note, getText }];
		const read = index.readText('Note.md');
		mocks.exclusions = ['*.md'];
		authorization.resolve();
		await expect(read).resolves.toBeUndefined();
		expect(getText).not.toHaveBeenCalled();
		expect(vault.readFileInside).not.toHaveBeenCalled();
	});

	it('does not expose a file read that finishes after the note becomes excluded', async () => {
		const { index, vault, content } = fixture();
		const file = deferred<typeof content>();
		const started = deferred<void>();
		vault.readFileInside.mockImplementationOnce(() => { started.resolve(); return file.promise; });
		const read = index.readText('Note.md');
		await started.promise;
		mocks.exclusions = ['Note.md'];
		file.resolve(content);
		await expect(read).resolves.toBeUndefined();
	});

	it.each(['disposed', 'removed', 'rebuilding'] as const)('rejects a note made %s during authorization', async (change) => {
		const { index, vault, records } = fixture();
		const authorization = deferred<void>();
		vault.assertExistingInside.mockReturnValueOnce(authorization.promise);
		const read = index.readText('Note.md');
		let rebuild: Promise<void> | undefined;
		if (change === 'disposed') index.dispose();
		else if (change === 'removed') records.clear();
		else rebuild = index.rebuild();
		authorization.resolve();
		await expect(read).resolves.toBeUndefined();
		expect(vault.readFileInside).not.toHaveBeenCalled();
		await rebuild;
	});

	it('keeps current unsaved text authoritative without reading stale disk text', async () => {
		const { index, vault, note } = fixture();
		mocks.documents = [{ uri: note, getText: () => 'newest draft' }];
		await expect(index.readText('Note.md')).resolves.toBe('newest draft');
		expect(vault.readFileInside).not.toHaveBeenCalled();
	});

	it('does not read retained records from an index disabled by a failed rebuild', async () => {
		const { index, vault, records } = fixture();
		const record = records.get('Note.md')!;
		mocks.findFiles.mockRejectedValueOnce(new Error('discovery failed'));
		await expect(index.rebuild()).rejects.toThrow('discovery failed');
		// Even a stale consumer restoring a record cannot bypass the disabled state.
		records.set(record.path, record);
		await expect(index.readText(record.path)).resolves.toBeUndefined();
		expect(vault.assertExistingInside).not.toHaveBeenCalled();
	});
});

describe('vault index search readiness', () => {
	it('waits for discovery and all note reads instead of exposing a partial snapshot', async () => {
		const { index, vault, note, content } = fixture();
		const discovery = deferred<unknown[]>();
		const read = deferred<typeof content>();
		const started = deferred<void>();
		mocks.findFiles.mockReturnValueOnce(discovery.promise);
		vault.readFileInside.mockImplementationOnce(() => { started.resolve(); return read.promise; });
		const rebuild = index.rebuild();
		let ready = false;
		const waiting = index.waitForRebuild().then((value) => { ready = value; return value; });
		await Promise.resolve();
		expect(ready).toBe(false);
		discovery.resolve([note]);
		await started.promise;
		expect(ready).toBe(false);
		read.resolve(content);
		await rebuild;
		await expect(waiting).resolves.toBe(true);
		expect(index.all()).toHaveLength(1);
	});

	it('waits for another rebuild that begins while an earlier snapshot is pending', async () => {
		const { index } = fixture();
		const first = deferred<unknown[]>();
		const second = deferred<unknown[]>();
		mocks.findFiles.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		const initial = index.rebuild();
		let ready = false;
		const waiting = index.waitForRebuild().then((value) => { ready = value; return value; });
		await Promise.resolve();
		const replacement = index.rebuild();
		first.resolve([]);
		await initial;
		expect(ready).toBe(false);
		second.resolve([]);
		await replacement;
		await expect(waiting).resolves.toBe(true);
	});

	it('includes reset cache cleanup and registers before synchronous change listeners', async () => {
		const { index } = fixture();
		const cleanup = deferred<void>();
		mocks.deleteFile.mockReturnValueOnce(cleanup.promise);
		let ready = false;
		let waiting: Promise<boolean> | undefined;
		index.onDidChange(() => {
			waiting ??= index.waitForRebuild().then((value) => { ready = value; return value; });
		});
		const reset = index.reset();
		await Promise.resolve();
		expect(waiting).toBeDefined();
		expect(ready).toBe(false);
		cleanup.resolve();
		await reset;
		await expect(waiting).resolves.toBe(true);
	});

	it('lets a canceled search stop waiting without canceling the shared rebuild', async () => {
		const { index } = fixture();
		const discovery = deferred<unknown[]>();
		mocks.findFiles.mockReturnValueOnce(discovery.promise);
		const rebuild = index.rebuild();
		const controller = new AbortController();
		const waiting = index.waitForRebuild(controller.signal);
		controller.abort();
		await expect(waiting).resolves.toBe(false);
		discovery.resolve([]);
		await rebuild;
		await expect(index.waitForRebuild()).resolves.toBe(true);
	});

	it('reports a failed index as unavailable and recovers after a successful rebuild', async () => {
		const { index } = fixture();
		mocks.findFiles.mockRejectedValueOnce(new Error('discovery failed'));
		const rebuild = index.rebuild();
		const waiting = index.waitForRebuild();
		await expect(rebuild).rejects.toThrow('discovery failed');
		await expect(waiting).resolves.toBe(false);
		await index.rebuild();
		await expect(index.waitForRebuild()).resolves.toBe(true);
	});

	it('does not report a disposed index as available', async () => {
		const { index } = fixture();
		index.dispose();
		await expect(index.waitForRebuild()).resolves.toBe(false);
	});
});
