import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { VaultService } from './VaultService';
import type { CaseRenameCoordinator } from './CaseRenameCoordinator';

const mocks = vi.hoisted(() => ({ documents: [] as any[], files: [] as any[] }));
vi.mock('vscode', () => ({
	workspace: {
		get textDocuments() { return mocks.documents; },
		getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
		findFiles: async () => mocks.files,
	},
	Uri: { parse: (value: string) => ({ fsPath: value.replace('file://', ''), toString: () => value }) },
	RelativePattern: class {},
	Position: class { constructor(readonly line: number, readonly character: number) {} },
	Range: class { constructor(readonly start: unknown, readonly end: unknown) {} },
	WorkspaceEdit: class { replace() {} renameFile() {} },
	FileType: { File: 1 },
}));
vi.mock('./VaultService', () => ({}));
vi.mock('./CaseRenameCoordinator', () => ({}));
import { LinkRewriteService, VaultTransactionConflictError } from './LinkRewriteService';

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
		statEntryInside: vi.fn(async () => snapshot),
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
	return { service, source, destination, temporary, document, vault, applyEdit };
}

beforeEach(() => { mocks.documents = []; mocks.files = []; });

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
