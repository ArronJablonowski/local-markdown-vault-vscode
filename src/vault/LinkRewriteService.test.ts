import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { VaultService } from './VaultService';
import type { CaseRenameCoordinator } from './CaseRenameCoordinator';

const mocks = vi.hoisted(() => ({ documents: [] as any[], files: [] as any[], settings: {} as Record<string, unknown> }));
vi.mock('vscode', () => ({
	workspace: {
		get textDocuments() { return mocks.documents; },
		getConfiguration: () => ({ get: (key: string, fallback: unknown) => mocks.settings[key] ?? fallback }),
		findFiles: async () => mocks.files,
	},
	Uri: {
		parse: (value: string) => ({ fsPath: value.replace('file://', ''), toString: () => value }),
		file: (value: string) => ({ fsPath: value, toString: () => `file://${value}` }),
	},
	RelativePattern: class {},
	Position: class { constructor(readonly line: number, readonly character: number) {} },
	Range: class { constructor(readonly start: unknown, readonly end: unknown) {} },
	WorkspaceEdit: class { replace() {} renameFile() {} },
	FileType: { File: 1 },
}));
vi.mock('./VaultService', () => ({}));
vi.mock('./CaseRenameCoordinator', () => ({}));
import { LinkRewriteService, VaultTransactionConflictError } from './LinkRewriteService';
import { vaultMoveHistoryFor } from './VaultMoveHistory';

function uri(path: string): vscode.Uri {
	return { fsPath: `/vault/${path}`, toString: () => `file:///vault/${path}` } as vscode.Uri;
}

function fixture() {
	const source = uri('Note.md');
	const destination = uri('note.md');
	const temporary = uri('.temporary.md');
	const snapshot = {
		dev: 1, ino: 2, birthtimeMs: 1, ctimeMs: 1, mtimeMs: 1, size: 16,
		isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false,
	};
	const document = {
		uri: source, version: 1, isDirty: true, text: '[self](Note.md)\n',
		getText() { return this.text; },
		positionAt(offset: number) { return { line: 0, character: offset }; },
		save: vi.fn(async () => { document.isDirty = false; return true; }),
	};
	mocks.documents = [document];
	mocks.files = [source];
	const vault = {
		rootUri: uri(''), assertWorkspaceCurrent: vi.fn(),
		relativePath: (value: vscode.Uri) => value.fsPath.slice('/vault/'.length),
		statEntryInside: vi.fn(async (value: vscode.Uri) => value.fsPath === '/vault'
			? { ...snapshot, ino: 1, isFile: () => false, isDirectory: () => true }
			: snapshot),
		aliasesEntry: vi.fn(async () => true),
		assertMutationSource: vi.fn(async () => {}),
		assertExistingInside: vi.fn(async () => {}),
		stageCaseOnlyRename: vi.fn(async () => temporary),
		hasExactEntry: vi.fn(async () => true),
		finishCaseRenameUndo: vi.fn(async () => {}),
	};
	const caseRenames = { register: vi.fn(), unregister: vi.fn(), finishForward: vi.fn(async () => true) };
	const applyEdit = vi.fn(async () => true);
	const service = new LinkRewriteService(vault as unknown as VaultService, {
		caseRenames: caseRenames as unknown as CaseRenameCoordinator, applyEdit,
	});
	return { service, source, destination, temporary, document, vault, applyEdit, snapshot, caseRenames };
}

beforeEach(() => { mocks.documents = []; mocks.files = []; mocks.settings = {}; });

describe('case-only rename document concurrency', () => {
	it('allows saving an unchanged dirty buffer before its case-only rename', async () => {
		const { service, source, destination, document, applyEdit } = fixture();
		await expect(service.renameOrMove(source, destination, false)).resolves.toBe(true);
		expect(document.save).toHaveBeenCalledOnce();
		expect(applyEdit).toHaveBeenCalledOnce();
	});

	it('rejects prepared link offsets if a save participant changes the source document', async () => {
		const { service, source, destination, document, vault, applyEdit } = fixture();
		document.save.mockImplementationOnce(async () => {
			document.text = `Formatting inserted a line\n${document.text}`;
			document.version++;
			document.isDirty = false;
			return true;
		});
		await expect(service.renameOrMove(source, destination, false)).rejects.toBeInstanceOf(VaultTransactionConflictError);
		expect(vault.stageCaseOnlyRename).not.toHaveBeenCalled();
		expect(applyEdit).not.toHaveBeenCalled();
		expect(document.text).toBe('Formatting inserted a line\n[self](Note.md)\n');
	});

	it('rolls back staging rather than committing offsets invalidated during its filesystem await', async () => {
		const { service, source, destination, temporary, document, vault, applyEdit } = fixture();
		vault.stageCaseOnlyRename.mockImplementationOnce(async () => {
			document.text = `Concurrent edit\n${document.text}`;
			document.version++;
			return temporary;
		});
		await expect(service.renameOrMove(source, destination, false)).rejects.toBeInstanceOf(VaultTransactionConflictError);
		expect(applyEdit).not.toHaveBeenCalled();
		expect(vault.finishCaseRenameUndo).toHaveBeenCalledWith(temporary, source);
		expect(document.text).toBe('Concurrent edit\n[self](Note.md)\n');
	});
});

