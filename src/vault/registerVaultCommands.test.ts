import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as VSCode from 'vscode';

const mocks = vi.hoisted(() => ({
	commands: new Map<string, (...args: any[]) => unknown>(),
	configListeners: new Set<(event: any) => void>(),
	folderListeners: new Set<() => void>(),
	exclusions: [] as string[], trusted: true,
	service: undefined as any, index: undefined as any, provider: undefined as any,
	pickers: [] as any[], input: vi.fn(), warning: vi.fn(), information: vi.fn(), error: vi.fn(), open: vi.fn(), rewrite: vi.fn(),
}));

vi.mock('vscode', async () => {
	const { posix } = await import('node:path');
	class Uri {
		readonly scheme = 'file';
		constructor(readonly fsPath: string) {}
		get path() { return this.fsPath; }
		toString() { return `file://${this.fsPath}`; }
		static file(path: string) { return new Uri(path); }
		static parse(path: string) { return new Uri(path.replace(/^file:\/\//, '')); }
		static joinPath(parent: Uri, ...paths: string[]) { return new Uri(posix.join(parent.path, ...paths)); }
	}
	class EventEmitter {
		private listeners = new Set<(value: unknown) => unknown>();
		event = (listener: (value: unknown) => unknown) => {
			this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) };
		};
		fire(value?: unknown) { return Promise.all([...this.listeners].map(listener => listener(value))); }
		dispose() { this.listeners.clear(); }
	}
	const disposable = () => ({ dispose() {} });
	const listen = (listeners: Set<any>) => (callback: any) => { listeners.add(callback); return { dispose: () => listeners.delete(callback) }; };
	return {
		Uri, EventEmitter,
		TreeItem: class {}, ThemeIcon: class { constructor(readonly id: string) {} },
		FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
		TreeItemCollapsibleState: { None: 0, Collapsed: 1 },
		TabInputCustom: class {}, TabInputText: class {}, CancellationError: class extends Error {},
		ProgressLocation: { Window: 10, Notification: 15 },
		CancellationTokenSource: class {
			token = { isCancellationRequested: false, onCancellationRequested: disposable };
			cancel() { this.token.isCancellationRequested = true; }
			dispose() {}
		},
		l10n: { t: (value: string, ...args: unknown[]) => value.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)])) },
		workspace: {
			get isTrusted() { return mocks.trusted; },
			get workspaceFolders() { return [{ uri: Uri.file('/vault') }]; },
			getConfiguration: () => ({ get: (key: string, fallback: unknown) => key === 'exclude' ? mocks.exclusions : fallback }),
			onDidRenameFiles: disposable,
			onDidChangeWorkspaceFolders: listen(mocks.folderListeners),
			onDidChangeConfiguration: listen(mocks.configListeners),
		},
		commands: {
			registerCommand: (name: string, callback: (...args: any[]) => unknown) => {
				mocks.commands.set(name, callback); return { dispose: () => mocks.commands.delete(name) };
			},
			executeCommand: async (name: string, ...args: unknown[]) => mocks.commands.get(name)?.(...args),
		},
		window: {
			createTreeView: () => ({ visible: false, selection: [], onDidChangeVisibility: disposable, dispose() {} }),
			onDidChangeActiveTextEditor: disposable,
			tabGroups: { activeTabGroup: {}, onDidChangeTabs: disposable, onDidChangeTabGroups: disposable },
			showInputBox: mocks.input, showWarningMessage: mocks.warning, showInformationMessage: mocks.information, showErrorMessage: mocks.error,
			withProgress: async (_options: unknown, callback: any) => callback({}, { isCancellationRequested: false, onCancellationRequested: disposable }),
			createQuickPick: () => {
				const changed = new EventEmitter(), accepted = new EventEmitter(), hidden = new EventEmitter(), button = new EventEmitter();
				const picker = {
					value: '', items: [] as any[], selectedItems: [] as any[], busy: false, visible: false,
					onDidChangeValue: changed.event, onDidAccept: accepted.event, onDidHide: hidden.event, onDidTriggerButton: button.event,
					show() { this.visible = true; },
					hide() { this.visible = false; void hidden.fire(); },
					dispose: vi.fn(),
					async type(value: string) { this.value = value; await changed.fire(value); },
					async accept(item?: any) { const selected = item ?? this.items[0]; this.selectedItems = selected ? [selected] : []; await accepted.fire(); },
				};
				mocks.pickers.push(picker); return picker;
			},
		},
	};
});

