import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({ folders: [] as Array<{ uri: unknown }> }));
vi.mock('vscode', async () => {
	const { fileURLToPath, pathToFileURL } = await import('node:url');
	const { join } = await import('node:path');
	class Uri {
		readonly scheme = 'file';
		constructor(readonly fsPath: string) {}
		get path() { return fileURLToPath(pathToFileURL(this.fsPath)); }
		toString() { return pathToFileURL(this.fsPath).href; }
		static file(path: string) { return new Uri(path); }
		static joinPath(base: Uri, ...paths: string[]) { return Uri.file(join(base.fsPath, ...paths)); }
	}
	return { Uri, workspace: { get workspaceFolders() { return mocks.folders; } } };
});

import * as vscode from 'vscode';
import { VaultService } from './VaultService';
import { validateVaultRelativeNotePath } from './vaultName';

let root: string;
let service: VaultService;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mdlp-note-creation-'));
	mocks.folders = [{ uri: vscode.Uri.file(root) }];
	const resolution = await VaultService.resolve();
	if (!resolution.available) throw new Error('Temporary vault did not resolve.');
	service = resolution.service;
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('note creation input and filesystem agreement', () => {
	it.each(['', '.', '..', 'Name ', 'Name.', 'CON', 'Folder/Name', 'Folder\\Name'])('rejects New Note input %j before creating a file', async name => {
		await expect(service.createNote(service.rootUri, name)).rejects.toThrow();
		expect(await readdir(root)).toEqual([]);
	});

	it.each(['Nested/', 'Nested/.', 'Nested/..', 'Nested/Name ', 'Nested/Name.', `Nested/${'é'.repeat(127)}`])(
		'rejects relative creation input %j in both validation and filesystem before creating folders', async name => {
			expect(validateVaultRelativeNotePath(name)).toBeTypeOf('string');
			await expect(service.createNoteAtRelativePath(name)).rejects.toThrow();
			expect(await readdir(root)).toEqual([]);
		},
	);

	it.each(['Two word note', '\u65e5\u672c\u8a9e note', '.hidden', 'Existing.markdown', 'Upper.MD'])('preserves valid New Note name %j and its extension', async name => {
		const target = await service.createNote(service.rootUri, name);
		expect(await readFile(target.fsPath, 'utf8')).toBe('');
		expect(service.relativePath(target)).toBe(/\.(?:md|markdown)$/i.test(name) ? name : `${name}.md`);
	});

	it('creates nested notes with spaces and Unicode using the same portable validation', async () => {
		const requested = './Planning notes/\u65e5\u672c\u8a9e/Two word note';
		expect(validateVaultRelativeNotePath(requested)).toBeUndefined();
		const target = await service.createNoteAtRelativePath(requested);
		expect(service.relativePath(target)).toBe('Planning notes/\u65e5\u672c\u8a9e/Two word note.md');
		expect(await readFile(target.fsPath, 'utf8')).toBe('');
	});

	it('accounts for the added extension when checking the filename byte limit', async () => {
		const longest = 'é'.repeat(126);
		const target = await service.createNote(service.rootUri, longest);
		expect(new TextEncoder().encode(service.relativePath(target))).toHaveLength(255);
		await expect(service.createNote(service.rootUri, `${longest}x`)).rejects.toThrow('255 bytes');
		expect(await readdir(root)).toEqual([`${longest}.md`]);
	});

	it('keeps an existing note unchanged when a duplicate is requested', async () => {
		const existing = join(root, 'Existing.md');
		await writeFile(existing, 'User content\n');
		await expect(service.createNote(service.rootUri, 'Existing')).rejects.toThrow();
		expect(await readFile(existing, 'utf8')).toBe('User content\n');
		expect(await readdir(root)).toEqual(['Existing.md']);
	});
});
