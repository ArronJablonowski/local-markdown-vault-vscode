import * as assert from 'assert';
import * as vscode from 'vscode';
import { chmod, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EXTENSION_ID = 'arronjablonowski.local-markdown-vault';

interface VaultServiceApi {
	rootUri: vscode.Uri;
	createFolder(parent: vscode.Uri, name: string): Promise<vscode.Uri>;
	createNote(parent: vscode.Uri, name: string): Promise<vscode.Uri>;
	createNoteAtRelativePath(path: string): Promise<vscode.Uri>;
	ensureDirectoryInside(uri: vscode.Uri): Promise<vscode.Uri>;
	createFileExclusive(parent: vscode.Uri, name: string, bytes: Uint8Array, maxBytes?: number): Promise<{
		uri: vscode.Uri;
		identity: { dev: number; ino: number; birthtimeMs: number; ctimeMs: number };
	}>;
	removeCreatedFile(file: {
		uri: vscode.Uri;
		identity: { dev: number; ino: number; birthtimeMs: number; ctimeMs: number };
	}): Promise<void>;
	countDescendants(folder: vscode.Uri, limit?: number): Promise<{ count: number; truncated: boolean }>;
	readDirectoryInside(folder: vscode.Uri): Promise<readonly [string, vscode.FileType][]>;
	assertExistingInside(uri: vscode.Uri): Promise<void>;
	assertRegularFileInside(uri: vscode.Uri): Promise<void>;
	statEntryInside(uri: vscode.Uri): Promise<{ isSymbolicLink(): boolean; isDirectory(): boolean }>;
	assertExpandableDirectory(uri: vscode.Uri): Promise<void>;
	readFileInside(uri: vscode.Uri, maxBytes: number): Promise<{ bytes: Uint8Array; mtimeMs: number; size: number }>;
	assertMutationSource(uri: vscode.Uri, symbolicLink: boolean): Promise<void>;
	moveToTrash(uri: vscode.Uri, symbolicLink: boolean): Promise<void>;
	resolveLocalImage(contextPath: string, authoredPath: string, maxBytes?: number): Promise<vscode.Uri>;
	resolveLinkedAttachment(authoredTarget: string): Promise<vscode.Uri>;
}

interface DevelopmentApi {
	getVaultService(): VaultServiceApi | undefined;
	getVaultIndexRecords(): readonly { path: string }[];
	cancelVaultIndexRebuild(): Promise<void>;
	getVaultTreePaths(parentPath?: string): Promise<readonly string[]>;
	renameOrMoveMany(requests: readonly {
		source: vscode.Uri;
		destination: vscode.Uri;
		isFolder: boolean;
	}[]): Promise<boolean>;
	renameOrMoveManyWithRejectedCommit(requests: readonly {
		source: vscode.Uri;
		destination: vscode.Uri;
		isFolder: boolean;
	}[]): Promise<boolean>;
	renameOrMoveManyWithStaleGeneration(requests: readonly {
		source: vscode.Uri;
		destination: vscode.Uri;
		isFolder: boolean;
	}[]): Promise<boolean>;
	renameOrMoveManyBeforeCheck(requests: readonly {
		source: vscode.Uri;
		destination: vscode.Uri;
		isFolder: boolean;
	}[], beforePreconditionCheck: () => Thenable<void>): Promise<boolean>;
	renameOrMoveManyBeforeCaseStage(requests: readonly {
		source: vscode.Uri;
		destination: vscode.Uri;
		isFolder: boolean;
	}[], beforeCaseRenameStage: () => Thenable<void>): Promise<boolean>;
}

suite('Document Vault filesystem transactions', () => {
	let api: DevelopmentApi;
	let service: VaultServiceApi;
	const fixtures: vscode.Uri[] = [];

	suiteSetup(async () => {
		const extension = vscode.extensions.getExtension<DevelopmentApi>(EXTENSION_ID);
		assert.ok(extension, `extension ${EXTENSION_ID} is not installed`);
		api = await extension.activate();
		assert.ok(api, 'development vault API is unavailable');
		const resolved = api.getVaultService();
		assert.ok(resolved, 'the integration workspace should be a local single-folder vault');
		service = resolved;
	});

	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		for (const fixture of fixtures.splice(0)) {
			try { await vscode.workspace.fs.delete(fixture, { recursive: true }); } catch { /* test already removed it */ }
		}
	});

	test('moves multiple notes and rewrites a dirty document atomically', async () => {
		const fixture = await makeFixture();
		const archive = await service.createFolder(fixture, 'Archive');
		const noteA = await service.createNote(fixture, 'A');
		const noteB = await service.createNote(fixture, 'B');
		const index = await service.createNote(fixture, 'Index');
		await vscode.workspace.fs.writeFile(noteA, bytes('# A\n'));
		await vscode.workspace.fs.writeFile(noteB, bytes('# B\n'));
		await vscode.workspace.fs.writeFile(index, bytes('[[A]] and [B](B.md)\n'));

		const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(index));
		await editor.edit((builder) => builder.insert(new vscode.Position(1, 0), 'Unsaved user text.\n'));
		assert.strictEqual(editor.document.isDirty, true);

		const movedA = vscode.Uri.joinPath(archive, 'A.md');
		const movedB = vscode.Uri.joinPath(archive, 'B.md');
		const applied = await api.renameOrMoveMany([
			{ source: noteA, destination: movedA, isFolder: false },
			{ source: noteB, destination: movedB, isFolder: false },
		]);
		assert.strictEqual(applied, true);
		await vscode.workspace.fs.stat(movedA);
		await vscode.workspace.fs.stat(movedB);
		await assertMissing(noteA);
		await assertMissing(noteB);
		assert.match(editor.document.getText(), /\[\[A\]\] and \[B\]\(Archive\/B\.md\)/);
		assert.ok(editor.document.getText().includes('Unsaved user text.'));
		assert.strictEqual(editor.document.isDirty, true, 'the transaction saved over the dirty document');

	});

	test('counts descendants and rejects a symlink escape', async () => {
		const fixture = await makeFixture();
		const nested = await service.createFolder(fixture, 'Nested');
		await service.createNote(nested, 'One');
		await service.createNote(nested, 'Two');
		assert.deepStrictEqual(await service.countDescendants(fixture), { count: 3, truncated: false });

		const outside = await mkdtemp(join(tmpdir(), 'mdlp-vault-test-'));
		try {
			const secret = join(outside, 'outside.md');
			await writeFile(secret, '# outside\n');
			const link = vscode.Uri.joinPath(fixture, 'escape.md');
			await symlink(secret, link.fsPath);
			await assert.rejects(service.assertExistingInside(link), /outside the Document Vault/);
			await assert.rejects(service.assertRegularFileInside(link), /outside the Document Vault/);
			await assert.rejects(service.readFileInside(link, 1024), /outside the Document Vault/);
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});

	test('lists ordinary entries without following symbolic-link children', async () => {
		const fixture = await makeFixture();
		await service.createNote(fixture, 'Inside');
		const outside = await mkdtemp(join(tmpdir(), 'mdlp-directory-read-test-'));
		try {
			const secret = join(outside, 'outside.md');
			await writeFile(secret, '# outside\n');
			const link = vscode.Uri.joinPath(fixture, 'outside-link.md');
			await symlink(secret, link.fsPath);
			const entries = new Map(await service.readDirectoryInside(fixture));
			assert.strictEqual(entries.get('Inside.md'), vscode.FileType.File);
			assert.strictEqual(entries.get('outside-link.md'), vscode.FileType.SymbolicLink);
			await assert.rejects(service.readDirectoryInside(link), /not an expandable directory|outside the Document Vault/);
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});

	test('creates nested note directories segment by segment and rejects a symlink segment', async () => {
		const fixture = await makeFixture();
		const fixtureRelative = fixture.fsPath.slice(service.rootUri.fsPath.length + 1).replace(/\\/g, '/');
		const note = await service.createNoteAtRelativePath(`${fixtureRelative}/Nested/Deep/New note`);
		assert.strictEqual(note.fsPath, vscode.Uri.joinPath(fixture, 'Nested', 'Deep', 'New note.md').fsPath);
		await vscode.workspace.fs.stat(note);

		const outside = await mkdtemp(join(tmpdir(), 'mdlp-create-note-test-'));
		try {
			await symlink(outside, vscode.Uri.joinPath(fixture, 'Linked').fsPath);
			await assert.rejects(
				service.createNoteAtRelativePath(`${fixtureRelative}/Linked/Escape`),
				/not a regular directory|outside the Document Vault/,
			);
			await assertMissing(vscode.Uri.file(join(outside, 'Escape.md')));
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});

	test('sorts created dates by birth time rather than later metadata changes', async () => {
		const fixture = await makeFixture();
		const older = await service.createNote(fixture, 'Older');
		await new Promise((resolve) => setTimeout(resolve, 30));
		const newer = await service.createNote(fixture, 'Newer');
		await new Promise((resolve) => setTimeout(resolve, 30));
		await vscode.workspace.fs.writeFile(older, bytes('# changed after both files were created\n'));
		const fixtureRelative = fixture.fsPath.slice(service.rootUri.fsPath.length + 1).replace(/\\/g, '/');
		const configuration = vscode.workspace.getConfiguration('mdLivePreview.vault', service.rootUri);
		const previous = configuration.inspect<string>('sortOrder')?.workspaceValue;
		try {
			await configuration.update('sortOrder', 'createdNewest', vscode.ConfigurationTarget.Workspace);
			assert.deepStrictEqual(await api.getVaultTreePaths(fixtureRelative), [
				`${fixtureRelative}/Newer.md`,
				`${fixtureRelative}/Older.md`,
			]);
		} finally {
			await configuration.update('sortOrder', previous, vscode.ConfigurationTarget.Workspace);
		}
		await vscode.workspace.fs.stat(newer);
	});

	test('authorizes only vault-confined mutation sources without following a symlink leaf', async () => {
		const fixture = await makeFixture();
		const outside = await mkdtemp(join(tmpdir(), 'mdlp-trash-test-'));
		try {
			const secret = join(outside, 'outside.md');
			await writeFile(secret, '# outside\n');
			const link = vscode.Uri.joinPath(fixture, 'outside-link.md');
			await symlink(secret, link.fsPath);
			const linkedDirectory = vscode.Uri.joinPath(fixture, 'outside-directory');
			await symlink(outside, linkedDirectory.fsPath);
			const forgedDescendant = vscode.Uri.joinPath(linkedDirectory, 'outside.md');

			await service.assertMutationSource(link, true);
			await assert.rejects(service.assertMutationSource(link, false), /outside the Document Vault/);
			assert.strictEqual((await service.statEntryInside(linkedDirectory)).isSymbolicLink(), true);
			await assert.rejects(service.assertExpandableDirectory(linkedDirectory), /not an expandable directory/);
			await assert.rejects(service.countDescendants(linkedDirectory), /not an expandable directory/);
			await assert.rejects(service.assertMutationSource(forgedDescendant, true), /outside the Document Vault/);
			await assert.rejects(service.assertMutationSource(vscode.Uri.file(secret), true), /outside the Document Vault/);
			await assert.rejects(service.assertMutationSource(service.rootUri, false), /outside the Document Vault/);
			await assert.rejects(service.moveToTrash(forgedDescendant, false), /outside the Document Vault/);
			await assert.rejects(service.moveToTrash(vscode.Uri.file(secret), false), /outside the Document Vault/);
			await assert.rejects(service.moveToTrash(service.rootUri, false), /outside the Document Vault/);
			await vscode.workspace.fs.stat(vscode.Uri.file(secret));
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});

	test('opens ordinary vault files but not symlink targets outside the vault', async () => {
		const fixture = await makeFixture();
		const inside = vscode.Uri.joinPath(fixture, 'inside.txt');
		await vscode.workspace.fs.writeFile(inside, bytes('inside\n'));
		await vscode.commands.executeCommand('mdLivePreview.vault.open', { uri: inside });
		assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), inside.toString());

		const outside = await mkdtemp(join(tmpdir(), 'mdlp-open-test-'));
		try {
			const secret = join(outside, 'outside.txt');
			await writeFile(secret, 'outside\n');
			const link = vscode.Uri.joinPath(fixture, 'outside-link.txt');
			await symlink(secret, link.fsPath);
			await vscode.commands.executeCommand('mdLivePreview.vault.open', { uri: link });
			await new Promise((resolve) => setTimeout(resolve, 100));
			assert.strictEqual(
				vscode.window.activeTextEditor?.document.uri.toString(),
				inside.toString(),
				'opening an outside-vault symlink replaced the active editor',
			);
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});

	test('resolves bounded raster images and rejects traversal and symlink escapes', async () => {
		const fixture = await makeFixture();
		const note = await service.createNote(fixture, 'Current');
		const assets = await service.createFolder(fixture, 'Assets');
		const image = vscode.Uri.joinPath(assets, 'picture.png');
		await vscode.workspace.fs.writeFile(image, Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
		await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(assets, 'active.svg'), bytes('<svg><script>alert(1)</script></svg>'));
		const fixtureRelative = fixture.fsPath.slice(service.rootUri.fsPath.length + 1).replace(/\\/g, '/');
		const resolved = await service.resolveLocalImage(`${fixtureRelative}/Current.md`, 'Assets/picture.png');
		assert.strictEqual(resolved.fsPath, image.fsPath);
		await assert.rejects(service.resolveLocalImage(`${fixtureRelative}/Current.md`, '../../../../etc/passwd'), /outside/);
		await assert.rejects(service.resolveLocalImage(`${fixtureRelative}/Current.md`, '%2e%2e/%2e%2e/%2e%2e/outside.png'), /outside/);
		await assert.rejects(service.resolveLocalImage(`${fixtureRelative}/Current.md`, 'Assets/picture.png', 1), /size limit/);
		await assert.rejects(service.resolveLocalImage(`${fixtureRelative}/Current.md`, 'Assets/active.svg'), /not supported|outside/);

		const outside = await mkdtemp(join(tmpdir(), 'mdlp-image-test-'));
		try {
			const secret = join(outside, 'outside.png');
			await writeFile(secret, 'not really an image');
			const link = vscode.Uri.joinPath(assets, 'escape.png');
			await symlink(secret, link.fsPath);
			await assert.rejects(service.resolveLocalImage(`${fixtureRelative}/Current.md`, 'Assets/escape.png'), /outside the Document Vault/);
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
		await vscode.workspace.fs.stat(note);
	});

	test('creates attachment bytes through the vault boundary and never removes a replacement', async () => {
		const fixture = await makeFixture();
		const assets = await service.createFolder(fixture, 'Assets');
		const originalBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
		const created = await service.createFileExclusive(assets, 'pasted.png', originalBytes);
		assertBytesEqual(await vscode.workspace.fs.readFile(created.uri), originalBytes, 'secure write changed attachment bytes');
		const securelyRead = await service.readFileInside(created.uri, originalBytes.byteLength);
		assertBytesEqual(securelyRead.bytes, originalBytes, 'secure read changed attachment bytes');
		assert.strictEqual(securelyRead.size, originalBytes.byteLength);
		await assert.rejects(service.readFileInside(created.uri, originalBytes.byteLength - 1), /size limit/);
		await assert.rejects(
			service.createFileExclusive(assets, 'pasted.png', originalBytes),
			(error: NodeJS.ErrnoException) => error.code === 'EEXIST',
		);
		await assert.rejects(service.createFileExclusive(assets, 'large.png', new Uint8Array(9), 8), /size limit/);

		await vscode.workspace.fs.delete(created.uri);
		const replacementBytes = bytes('replacement that belongs to another writer');
		await vscode.workspace.fs.writeFile(created.uri, replacementBytes);
		await service.removeCreatedFile(created);
		assertBytesEqual(
			await vscode.workspace.fs.readFile(created.uri),
			replacementBytes,
			'cleanup removed or changed a replacement file',
		);
	});

	test('rejects attachment creation through a symlinked directory', async () => {
		const fixture = await makeFixture();
		const outside = await mkdtemp(join(tmpdir(), 'mdlp-paste-image-test-'));
		try {
			const linkedAssets = vscode.Uri.joinPath(fixture, 'LinkedAssets');
			await symlink(outside, linkedAssets.fsPath);
			await assert.rejects(
				service.createFileExclusive(linkedAssets, 'escape.png', Uint8Array.from([137, 80, 78, 71])),
				/outside the Document Vault/,
			);
			await assertMissing(vscode.Uri.file(join(outside, 'escape.png')));
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});

	test('opens only unique, vault-confined PDF and audio wikilink attachments', async () => {
		const fixture = await makeFixture();
		const references = await service.createFolder(fixture, 'References');
		const audio = await service.createFolder(fixture, 'Audio');
		const paper = vscode.Uri.joinPath(references, 'Paper.pdf');
		const recording = vscode.Uri.joinPath(audio, 'Recording.mp3');
		await vscode.workspace.fs.writeFile(paper, bytes('%PDF-1.4'));
		await vscode.workspace.fs.writeFile(recording, bytes('ID3'));
		const fixtureRelative = fixture.fsPath.slice(service.rootUri.fsPath.length + 1).replace(/\\/g, '/');

		assert.strictEqual((await service.resolveLinkedAttachment(`${fixtureRelative}/References/Paper.pdf`)).fsPath, paper.fsPath);
		assert.strictEqual((await service.resolveLinkedAttachment('Recording.mp3')).fsPath, recording.fsPath);
		await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(references, 'Recording.mp3'), bytes('ID3'));
		await assert.rejects(service.resolveLinkedAttachment('Recording.mp3'), /ambiguous/);
		await assert.rejects(service.resolveLinkedAttachment('../../outside.pdf'), /not supported/);
		await assert.rejects(service.resolveLinkedAttachment('%2e%2e/outside.pdf'), /not supported/);
		await assert.rejects(service.resolveLinkedAttachment('tool.exe'), /not supported/);

		const outside = await mkdtemp(join(tmpdir(), 'mdlp-attachment-test-'));
		try {
			const secret = join(outside, 'outside.pdf');
			await writeFile(secret, '%PDF-1.4');
			const escapeFolder = vscode.Uri.joinPath(fixture, 'Escape');
			await symlink(outside, escapeFolder.fsPath);
			await assert.rejects(
				service.resolveLinkedAttachment(`${fixtureRelative}/Escape/outside.pdf`),
				/outside the Document Vault/,
			);
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});

	test('aborts every move when any destination collides', async () => {
		const fixture = await makeFixture();
		const archive = await service.createFolder(fixture, 'Archive');
		const noteA = await service.createNote(fixture, 'A');
		const noteB = await service.createNote(fixture, 'B');
		const occupied = await service.createNote(archive, 'B');
		await assert.rejects(api.renameOrMoveMany([
			{ source: noteA, destination: vscode.Uri.joinPath(archive, 'A.md'), isFolder: false },
			{ source: noteB, destination: occupied, isFolder: false },
		]), /destination/);
		await vscode.workspace.fs.stat(noteA);
		await vscode.workspace.fs.stat(noteB);
		await assertMissing(vscode.Uri.joinPath(archive, 'A.md'));
	});

	test('moves Unicode and emoji filenames without changing note contents', async () => {
		const fixture = await makeFixture();
		const archive = await service.createFolder(fixture, 'Archive');
		const source = await service.createNote(fixture, 'Cafe\u0301 😀');
		const index = await service.createNote(fixture, 'Index');
		const noteBytes = bytes('# Cafe\u0301 😀\n\nUnicode content: 日本語, naïve, 🧭.\n');
		await vscode.workspace.fs.writeFile(source, noteBytes);
		await vscode.workspace.fs.writeFile(index, bytes('[target](<Cafe\u0301 😀.md>)\n'));

		const destination = vscode.Uri.joinPath(archive, '研究 🧭.md');
		assert.strictEqual(await api.renameOrMoveMany([
			{ source, destination, isFolder: false },
		]), true);
		assertBytesEqual(await vscode.workspace.fs.readFile(destination), noteBytes, 'Unicode move changed note bytes');
		await assertMissing(source);
		const indexDocument = await vscode.workspace.openTextDocument(index);
		assert.strictEqual(indexDocument.getText(), '[target](<Archive/研究 🧭.md>)\n');
	});

	test('rewrites a basename wikilink when a nested .markdown note is renamed', async () => {
		const fixture = await makeFixture();
		const notes = await service.createFolder(fixture, 'Notes');
		const archive = await service.createFolder(fixture, 'Archive');
		const source = await service.createNote(notes, 'Old.markdown');
		const index = await service.createNote(fixture, 'Index');
		await vscode.workspace.fs.writeFile(source, bytes('# Old markdown note\n'));
		await vscode.workspace.fs.writeFile(index, bytes('[[Old]]\n'));

		const destination = vscode.Uri.joinPath(archive, 'New.markdown');
		assert.strictEqual(await api.renameOrMoveMany([
			{ source, destination, isFolder: false },
		]), true);
		const indexDocument = await vscode.workspace.openTextDocument(index);
		assert.strictEqual(indexDocument.getText(), '[[New]]\n');
		assert.strictEqual(new TextDecoder().decode(await vscode.workspace.fs.readFile(destination)), '# Old markdown note\n');
	});

	test('rolls back a staged case-only rename when the workspace edit is rejected', async () => {
		const fixture = await makeFixture();
		const source = await service.createNote(fixture, 'RollbackCase');
		const index = await service.createNote(fixture, 'Index');
		const noteBytes = bytes('# rollback\n');
		await vscode.workspace.fs.writeFile(source, noteBytes);
		await vscode.workspace.fs.writeFile(index, bytes('[target](RollbackCase.md)\n'));

		const destination = vscode.Uri.joinPath(fixture, 'rollbackcase.md');
		assert.strictEqual(await api.renameOrMoveManyWithRejectedCommit([
			{ source, destination, isFolder: false },
		]), false);
		assertBytesEqual(await vscode.workspace.fs.readFile(source), noteBytes, 'rollback changed note bytes');
		assert.strictEqual(
			new TextDecoder().decode(await vscode.workspace.fs.readFile(index)),
			'[target](RollbackCase.md)\n',
		);
		const names = (await vscode.workspace.fs.readDirectory(fixture)).map(([name]) => name);
		assert.ok(names.includes('RollbackCase.md'), `original casing was not restored: ${names.join(', ')}`);
		assert.ok(!names.includes('rollbackcase.md'), `rejected destination casing remained: ${names.join(', ')}`);
		assert.ok(!names.some((name) => name.startsWith('.mdlp-case-rename-')), `temporary rename leaked: ${names.join(', ')}`);
	});

	test('rejects a stale vault generation before committing files or link edits', async () => {
		const fixture = await makeFixture();
		const archive = await service.createFolder(fixture, 'Archive');
		const source = await service.createNote(fixture, 'Stale');
		const index = await service.createNote(fixture, 'Index');
		await vscode.workspace.fs.writeFile(source, bytes('# Stale\n'));
		await vscode.workspace.fs.writeFile(index, bytes('[target](Stale.md)\n'));
		const destination = vscode.Uri.joinPath(archive, 'Stale.md');

		await assert.rejects(api.renameOrMoveManyWithStaleGeneration([
			{ source, destination, isFolder: false },
		]), /Document Vault changed before the move could be applied/);
		await vscode.workspace.fs.stat(source);
		await assertMissing(destination);
		assert.strictEqual(
			new TextDecoder().decode(await vscode.workspace.fs.readFile(index)),
			'[target](Stale.md)\n',
		);
	});

	test('aborts without moving when a closed linked note changes after planning', async () => {
		const fixture = await makeFixture();
		const archive = await service.createFolder(fixture, 'Archive');
		const source = await service.createNote(fixture, 'Concurrent');
		const index = await service.createNote(fixture, 'Index');
		await vscode.workspace.fs.writeFile(source, bytes('# Concurrent\n'));
		await vscode.workspace.fs.writeFile(index, bytes('[target](Concurrent.md)\n'));
		const externalText = '[target](Concurrent.md)\nExternal change that must win.\n';

		const destination = vscode.Uri.joinPath(archive, 'Concurrent.md');
		const affectedPath = index.fsPath.slice(service.rootUri.fsPath.length + 1).replace(/\\/g, '/');
		await assert.rejects(api.renameOrMoveManyBeforeCheck([
			{ source, destination, isFolder: false },
		], async () => {
			await vscode.workspace.fs.writeFile(index, bytes(externalText));
		}), (error: unknown) => error instanceof Error &&
			/linked document changed/i.test(error.message) &&
			(error as Error & { affectedPath?: string }).affectedPath === affectedPath);
		await vscode.workspace.fs.stat(source);
		await assertMissing(destination);
		assert.strictEqual(new TextDecoder().decode(await vscode.workspace.fs.readFile(index)), externalText);
	});

	test('reports the vault-relative source when it changes after move planning', async () => {
		const fixture = await makeFixture();
		const archive = await service.createFolder(fixture, 'Archive');
		const source = await service.createNote(fixture, 'Changed Source');
		await vscode.workspace.fs.writeFile(source, bytes('# original\n'));
		const destination = vscode.Uri.joinPath(archive, 'Changed Source.md');
		const affectedPath = source.fsPath.slice(service.rootUri.fsPath.length + 1).replace(/\\/g, '/');
		const externalText = '# externally changed source\n';

		await assert.rejects(api.renameOrMoveManyBeforeCheck([
			{ source, destination, isFolder: false },
		], async () => {
			await vscode.workspace.fs.writeFile(source, bytes(externalText));
		}), (error: unknown) => error instanceof Error &&
			/source changed/i.test(error.message) &&
			(error as Error & { conflictKind?: string }).conflictKind === 'source' &&
			(error as Error & { affectedPath?: string }).affectedPath === affectedPath);
		assert.strictEqual(new TextDecoder().decode(await vscode.workspace.fs.readFile(source)), externalText);
		await assertMissing(destination);
	});

	test('reports the vault-relative destination when it appears after move planning', async () => {
		const fixture = await makeFixture();
		const archive = await service.createFolder(fixture, 'Archive');
		const source = await service.createNote(fixture, 'Destination Race');
		await vscode.workspace.fs.writeFile(source, bytes('# source\n'));
		const destination = vscode.Uri.joinPath(archive, 'Destination Race.md');
		const affectedPath = destination.fsPath.slice(service.rootUri.fsPath.length + 1).replace(/\\/g, '/');
		const destinationText = '# externally created destination\n';

		await assert.rejects(api.renameOrMoveManyBeforeCheck([
			{ source, destination, isFolder: false },
		], async () => {
			await vscode.workspace.fs.writeFile(destination, bytes(destinationText));
		}), (error: unknown) => error instanceof Error &&
			/destination changed/i.test(error.message) &&
			(error as Error & { conflictKind?: string }).conflictKind === 'destination' &&
			(error as Error & { affectedPath?: string }).affectedPath === affectedPath);
		await vscode.workspace.fs.stat(source);
		assert.strictEqual(new TextDecoder().decode(await vscode.workspace.fs.readFile(destination)), destinationText);
	});

	test('reports both relative endpoints when a case-only source changes at the staging boundary', async () => {
		const fixture = await makeFixture();
		const source = await service.createNote(fixture, 'Case Race');
		const sourceText = '# source moved externally\n';
		await vscode.workspace.fs.writeFile(source, bytes(sourceText));
		const destination = vscode.Uri.joinPath(fixture, 'case race.md');
		const external = vscode.Uri.joinPath(fixture, 'Case Race.external.md');
		const sourcePath = source.fsPath.slice(service.rootUri.fsPath.length + 1).replace(/\\/g, '/');
		const destinationPath = destination.fsPath.slice(service.rootUri.fsPath.length + 1).replace(/\\/g, '/');

		await assert.rejects(api.renameOrMoveManyBeforeCaseStage([
			{ source, destination, isFolder: false },
		], async () => {
			await vscode.workspace.fs.rename(source, external, { overwrite: false });
		}), (error: unknown) => error instanceof Error &&
			/source or destination changed/i.test(error.message) &&
			(error as Error & { conflictKind?: string }).conflictKind === 'sourceOrDestination' &&
			(error as Error & { affectedPath?: string }).affectedPath === sourcePath &&
			(error as Error & { secondaryAffectedPath?: string }).secondaryAffectedPath === destinationPath);
		assert.strictEqual(new TextDecoder().decode(await vscode.workspace.fs.readFile(external)), sourceText);
		await assertMissing(source);
		await assertMissing(destination);
	});

	test('moves a read-only note without changing its bytes or permissions', async function () {
		if (process.platform === 'win32') this.skip();
		const fixture = await makeFixture();
		const archive = await service.createFolder(fixture, 'Archive');
		const source = await service.createNote(fixture, 'Read Only');
		const index = await service.createNote(fixture, 'Index');
		const noteBytes = bytes('# Read Only\n\nThe source file is intentionally immutable.\n');
		await vscode.workspace.fs.writeFile(source, noteBytes);
		await vscode.workspace.fs.writeFile(index, bytes('[target](<Read Only.md>)\n'));
		await chmod(source.fsPath, 0o400);

		const destination = vscode.Uri.joinPath(archive, 'Read Only.md');
		try {
			assert.strictEqual(await api.renameOrMoveMany([
				{ source, destination, isFolder: false },
			]), true);
			assertBytesEqual(await vscode.workspace.fs.readFile(destination), noteBytes, 'read-only move changed note bytes');
			assert.strictEqual((await stat(destination.fsPath)).mode & 0o222, 0, 'move made the note writable');
			const indexDocument = await vscode.workspace.openTextDocument(index);
			assert.strictEqual(indexDocument.getText(), '[target](<Archive/Read Only.md>)\n');
		} finally {
			await chmod(destination.fsPath, 0o600).catch(() => undefined);
			await chmod(source.fsPath, 0o600).catch(() => undefined);
		}
	});

	test('rebuilds disposable metadata without changing vault files or Obsidian settings', async () => {
		const fixture = await makeFixture();
		const obsidian = await service.createFolder(fixture, '.obsidian');
		const note = await service.createNote(fixture, 'Plain note');
		const attachment = vscode.Uri.joinPath(fixture, 'diagram.bin');
		const appSettings = vscode.Uri.joinPath(obsidian, 'app.json');
		const noteBytes = bytes('---\naliases: [Lossless]\n---\n# Plain note\n![[diagram.bin]]\n');
		const attachmentBytes = Uint8Array.from([0, 255, 16, 32, 13, 10, 127]);
		const settingsBytes = bytes('{"livePreview":true,"legacyEditor":false}\n');
		await vscode.workspace.fs.writeFile(note, noteBytes);
		await vscode.workspace.fs.writeFile(attachment, attachmentBytes);
		await vscode.workspace.fs.writeFile(appSettings, settingsBytes);

		const relativeNote = service.rootUri.toString() === fixture.toString()
			? 'Plain note.md'
			: `${fixture.fsPath.slice(service.rootUri.fsPath.length + 1).replace(/\\/g, '/')}/Plain note.md`;
		await vscode.commands.executeCommand('mdLivePreview.vault.rebuildIndex');
		assert.ok(api.getVaultIndexRecords().some((record) => record.path === relativeNote), 'rebuilt index omitted the note');
		assertBytesEqual(await vscode.workspace.fs.readFile(note), noteBytes, 'metadata rebuild changed Markdown bytes');
		assertBytesEqual(await vscode.workspace.fs.readFile(attachment), attachmentBytes, 'metadata rebuild changed attachment bytes');
		assertBytesEqual(await vscode.workspace.fs.readFile(appSettings), settingsBytes, 'metadata rebuild changed .obsidian settings');
		assert.deepStrictEqual(
			(await vscode.workspace.fs.readDirectory(fixture)).map(([name]) => name).sort(),
			['.obsidian', 'Plain note.md', 'diagram.bin'],
			'metadata rebuild created an extension-owned folder in the vault',
		);
	});

	test('cancels a metadata rebuild without exposing a partial index or changing vault files', async () => {
		const fixture = await makeFixture();
		const note = await service.createNote(fixture, 'Cancel rebuild');
		const noteBytes = bytes('# Cancel rebuild\nThe source remains authoritative.\n');
		await vscode.workspace.fs.writeFile(note, noteBytes);
		await waitForCondition(
			() => api.getVaultIndexRecords().some((record) => record.path.endsWith('/Cancel rebuild.md')),
			'fixture note did not enter the index before cancellation',
		);

		await api.cancelVaultIndexRebuild();
		assert.deepStrictEqual(api.getVaultIndexRecords(), [], 'canceled rebuild exposed partial metadata');
		assertBytesEqual(await vscode.workspace.fs.readFile(note), noteBytes, 'canceled rebuild changed Markdown bytes');

		await vscode.commands.executeCommand('mdLivePreview.vault.rebuildIndex');
		await waitForCondition(
			() => api.getVaultIndexRecords().some((record) => record.path.endsWith('/Cancel rebuild.md')),
			'index did not recover after a canceled rebuild',
		);
	});

	test('applies a case-only file rename with link updates', async function () {
		if (process.platform === 'linux') this.skip();
		const fixture = await makeFixture();
		const source = await service.createNote(fixture, 'CaseName');
		const index = await service.createNote(fixture, 'Index');
		await vscode.workspace.fs.writeFile(source, bytes('# Case name\n'));
		await vscode.workspace.fs.writeFile(index, bytes('[target](CaseName.md)\n'));
		const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(index));
		await editor.edit((builder) => builder.insert(new vscode.Position(1, 0), 'Unsaved user text.\n'));
		assert.strictEqual(editor.document.isDirty, true);

		const destination = vscode.Uri.joinPath(fixture, 'casename.md');
		assert.strictEqual(await api.renameOrMoveMany([
			{ source, destination, isFolder: false },
		]), true);
		const names = (await vscode.workspace.fs.readDirectory(fixture)).map(([name]) => name);
		assert.ok(names.includes('casename.md'), `destination casing was not applied: ${names.join(', ')}`);
		assert.ok(!names.includes('CaseName.md'), `source casing remained after rename: ${names.join(', ')}`);
		assert.strictEqual(new TextDecoder().decode(await vscode.workspace.fs.readFile(destination)), '# Case name\n');
		const indexDocument = editor.document;
		assert.strictEqual(indexDocument.getText(), '[target](casename.md)\nUnsaved user text.\n');
		assert.strictEqual(indexDocument.isDirty, true);
		const destinationRelative = vscode.workspace.asRelativePath(destination, false).replace(/\\/g, '/');
		const originalRelative = destinationRelative.replace(/casename\.md$/, 'CaseName.md');
		await waitForCondition(() => {
			const paths = api.getVaultIndexRecords().map((record) => record.path);
			return paths.includes(destinationRelative) && !paths.includes(originalRelative);
		}, 'case-only index records did not converge to the exact destination spelling');

	});

	test('preserves an open dirty note while enforcing exact case-only filename casing', async function () {
		if (process.platform === 'linux') this.skip();
		const fixture = await makeFixture();
		const source = await service.createNote(fixture, 'OpenCaseName');
		const index = await service.createNote(fixture, 'OpenCaseIndex');
		await vscode.workspace.fs.writeFile(source, bytes('# Open case\n'));
		await vscode.workspace.fs.writeFile(index, bytes('[[OpenCaseName]]\n'));
		const document = await vscode.workspace.openTextDocument(source);
		const editor = await vscode.window.showTextDocument(document);
		await editor.edit((builder) => builder.insert(new vscode.Position(1, 0), 'Unsaved source text.\n'));
		const destination = vscode.Uri.joinPath(fixture, 'opencasename.md');
		assert.strictEqual(await api.renameOrMoveMany([{ source, destination, isFolder: false }]), true);
		const names = (await vscode.workspace.fs.readDirectory(fixture)).map(([name]) => name);
		assert.ok(names.includes('opencasename.md'), `destination casing was not applied: ${names.join(', ')}`);
		assert.ok(!names.includes('OpenCaseName.md'), `source casing remained after rename: ${names.join(', ')}`);
		assert.ok(!names.some((name) => name.startsWith('.mdlp-case-rename-')), `temporary case-rename file remained: ${names.join(', ')}`);
		assert.strictEqual(document.getText(), '# Open case\nUnsaved source text.\n');
		assert.ok(!document.uri.path.includes('.mdlp-case-rename-'), 'open document was left on a temporary URI');
		assert.strictEqual((await vscode.workspace.openTextDocument(index)).getText(), '[[opencasename]]\n');
		assert.strictEqual(new TextDecoder().decode(await vscode.workspace.fs.readFile(destination)), '# Open case\nUnsaved source text.\n');
		const renamedDocument = await vscode.workspace.openTextDocument(destination);
		const renamedEditor = await vscode.window.showTextDocument(renamedDocument);
		assert.strictEqual(renamedDocument.getText(), '# Open case\nUnsaved source text.\n');
		await renamedEditor.edit((builder) => builder.insert(new vscode.Position(2, 0), 'Edited after rename.\n'));
		assert.strictEqual(renamedDocument.isDirty, true);
		assert.strictEqual(await renamedDocument.save(), true);
		assert.strictEqual(new TextDecoder().decode(await vscode.workspace.fs.readFile(destination)), '# Open case\nUnsaved source text.\nEdited after rename.\n');
		const namesAfterSave = (await vscode.workspace.fs.readDirectory(fixture)).map(([name]) => name);
		assert.ok(namesAfterSave.includes('opencasename.md'), `saving restored the old casing: ${namesAfterSave.join(', ')}`);
	});

	test('applies the exact casing for a case-only folder rename', async function () {
		if (process.platform === 'linux') this.skip();
		const fixture = await makeFixture();
		const source = await service.createFolder(fixture, 'FolderName');
		const child = await service.createNote(source, 'Child');
		const index = await service.createNote(fixture, 'Index');
		await vscode.workspace.fs.writeFile(child, bytes('# Child\n'));
		await vscode.workspace.fs.writeFile(index, bytes('[child](FolderName/Child.md)\n'));
		const destination = vscode.Uri.joinPath(fixture, 'foldername');
		assert.strictEqual(await api.renameOrMoveMany([
			{ source, destination, isFolder: true },
		]), true);
		const names = (await vscode.workspace.fs.readDirectory(fixture)).map(([name]) => name);
		assert.deepStrictEqual(names.sort(), ['foldername', 'Index.md'].sort());
		const indexDocument = await vscode.workspace.openTextDocument(index);
		assert.strictEqual(indexDocument.getText(), '[child](foldername/Child.md)\n');

	});

	// The isolated extension host has no foreground OS window, so VS Code's
	// public `undo` command is intentionally inert. The focused-desktop journey
	// remains in the release checklist; browser coverage verifies that Live
	// Preview flushes pending input and routes undo/redo to the host.
	test.skip('undoes and redoes a vault move as one focused-desktop operation', () => undefined);

	async function makeFixture(): Promise<vscode.Uri> {
		const fixture = await service.createFolder(service.rootUri, `.vault-test-${Date.now()}-${fixtures.length}`);
		fixtures.push(fixture);
		return fixture;
	}
});

async function waitForCondition(predicate: () => boolean, message: string, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	do {
		if (predicate()) return;
		await new Promise<void>((resolve) => setTimeout(resolve, 25));
	} while (Date.now() < deadline);
	assert.fail(message);
}

function bytes(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

function assertBytesEqual(actual: Uint8Array, expected: Uint8Array, message: string): void {
	assert.deepStrictEqual([...actual], [...expected], message);
}

async function assertMissing(uri: vscode.Uri): Promise<void> {
	await assert.rejects(async () => vscode.workspace.fs.stat(uri));
}