vi.mock('./VaultTreeProvider', async () => {
	const vscode = await import('vscode');
	return {
		VaultEntry: class {
			constructor(readonly uri: VSCode.Uri, readonly fileType: VSCode.FileType, readonly parentUri: VSCode.Uri, readonly vaultPath: string) {}
		},
		VaultTreeProvider: class {
			service: any;
			private changed = new vscode.EventEmitter();
			onDidChangeTreeData = this.changed.event;
			constructor() { mocks.provider = this; }
			async initialize() { this.service = mocks.service; }
			invalidate() { this.service = undefined; }
			refresh = vi.fn();
			getChildren = vi.fn(async () => []);
			dispose() { this.changed.dispose(); }
		},
	};
});
vi.mock('./VaultIndex', () => ({ VaultIndex: class { constructor() { return mocks.index; } } }));
vi.mock('./KnowledgeTreeProviders', () => {
	class Provider {
		setIndex() {} setFilter() {} setSort() {} setActiveUri() {} dispose() {}
		getFilter() { return 'all'; } getSort() { return 'linkedFirst'; }
	}
	return { VaultBacklinksProvider: Provider, VaultTagsProvider: Provider, VaultBrokenLinksProvider: Provider };
});
vi.mock('./LinkRewriteService', () => ({ LinkRewriteService: class { renameOrMove = mocks.rewrite; }, VaultTransactionConflictError: class extends Error {} }));
vi.mock('../editor/configuredDocumentOpen', () => ({ openConfiguredVaultResource: mocks.open }));

import * as vscode from 'vscode';
import { registerVault } from './registerVault';
import type { VaultIndexRecord } from './VaultIndex';

function deferred<T = void>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}

const subscriptions: VSCode.Disposable[] = [];
let records: VaultIndexRecord[];
let changed: VSCode.EventEmitter<void>;
beforeEach(async () => {
	vi.clearAllMocks(); mocks.commands.clear(); mocks.configListeners.clear(); mocks.folderListeners.clear(); mocks.pickers.length = 0;
	mocks.trusted = true; mocks.exclusions = [];
	mocks.input.mockResolvedValue(undefined); mocks.warning.mockResolvedValue(undefined); mocks.open.mockResolvedValue(undefined); mocks.rewrite.mockResolvedValue(true);
	records = [{ path: 'Note.md', basename: 'Note', mtime: 1, size: 1, aliases: [], headings: [], tags: [], properties: {}, tasks: [], links: [], blockIds: [], searchTokens: [] }];
	changed = new vscode.EventEmitter<void>();
	mocks.service = {
		rootUri: vscode.Uri.file('/vault'),
		relativePath: (uri: VSCode.Uri) => uri.path === '/vault' ? '' : uri.path.startsWith('/vault/') ? uri.path.slice(7) : undefined,
		uriForRelative: (path: string) => vscode.Uri.file(`/vault/${path}`),
		assertRegularFileInside: vi.fn(async () => {}), assertMutationSource: vi.fn(async () => {}),
		statEntryInside: vi.fn(async () => ({ isSymbolicLink: () => false, isDirectory: () => false })),
		createNote: vi.fn(async () => vscode.Uri.file('/vault/New.md')), createNoteAtRelativePath: vi.fn(async () => vscode.Uri.file('/vault/New.md')),
		createFolder: vi.fn(async () => vscode.Uri.file('/vault/New')), moveToTrash: vi.fn(async () => {}),
		moveDestination: vi.fn(async (_uri: VSCode.Uri, parent: VSCode.Uri, name: string) => vscode.Uri.joinPath(parent, name)),
	};
	mocks.index = {
		id: 'a'.repeat(64), legacyIds: [], vault: mocks.service,
		initialize: vi.fn(async () => {}), dispose: vi.fn(), onDidChange: changed.event, onDidFail: () => ({ dispose() {} }),
		flushDocumentUpdates: vi.fn(async () => {}), waitForRebuild: vi.fn(async () => true),
		all: () => records, get: (path: string) => records.find(record => record.path === path),
		rebuild: vi.fn(async () => {}), readText: vi.fn(async () => 'searchable needle'),
	};
	const state = new Map<string, unknown>();
	await registerVault({ subscriptions, workspaceState: {
		get: (key: string, fallback?: unknown) => state.has(key) ? state.get(key) : fallback,
		update: async (key: string, value: unknown) => { state.set(key, value); },
	} } as unknown as VSCode.ExtensionContext);
});
afterEach(() => {
	for (const disposable of subscriptions.splice(0).reverse()) disposable.dispose();
	changed.dispose(); vi.useRealTimers();
});

