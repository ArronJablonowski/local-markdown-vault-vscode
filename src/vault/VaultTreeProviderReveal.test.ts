import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
	TreeItem: class { constructor(public resourceUri: unknown, public collapsibleState: unknown) {} },
	EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
	CancellationError: class CancellationError extends Error { constructor() { super('Canceled'); } },
	FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
	TreeItemCollapsibleState: { None: 0, Collapsed: 1 },
	Uri: { file: (path: string) => ({ fsPath: path, path, toString: () => `file://${path}` }) },
	l10n: { t: (value: string) => value },
}));
vi.mock('./VaultService', () => ({ VaultService: class {} }));

import * as vscode from 'vscode';
import { VaultEntry, VaultTreeProvider } from './VaultTreeProvider';

function setup() {
	const provider = new VaultTreeProvider();
	(provider as unknown as { resolution: unknown }).resolution = {
		available: true,
		service: { rootUri: vscode.Uri.file('/vault'), relativePath: (uri: vscode.Uri) => uri.path.slice('/vault/'.length) },
	};
	const entry = new VaultEntry(vscode.Uri.file('/vault/folder/note.md'), vscode.FileType.File, vscode.Uri.file('/vault/folder'), 'folder/note.md');
	return { provider, entry };
}

describe('passive reveal entry cancellation', () => {
	it('does not dispatch a canceled reveal', async () => {
		const { provider, entry } = setup(); const reveal = vi.fn(async () => {});
		await expect(provider.revealWhileCurrent(entry, () => false, reveal)).rejects.toThrow('Canceled');
		expect(reveal).not.toHaveBeenCalled(); expect(provider.getTreeItem(entry)).toBe(entry);
	});

	it('checks a fresh target after VS Code finishes waiting for its refresh', async () => {
		const { provider, entry } = setup(); let current = true;
		await expect(provider.revealWhileCurrent(entry, () => current, async clone => {
			expect(clone).not.toBe(entry); expect(clone.id).toBe(entry.id);
			await Promise.resolve(); current = false;
			provider.getTreeItem(clone);
		})).rejects.toThrow('Canceled');
		expect(provider.getTreeItem(entry)).toBe(entry);
	});

	it('propagates the guard through request-only parents', async () => {
		const { provider, entry } = setup(); let current = true;
		await provider.revealWhileCurrent(entry, () => current, async clone => {
			const parent = provider.getParent(clone)!;
			expect(parent.resourceUri?.path).toBe('/vault/folder');
			expect(provider.getTreeItem(parent)).toBe(parent);
			current = false;
			expect(() => provider.getParent(clone)).toThrow('Canceled');
			expect(() => provider.getTreeItem(parent)).toThrow('Canceled');
		});
	});

	it('removes guards from all retained request items after success or failure', async () => {
		for (const fail of [false, true]) {
			const { provider, entry } = setup(); let current = true;
			const retained: VaultEntry[] = [];
			const operation = provider.revealWhileCurrent(entry, () => current, async clone => {
				retained.push(clone, provider.getParent(clone) as VaultEntry);
				if (fail) throw new Error('Moved');
			});
			if (fail) await expect(operation).rejects.toThrow('Moved'); else await operation;
			current = false;
			for (const item of retained) expect(provider.getTreeItem(item)).toBe(item);
		}
	});

	it('does not apply a canceled request guard to ordinary tree items with the same path', async () => {
		const { provider, entry } = setup(); let current = true;
		await provider.revealWhileCurrent(entry, () => current, async clone => {
			current = false;
			expect(() => provider.getTreeItem(clone)).toThrow('Canceled');
			expect(provider.getTreeItem(entry)).toBe(entry);
			expect(() => provider.getParent(entry)).not.toThrow();
		});
	});
});