describe('dedicated move replay preconditions', () => {
	it('classifies a disappearing case-only source at staging using both safe relative endpoints', async () => {
		const { source, destination, vault, applyEdit, caseRenames } = fixture();
		const originalStat = vault.statEntryInside.getMockImplementation()!;
		const service = new LinkRewriteService(vault as unknown as VaultService, {
			applyEdit, caseRenames: caseRenames as unknown as CaseRenameCoordinator,
			beforeCaseRenameStage: async () => {
				vault.statEntryInside.mockImplementation(async (value) => {
					if (value.fsPath === source.fsPath) throw Object.assign(new Error(`ENOENT: ${source.fsPath}`), { code: 'ENOENT' });
					return originalStat(value);
				});
			},
		});
		await expect(service.renameOrMove(source, destination, false)).rejects.toMatchObject({
			name: 'VaultTransactionConflictError', conflictKind: 'sourceOrDestination',
			affectedPath: 'Note.md', secondaryAffectedPath: 'note.md',
		});
		expect(applyEdit).not.toHaveBeenCalled();
		expect(vault.stageCaseOnlyRename).not.toHaveBeenCalled();
	});

	it('retains replay history when a native case-only event uses the validated original spelling', async () => {
		const { service, source, destination, temporary, vault, applyEdit } = fixture();
		const history = vaultMoveHistoryFor(vault as unknown as VaultService);
		applyEdit.mockImplementationOnce(async () => {
			history.observeRenames([{ oldUri: temporary, newUri: source }]);
			return true;
		});
		await expect(service.renameOrMove(source, destination, false)).resolves.toBe(true);
		expect(history.canUndo).toBe(true);
		await expect(history.undo()).resolves.toBe(true);
		expect(history.canRedo).toBe(true);
	});

	it('does not retain an expired drag gesture cancellation guard for later undo', async () => {
		const { source, destination, vault, applyEdit, caseRenames } = fixture();
		let gestureCurrent = true;
		const service = new LinkRewriteService(vault as unknown as VaultService, {
			applyEdit, caseRenames: caseRenames as unknown as CaseRenameCoordinator,
			isCurrent: () => gestureCurrent,
		});
		await service.renameOrMove(source, destination, false);
		gestureCurrent = false;
		await expect(vaultMoveHistoryFor(vault as unknown as VaultService).undo()).resolves.toBe(true);
		expect(applyEdit).toHaveBeenCalledTimes(2);
	});

	it('undo and redo use fresh planners and capture current endpoint identities', async () => {
		const { service, source, destination, vault, applyEdit } = fixture();
		const history = vaultMoveHistoryFor(vault as unknown as VaultService);
		await service.renameOrMove(source, destination, false);
		expect(history.canUndo).toBe(true);
		await expect(history.undo()).resolves.toBe(true);
		await expect(history.redo()).resolves.toBe(true);
		expect(applyEdit).toHaveBeenCalledTimes(3);
	});

	it.each(['updateLinksOnMove', 'exclude'])('rejects replay after %s changes without touching files', async (setting) => {
		const { service, source, destination, vault, applyEdit } = fixture();
		await service.renameOrMove(source, destination, false);
		mocks.settings[setting] = setting === 'exclude' ? ['private/**'] : false;
		await expect(vaultMoveHistoryFor(vault as unknown as VaultService).undo()).rejects.toThrow('settings changed');
		expect(applyEdit).toHaveBeenCalledOnce();
	});

	it('rechecks policy after case staging, rolling back a change during preparation', async () => {
		const { source, destination, temporary, vault, applyEdit, caseRenames } = fixture();
		const service = new LinkRewriteService(vault as unknown as VaultService, {
			applyEdit, caseRenames: caseRenames as unknown as CaseRenameCoordinator,
			beforeCaseRenameStage: async () => { mocks.settings.exclude = ['private/**']; },
		});
		await expect(service.renameOrMove(source, destination, false)).rejects.toThrow('settings changed');
		expect(applyEdit).not.toHaveBeenCalled();
		expect(vault.stageCaseOnlyRename).not.toHaveBeenCalled();
		expect(vault.finishCaseRenameUndo).not.toHaveBeenCalledWith(temporary, source);
	});

	it('rejects a replacement at the current moved-file endpoint', async () => {
		const { service, source, destination, vault, applyEdit, snapshot } = fixture();
		await service.renameOrMove(source, destination, false);
		const originalStat = vault.statEntryInside.getMockImplementation()!;
		vault.statEntryInside.mockImplementation(async (value) => value.fsPath === destination.fsPath
			? { ...snapshot, ino: 987 }
			: originalStat(value));
		await expect(vaultMoveHistoryFor(vault as unknown as VaultService).undo()).rejects.toThrow('endpoint was replaced');
		expect(applyEdit).toHaveBeenCalledOnce();
	});

	it('rejects an original parent replaced by an unrelated directory', async () => {
		const { service, source, destination, vault, applyEdit } = fixture();
		await service.renameOrMove(source, destination, false);
		const originalStat = vault.statEntryInside.getMockImplementation()!;
		vault.statEntryInside.mockImplementation(async (value) => {
			const current = await originalStat(value);
			return value.fsPath === '/vault' ? { ...current, ino: 987 } : current;
		});
		await expect(vaultMoveHistoryFor(vault as unknown as VaultService).undo()).rejects.toThrow('endpoint was replaced');
		expect(applyEdit).toHaveBeenCalledOnce();
	});

	it('rejects a case-only endpoint whose expected spelling no longer exists', async () => {
		const { service, source, destination, vault, applyEdit } = fixture();
		await service.renameOrMove(source, destination, false);
		vault.hasExactEntry.mockResolvedValue(false);
		await expect(vaultMoveHistoryFor(vault as unknown as VaultService).undo()).rejects.toThrow('endpoint was replaced');
		expect(applyEdit).toHaveBeenCalledOnce();
	});

	it('allows later content edits without treating mutable timestamps as a replacement', async () => {
		const { service, source, destination, vault, applyEdit, snapshot, document } = fixture();
		await service.renameOrMove(source, destination, false);
		snapshot.mtimeMs++;
		snapshot.ctimeMs++;
		snapshot.size += 20;
		document.text += 'Later user edits.\n';
		document.version++;
		await expect(vaultMoveHistoryFor(vault as unknown as VaultService).undo()).resolves.toBe(true);
		expect(document.getText()).toContain('Later user edits.');
		expect(applyEdit).toHaveBeenCalledTimes(2);
	});

	it('refuses a source replacement during final case staging', async () => {
		const { service, source, destination, temporary, vault, applyEdit, snapshot } = fixture();
		vault.stageCaseOnlyRename.mockImplementationOnce(async () => {
			const originalStat = vault.statEntryInside.getMockImplementation()!;
			vault.statEntryInside.mockImplementation(async (value) => value.fsPath === temporary.fsPath
				? { ...snapshot, ino: 987 }
				: originalStat(value));
			return temporary;
		});
		await expect(service.renameOrMove(source, destination, false)).rejects.toBeInstanceOf(VaultTransactionConflictError);
		expect(applyEdit).not.toHaveBeenCalled();
	});

	it('continues allowing a normal move when the filesystem cannot provide persistent identities', async () => {
		const { service, source, destination, vault, applyEdit, snapshot } = fixture();
		snapshot.dev = 0;
		snapshot.ino = 0;
		await expect(service.renameOrMove(source, destination, false)).resolves.toBe(true);
		expect(applyEdit).toHaveBeenCalledOnce();
		expect(vaultMoveHistoryFor(vault as unknown as VaultService).canUndo).toBe(false);
	});

	it('continues allowing a normal symlink-entry move without placing it in replay history', async () => {
		const { service, source, destination, vault, applyEdit, snapshot } = fixture();
		mocks.settings.updateLinksOnMove = false;
		snapshot.isSymbolicLink = () => true;
		const originalStat = vault.statEntryInside.getMockImplementation()!;
		vault.statEntryInside.mockImplementation(async (value) => {
			const current = await originalStat(value);
			return value.fsPath === '/vault' ? { ...current, isSymbolicLink: () => false } : current;
		});
		await expect(service.renameOrMove(source, destination, false)).resolves.toBe(true);
		expect(applyEdit).toHaveBeenCalledOnce();
		expect(vaultMoveHistoryFor(vault as unknown as VaultService).canUndo).toBe(false);
	});
});