function command(name: string, ...args: unknown[]) { return Promise.resolve(mocks.commands.get(`mdLivePreview.${name}`)!(...args)); }
function updateExclusions(patterns: string[]) {
	mocks.exclusions = patterns;
	for (const listener of mocks.configListeners) listener({ affectsConfiguration: (name: string) => name === 'mdLivePreview.vault' || name === 'mdLivePreview.vault.exclude' });
}

describe('vault command prompt and cancellation behavior', () => {
	it.each(['newNote', 'newFolder', 'rename'])('canceling %s has no filesystem or navigation side effects', async name => {
		await command(`vault.${name}`, { uri: vscode.Uri.file('/vault/Note.md') });
		expect(mocks.input).toHaveBeenCalledOnce();
		expect(mocks.service.createNote).not.toHaveBeenCalled(); expect(mocks.service.createFolder).not.toHaveBeenCalled();
		expect(mocks.rewrite).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled();
	});

	it('New Note reports invalid input before the user can accept it', async () => {
		await command('vault.newNote');
		const validate = mocks.input.mock.calls[0][0].validateInput;
		for (const name of ['', '.', '..', 'Name ', 'Name.', 'Folder/Note']) expect(validate(name), name).toBeTypeOf('string');
		for (const name of ['Two word note', '\u65e5\u672c\u8a9e.md', '.hidden', 'Note.MD']) expect(validate(name), name).toBeUndefined();
	});

	it.each(['Nested/', 'Nested/.', 'Nested/..', 'Nested/Name.'])('Quick Switcher does not offer an uncreatable %j path', async name => {
		await command('quickSwitcher');
		const picker = mocks.pickers.at(-1);
		await picker.type(name);
		expect(picker.items.some((item: any) => item.createName)).toBe(false);
	});

	it('Quick Switcher preserves a valid nested creation name with internal spaces', async () => {
		await command('quickSwitcher'); const picker = mocks.pickers.at(-1);
		await picker.type('Planning notes/Two word note');
		const create = picker.items.find((item: any) => item.createName);
		expect(create.createName).toBe('Planning notes/Two word note');
		await picker.accept(create);
		expect(mocks.service.createNoteAtRelativePath).toHaveBeenCalledWith('Planning notes/Two word note', expect.any(Function));
		expect(mocks.open).toHaveBeenCalledOnce();
	});

	it('canceling the trash prompt retains the file', async () => {
		await command('vault.delete', { uri: vscode.Uri.file('/vault/Note.md') });
		expect(mocks.warning).toHaveBeenCalledOnce(); expect(mocks.service.moveToTrash).not.toHaveBeenCalled();
	});

	it.each([
		['README', 6], ['.gitignore', 10], ['My note.md', 7], ['archive.tar.gz', 11],
	])('Rename selects the editable name of %s', async (name, end) => {
		await command('vault.rename', { uri: vscode.Uri.file(`/vault/${name}`) });
		expect(mocks.input.mock.calls[0][0].valueSelection).toEqual([0, end]);
	});

	it('Rename selects a folder name in full even when it contains a period', async () => {
		mocks.service.statEntryInside.mockResolvedValueOnce({ isSymbolicLink: () => false, isDirectory: () => true });
		await command('vault.rename', { uri: vscode.Uri.file('/vault/Version 1.2') });
		expect(mocks.input.mock.calls[0][0].valueSelection).toEqual([0, 11]);
	});

	it.each(['newNote', 'newFolder', 'rename', 'delete'])('does not mutate after trust is revoked during the %s prompt', async name => {
		const prompt = deferred<string>();
		if (name === 'delete') mocks.warning.mockReturnValueOnce(prompt.promise);
		else mocks.input.mockReturnValueOnce(prompt.promise);
		const operation = command(`vault.${name}`, { uri: vscode.Uri.file('/vault/Note.md') });
		await vi.waitFor(() => expect(name === 'delete' ? mocks.warning : mocks.input).toHaveBeenCalled());
		mocks.trusted = false; prompt.resolve(name === 'delete' ? 'Move to Trash' : 'Changed'); await operation;
		expect(mocks.service.createNote).not.toHaveBeenCalled(); expect(mocks.service.createFolder).not.toHaveBeenCalled();
		expect(mocks.rewrite).not.toHaveBeenCalled(); expect(mocks.service.moveToTrash).not.toHaveBeenCalled();
	});
});

describe('knowledge commands during asynchronous index changes', () => {
	it.each([0, 1, 2])('uses the correct result-count label for %i matching documents', async count => {
		vi.useFakeTimers();
		records = Array.from({ length: count }, (_, index) => ({ ...records[0], path: `Note${index}.md`, basename: `Note${index}` }));
		await command('vaultSearch'); const picker = mocks.pickers.at(-1);
		await picker.type('needle'); await vi.advanceTimersByTimeAsync(180);
		expect(picker.busy).toBe(false);
		expect(picker.title).toBe(`Search Document Vault — ${count} matching ${count === 1 ? 'document' : 'documents'}`);
	});

	it('waits for a pending exclusion rebuild before displaying Quick Switcher results', async () => {
		const rebuild = deferred(); mocks.index.rebuild.mockImplementationOnce(async () => { await rebuild.promise; records = []; });
		updateExclusions(['Note.md']);
		const opening = command('quickSwitcher');
		await vi.waitFor(() => expect(mocks.index.rebuild).toHaveBeenCalledOnce());
		expect(mocks.pickers).toHaveLength(0);
		rebuild.resolve(); await opening;
		expect(mocks.pickers.at(-1).items).toEqual([]);
	});

	it('waits for an active index rebuild before offering Quick Switcher creation', async () => {
		const barrier = deferred<boolean>(); mocks.index.waitForRebuild.mockReturnValueOnce(barrier.promise);
		const opening = command('quickSwitcher');
		await Promise.resolve(); await Promise.resolve();
		expect(mocks.pickers).toHaveLength(0);
		barrier.resolve(true); await opening;
		expect(mocks.index.waitForRebuild).toHaveBeenCalled();
		expect(mocks.pickers.at(-1).items[0].record.path).toBe('Note.md');
	});

	it.each(['excluded', 'removed'])('does not open a note made %s while its disk check is pending', async change => {
		const authorization = deferred(); mocks.service.assertRegularFileInside.mockReturnValueOnce(authorization.promise);
		const opening = command('openIndexedPath', 'Note.md', 3);
		await vi.waitFor(() => expect(mocks.service.assertRegularFileInside).toHaveBeenCalledOnce());
		if (change === 'excluded') updateExclusions(['Note.md']); else records = [];
		authorization.resolve(); await opening;
		expect(mocks.open).not.toHaveBeenCalled();
	});

	it('closing Search while reads are pending never opens or publishes the canceled result', async () => {
		vi.useFakeTimers();
		const read = deferred<string>(); mocks.index.readText.mockReturnValueOnce(read.promise);
		await command('vaultSearch'); const picker = mocks.pickers.at(-1);
		await picker.type('needle'); await vi.advanceTimersByTimeAsync(180);
		expect(mocks.index.readText).toHaveBeenCalledOnce(); picker.hide(); read.resolve('needle');
		await vi.advanceTimersByTimeAsync(0);
		expect(picker.items).toEqual([]); expect(picker.visible).toBe(false); expect(mocks.open).not.toHaveBeenCalled();
	});

	it('an instruction row cannot open a note when Search is accepted with an empty query', async () => {
		await command('vaultSearch'); const picker = mocks.pickers.at(-1); await picker.accept();
		expect(mocks.open).not.toHaveBeenCalled(); expect(picker.visible).toBe(true);
	});
});
