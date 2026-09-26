import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, rename, symlink, unlink } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import * as vscode from 'vscode';

interface MoveRequest {
	source: vscode.Uri;
	destination: vscode.Uri;
	isFolder: boolean;
}

interface DevelopmentApi {
	renameOrMoveMany(requests: readonly MoveRequest[]): Promise<boolean>;
	clearVaultMoveHistory(): void;
}

const undoCommand = 'mdLivePreview.vault.undoMove';
const redoCommand = 'mdLivePreview.vault.redoMove';

suite('dedicated Document Vault move history', () => {
	// Run in its own disposable workbench so history, native text models, and
	// settings cannot be inherited from the general integration suite.
	if (process.env.MDLP_VAULT_MOVE_HISTORY_TEST !== '1') return;
	let api: DevelopmentApi;
	let fixture: vscode.Uri;
	const additionalFixtures: vscode.Uri[] = [];
	const previousSettings = new Map<string, unknown>();

	suiteSetup(async () => {
		const extension = vscode.extensions.getExtension<DevelopmentApi>('arronjablonowski.local-markdown-vault');
		assert.ok(extension);
		api = await extension.activate();
		for (const [key, value] of Object.entries({
			'defaultEditor': 'textEditor',
			'autoSave': true,
			'vault.updateLinksOnMove': true,
			'vault.exclude': [],
		})) {
			const config = vscode.workspace.getConfiguration('mdLivePreview');
			previousSettings.set(key, config.inspect(key)?.workspaceValue);
			await config.update(key, value, vscode.ConfigurationTarget.Workspace);
		}
	});

	setup(async () => {
		api.clearVaultMoveHistory();
		await vscode.workspace.getConfiguration('mdLivePreview').update('autoSave', true, vscode.ConfigurationTarget.Workspace);
		fixture = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, `vault-history-${randomUUID()}`);
		await vscode.workspace.fs.createDirectory(fixture);
	});

	teardown(async () => {
		// Save only this test's dirty notes before closing; never act on arbitrary
		// user documents if a test host was accidentally configured incorrectly.
		for (const document of vscode.workspace.textDocuments) {
			if (!document.isClosed && document.isDirty && document.uri.path.startsWith(fixture.path + '/')) {
				assert.equal(await document.save(), true);
			}
		}
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		api.clearVaultMoveHistory();
		await vscode.workspace.fs.delete(fixture, { recursive: true });
		for (const uri of additionalFixtures.splice(0)) await vscode.workspace.fs.delete(uri);
	});

	suiteTeardown(async () => {
		const config = vscode.workspace.getConfiguration('mdLivePreview');
		for (const [key, value] of previousSettings) {
			await config.update(key, value, vscode.ConfigurationTarget.Workspace);
		}
	});

	test('empty history is a safe no-op', async () => {
		assert.equal(await undo(), false);
		assert.equal(await redo(), false);
		assert.deepEqual(await vscode.workspace.fs.readDirectory(fixture), []);
	});

	test('repeatedly restores links in a note that was never displayed', async () => {
		const batch = await makeBatch();
		assert.equal(vscode.window.visibleTextEditors.some(editor => editor.document.uri.toString() === batch.index.toString()), false);
		assert.equal(await api.renameOrMoveMany(batch.requests), true);
		await persisted(batch.index, batch.movedLinks);
		// Let VS Code dispose the hidden saved model, the condition that makes
		// native Undo lose the incoming-link portion of its grouped operation.
		await delay(1100);
		for (let cycle = 0; cycle < 3; cycle++) {
			assert.equal(await undo(), true, `undo cycle ${cycle}`);
			await assertBatchLocation(batch, false);
			assert.equal(await redo(), true, `redo cycle ${cycle}`);
			await assertBatchLocation(batch, true);
		}
		assert.equal(await undo(), true);
		await assertBatchLocation(batch, false);
	});

	test('undoes and redoes a folder with nested notes and a binary attachment', async () => {
		const source = await folder('Research');
		const nested = await folder('Research/Nested');
		const child = await file('Research/Nested/Child.md', '# Child\n[asset](../image.bin)\n');
		const attachment = vscode.Uri.joinPath(source, 'image.bin');
		const bytes = Uint8Array.from([0, 255, 137, 80, 13, 10, 0, 128]);
		await vscode.workspace.fs.writeFile(attachment, bytes);
		const index = await file('Index.md', '[child](Research/Nested/Child.md#section)\n');
		const destination = vscode.Uri.joinPath(fixture, 'Renamed Research Ω');
		assert.equal(await api.renameOrMoveMany([{ source, destination, isFolder: true }]), true);
		await persisted(index, '[child](Renamed%20Research%20Ω/Nested/Child.md#section)\n');
		assert.equal(await undo(), true);
		await persisted(index, '[child](Research/Nested/Child.md#section)\n');
		assert.equal(await text(child), '# Child\n[asset](../image.bin)\n');
		assert.deepEqual(Buffer.from(await vscode.workspace.fs.readFile(attachment)), Buffer.from(bytes));
		await missing(destination);
		assert.equal(await redo(), true);
		assert.equal(await text(vscode.Uri.joinPath(destination, 'Nested', 'Child.md')), '# Child\n[asset](../image.bin)\n');
		assert.deepEqual(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(destination, 'image.bin'))), Buffer.from(bytes));
		await missing(nested);
	});

	test('renames Markdown, wiki aliases, heading links, and references using current contents', async () => {
		const oldName = `Original-${randomUUID()}`;
		const newName = `Renamed-${randomUUID()}`;
		const source = await file(`${oldName}.md`, '# Original\n');
		const destination = vscode.Uri.joinPath(fixture, `${newName}.md`);
		const original = `[[${oldName}|Alias]] [[${oldName}#Heading]]\n[ref]: ${oldName}.md\n\n\`[literal](${oldName}.md)\`\n`;
		const rewritten = `[[${newName}|Alias]] [[${newName}#Heading]]\n[ref]: ${newName}.md\n\n\`[literal](${oldName}.md)\`\n`;
		const index = await file('Index.md', original);
		assert.equal(await api.renameOrMoveMany([{ source, destination, isFolder: false }]), true);
		await persisted(index, rewritten);
		assert.equal(await undo(), true);
		await persisted(index, original);
		assert.equal(await redo(), true);
		await persisted(index, rewritten);
	});

	test('preserves saved edits made after a move and rewrites newly added incoming links', async () => {
		const batch = await makeBatch();
		assert.equal(await api.renameOrMoveMany(batch.requests), true);
		await persisted(batch.index, batch.movedLinks);
		const newIndex = await file('New index.md', '[new](Archive/Alpha.md)\n');
		const movedAlpha = batch.requests[0].destination;
		await appendInEditor(movedAlpha, 'Added after the move. 😀\n', true);
		const indexDocument = await appendInEditor(batch.index, 'New prose.\n[again](Archive/Beta.md)\n', true);
		assert.equal(await undo(), true);
		assert.equal(indexDocument.getText(), batch.originalLinks + 'New prose.\n[again](Beta.md)\n');
		await persistDocument(indexDocument);
		await persisted(batch.index, batch.originalLinks + 'New prose.\n[again](Beta.md)\n');
		await persisted(newIndex, '[new](Alpha.md)\n');
		assert.equal(await text(batch.requests[0].source), '# Alpha\nAdded after the move. 😀\n');
		assert.equal(await redo(), true);
		assert.equal(indexDocument.getText(), batch.movedLinks + 'New prose.\n[again](Archive/Beta.md)\n');
		await persistDocument(indexDocument);
		await persisted(batch.index, batch.movedLinks + 'New prose.\n[again](Archive/Beta.md)\n');
		await persisted(newIndex, '[new](Archive/Alpha.md)\n');
		assert.equal(await text(movedAlpha), '# Alpha\nAdded after the move. 😀\n');
	});

	test('preserves unsaved incoming-note edits instead of restoring a stale snapshot', async () => {
		const batch = await makeBatch();
		assert.equal(await api.renameOrMoveMany(batch.requests), true);
		await persisted(batch.index, batch.movedLinks);
		await vscode.workspace.getConfiguration('mdLivePreview').update('autoSave', false, vscode.ConfigurationTarget.Workspace);
		const document = await appendInEditor(batch.index, 'Unsaved addition.\n', false);
		assert.equal(document.isDirty, true);
		assert.equal(await undo(), true);
		assert.equal(document.getText(), batch.originalLinks + 'Unsaved addition.\n');
		assert.equal(document.isDirty, true, 'undo must not silently save an unrelated dirty edit');
		await persistDocument(document);
		await persisted(batch.index, batch.originalLinks + 'Unsaved addition.\n');
		assert.equal(await redo(), true);
		assert.equal(document.getText(), batch.movedLinks + 'Unsaved addition.\n');
		await persistDocument(document);
		await persisted(batch.index, batch.movedLinks + 'Unsaved addition.\n');
	});

	test('retains a rejected undo so a removed collision can be retried atomically', async () => {
		const batch = await makeBatch();
		assert.equal(await api.renameOrMoveMany(batch.requests), true);
		await persisted(batch.index, batch.movedLinks);
		await vscode.workspace.fs.writeFile(batch.requests[1].source, Buffer.from('unrelated collision\n'));
		assert.equal(await undo(), false);
		assert.equal(await text(batch.requests[1].source), 'unrelated collision\n');
		await missing(batch.requests[0].source);
		assert.equal(await text(batch.requests[0].destination), '# Alpha\n');
		assert.equal(await text(batch.requests[1].destination), '# Beta\n');
		assert.equal(await text(batch.index), batch.movedLinks);
		await vscode.workspace.fs.delete(batch.requests[1].source);
		assert.equal(await undo(), true);
		await assertBatchLocation(batch, false);
	});

	test('rejects a missing moved item without moving the rest of its batch', async () => {
		const batch = await makeBatch();
		assert.equal(await api.renameOrMoveMany(batch.requests), true);
		await persisted(batch.index, batch.movedLinks);
		await vscode.workspace.fs.delete(batch.requests[1].destination);
		assert.equal(await undo(), false);
		await missing(batch.requests[0].source);
		await missing(batch.requests[1].source);
		assert.equal(await text(batch.requests[0].destination), '# Alpha\n');
		assert.equal(await text(batch.index), batch.movedLinks);
	});

	test('rejects an unrelated replacement inode at a moved path without partial changes', async () => {
		const batch = await makeBatch();
		assert.equal(await api.renameOrMoveMany(batch.requests), true);
		await persisted(batch.index, batch.movedLinks);
		const movedBeta = batch.requests[1].destination;
		const held = vscode.Uri.joinPath(fixture, 'held-original.txt');
		const originalIdentity = await lstat(movedBeta.fsPath);
		await rename(movedBeta.fsPath, held.fsPath);
		await vscode.workspace.fs.writeFile(movedBeta, Buffer.from('# Unrelated replacement\n'));
		assert.notEqual((await lstat(movedBeta.fsPath)).ino, originalIdentity.ino);
		assert.equal(await undo(), false);
		await missing(batch.requests[0].source);
		await missing(batch.requests[1].source);
		assert.equal(await text(batch.requests[0].destination), '# Alpha\n');
		assert.equal(await text(movedBeta), '# Unrelated replacement\n');
		assert.equal(await text(held), '# Beta\n');
		assert.equal(await text(batch.index), batch.movedLinks);
	});

	test('rejects a symbolic-link replacement without reading or moving its target', async function () {
		const batch = await makeBatch();
		assert.equal(await api.renameOrMoveMany(batch.requests), true);
		await persisted(batch.index, batch.movedLinks);
		const movedBeta = batch.requests[1].destination;
		const held = vscode.Uri.joinPath(fixture, 'held-original.txt');
		const target = await file('Unrelated target.txt', 'target must be untouched\n');
		await rename(movedBeta.fsPath, held.fsPath);
		try { await symlink(target.fsPath, movedBeta.fsPath); }
		catch (error) {
			await rename(held.fsPath, movedBeta.fsPath);
			if ((error as NodeJS.ErrnoException).code === 'EPERM' && process.platform === 'win32') this.skip();
			throw error;
		}
		try {
			assert.equal(await undo(), false);
			await missing(batch.requests[0].source);
			await missing(batch.requests[1].source);
			assert.equal(await text(batch.requests[0].destination), '# Alpha\n');
			assert.equal(await text(target), 'target must be untouched\n');
			assert.equal(await text(held), '# Beta\n');
			assert.equal((await lstat(movedBeta.fsPath)).isSymbolicLink(), true);
			assert.equal(await text(batch.index), batch.movedLinks);
		} finally { await unlink(movedBeta.fsPath); }
	});

	test('rejects an unrelated replacement folder with the original folder name', async () => {
		const source = await folder('Research');
		await file('Research/Original.md', 'original folder content\n');
		const archive = await folder('Archive');
		const destination = vscode.Uri.joinPath(archive, 'Research');
		const held = vscode.Uri.joinPath(fixture, 'Held original');
		const index = await file('Index.md', '[note](Research/Original.md)\n');
		assert.equal(await api.renameOrMoveMany([{ source, destination, isFolder: true }]), true);
		await persisted(index, '[note](Archive/Research/Original.md)\n');
		await rename(destination.fsPath, held.fsPath);
		await vscode.workspace.fs.createDirectory(destination);
		await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(destination, 'Replacement.md'), Buffer.from('unrelated folder\n'));
		assert.equal(await undo(), false);
		await missing(source);
		assert.equal(await text(vscode.Uri.joinPath(held, 'Original.md')), 'original folder content\n');
		assert.equal(await text(vscode.Uri.joinPath(destination, 'Replacement.md')), 'unrelated folder\n');
		assert.equal(await text(index), '[note](Archive/Research/Original.md)\n');
	});

	test('rejects a replacement original parent before moving anything into it', async () => {
		const originalParent = await folder('Original parent');
		const source = await file('Original parent/Alpha.md', '# Alpha\n');
		const archive = await folder('Archive');
		const destination = vscode.Uri.joinPath(archive, 'Alpha.md');
		const index = await file('Index.md', '[Alpha](<Original parent/Alpha.md>)\n');
		assert.equal(await api.renameOrMoveMany([{ source, destination, isFolder: false }]), true);
		await persisted(index, '[Alpha](<Archive/Alpha.md>)\n');
		await rename(originalParent.fsPath, vscode.Uri.joinPath(fixture, 'Held parent').fsPath);
		await vscode.workspace.fs.createDirectory(originalParent);
		assert.equal(await undo(), false);
		await missing(source);
		assert.equal(await text(destination), '# Alpha\n');
		assert.equal(await text(index), '[Alpha](<Archive/Alpha.md>)\n');
		assert.deepEqual(await vscode.workspace.fs.readDirectory(originalParent), []);
	});

	test('simultaneous Undo invocations cannot replay a single entry twice', async () => {
		const batch = await makeBatch();
		assert.equal(await api.renameOrMoveMany(batch.requests), true);
		const results = await Promise.all([undo(), undo()]);
		assert.deepEqual(results.sort(), [false, true]);
		await assertBatchLocation(batch, false);
		assert.equal(await redo(), true);
		await assertBatchLocation(batch, true);
	});

	test('new successful moves discard the abandoned redo branch', async () => {
		const batch = await makeBatch();
		assert.equal(await api.renameOrMoveMany(batch.requests), true);
		assert.equal(await undo(), true);
		const renamed = vscode.Uri.joinPath(fixture, 'Renamed.md');
		assert.equal(await api.renameOrMoveMany([{ source: batch.requests[0].source, destination: renamed, isFolder: false }]), true);
		assert.equal(await redo(), false);
		assert.equal(await text(renamed), '# Alpha\n');
		assert.equal(await text(batch.requests[1].source), '# Beta\n');
		assert.equal(await undo(), true);
		await assertBatchLocation(batch, false);
		assert.equal(await undo(), false);
	});

	test('multiple history entries undo and redo in order across a renamed folder', async () => {
		const batch = await makeBatch();
		assert.equal(await api.renameOrMoveMany(batch.requests), true);
		const originalFolder = vscode.Uri.joinPath(fixture, 'Archive');
		const renamedFolder = vscode.Uri.joinPath(fixture, 'Final');
		assert.equal(await api.renameOrMoveMany([{ source: originalFolder, destination: renamedFolder, isFolder: true }]), true);
		await persisted(batch.index, '[Alpha](Final/Alpha.md) and [Beta](Final/Beta.md)\n');
		assert.equal(await undo(), true);
		await assertBatchLocation(batch, true);
		assert.equal(await undo(), true);
		await assertBatchLocation(batch, false);
		assert.equal(await undo(), false);
		assert.equal(await redo(), true);
		await assertBatchLocation(batch, true);
		assert.equal(await redo(), true);
		await persisted(batch.index, '[Alpha](Final/Alpha.md) and [Beta](Final/Beta.md)\n');
		assert.equal(await text(vscode.Uri.joinPath(renamedFolder, 'Alpha.md')), '# Alpha\n');
		assert.equal(await text(vscode.Uri.joinPath(renamedFolder, 'Beta.md')), '# Beta\n');
	});

	test('redo rejects a destination collision without overwriting the colliding file', async () => {
		const batch = await makeBatch();
		assert.equal(await api.renameOrMoveMany(batch.requests), true);
		assert.equal(await undo(), true);
		await persisted(batch.index, batch.originalLinks);
		await vscode.workspace.fs.writeFile(batch.requests[1].destination, Buffer.from('redo collision\n'));
		assert.equal(await redo(), false);
		assert.equal(await text(batch.requests[1].destination), 'redo collision\n');
		assert.equal(await text(batch.requests[0].source), '# Alpha\n');
		assert.equal(await text(batch.requests[1].source), '# Beta\n');
		await missing(batch.requests[0].destination);
		assert.equal(await text(batch.index), batch.originalLinks);
	});

	test('repeatedly applies exact case-only file and folder spelling', async () => {
		const events: string[] = [];
		const listener = vscode.workspace.onDidRenameFiles(event => {
			events.push(...event.files.map(file => `${file.oldUri.path} -> ${file.newUri.path}`));
		});
		try {
		const source = await folder('FolderCase');
		await file('FolderCase/NoteCase.md', '# Case-sensitive content\n');
		const destination = vscode.Uri.joinPath(fixture, 'foldercase');
		const index = await file('Index.md', '[case](FolderCase/NoteCase.md)\n');
		assert.equal(await api.renameOrMoveMany([{ source, destination, isFolder: true }]), true);
		for (let cycle = 0; cycle < 2; cycle++) {
			assert.equal(await undo(), true);
			await exactEntries(fixture, ['FolderCase', 'Index.md']);
			await persisted(index, '[case](FolderCase/NoteCase.md)\n');
			assert.equal(await redo(), true);
			await exactEntries(fixture, ['foldercase', 'Index.md']);
			await persisted(index, '[case](foldercase/NoteCase.md)\n');
		}
		const noteSource = vscode.Uri.joinPath(destination, 'NoteCase.md');
		const noteDestination = vscode.Uri.joinPath(destination, 'notecase.md');
		assert.equal(await api.renameOrMoveMany([{ source: noteSource, destination: noteDestination, isFolder: false }]), true);
		assert.equal(await undo(), true);
		await exactEntries(destination, ['NoteCase.md']);
		assert.equal(await redo(), true);
		await exactEntries(destination, ['notecase.md']);
		assert.equal(await text(noteDestination), '# Case-sensitive content\n');
		await persisted(index, '[case](foldercase/notecase.md)\n');
		} catch (error) {
			console.log('Case-only native rename events:', JSON.stringify(events));
			throw error;
		} finally { listener.dispose(); }
	});

	test('refuses to reuse history after the automatic-link policy changes', async () => {
		const batch = await makeBatch();
		assert.equal(await api.renameOrMoveMany(batch.requests), true);
		await persisted(batch.index, batch.movedLinks);
		const config = vscode.workspace.getConfiguration('mdLivePreview.vault');
		try {
			await config.update('updateLinksOnMove', false, vscode.ConfigurationTarget.Workspace);
			assert.equal(await undo(), false);
			await assertBatchLocation(batch, true);
		} finally { await config.update('updateLinksOnMove', true, vscode.ConfigurationTarget.Workspace); }
	});

	test('refuses to reuse history after the excluded-path policy changes', async () => {
		const batch = await makeBatch();
		assert.equal(await api.renameOrMoveMany(batch.requests), true);
		await persisted(batch.index, batch.movedLinks);
		const config = vscode.workspace.getConfiguration('mdLivePreview.vault');
		try {
			await config.update('exclude', ['**/Index.md'], vscode.ConfigurationTarget.Workspace);
			assert.equal(await undo(), false);
			await assertBatchLocation(batch, true);
		} finally { await config.update('exclude', [], vscode.ConfigurationTarget.Workspace); }
	});

	test('undo preserves a newly created vault-root wiki target with the same basename', async () => {
		const oldName = `A-${randomUUID()}`;
		const newName = `B-${randomUUID()}`;
		await folder('Docs');
		const source = await file(`Docs/${oldName}.md`, '# Nested target\n');
		const destination = vscode.Uri.joinPath(fixture, 'Docs', `${newName}.md`);
		assert.equal(await api.renameOrMoveMany([{ source, destination, isFolder: false }]), true);
		const unrelatedRoot = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, `${newName}.md`);
		additionalFixtures.push(unrelatedRoot);
		await vscode.workspace.fs.writeFile(unrelatedRoot, Buffer.from('# Unrelated root target\n'));
		const relative = vscode.workspace.asRelativePath(fixture, false).replace(/\\/g, '/');
		const index = await file('New links.md', `[[${newName}]] [[${relative}/Docs/${newName}]]\n`);
		assert.equal(await undo(), true);
		await persisted(index, `[[${newName}]] [[${relative}/Docs/${oldName}]]\n`);
		assert.equal(await text(unrelatedRoot), '# Unrelated root target\n');
		assert.equal(await text(source), '# Nested target\n');
		assert.equal(await redo(), true);
		await persisted(index, `[[${newName}]] [[${relative}/Docs/${newName}]]\n`);
	});

	test('a renamed basename wiki link stays unambiguous when another target already exists', async () => {
		const oldName = `A-${randomUUID()}`;
		const newName = `B-${randomUUID()}`;
		await folder('Docs');
		const source = await file(`Docs/${oldName}.md`, '# Nested target\n');
		const destination = vscode.Uri.joinPath(fixture, 'Docs', `${newName}.md`);
		const unrelatedRoot = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, `${newName}.md`);
		additionalFixtures.push(unrelatedRoot);
		await vscode.workspace.fs.writeFile(unrelatedRoot, Buffer.from('# Root target\n'));
		const index = await file('Index.md', `[[${oldName}]]\n`);
		const relative = vscode.workspace.asRelativePath(fixture, false).replace(/\\/g, '/');
		assert.equal(await api.renameOrMoveMany([{ source, destination, isFolder: false }]), true);
		await persisted(index, `[[${relative}/Docs/${newName}]]\n`);
		assert.equal(await undo(), true);
		// A qualified link remains qualified during inverse planning, avoiding
		// authoring-style snapshots while retaining its actual target.
		await persisted(index, `[[${relative}/Docs/${oldName}]]\n`);
		assert.equal(await text(unrelatedRoot), '# Root target\n');
	});

	async function file(path: string, contents: string): Promise<vscode.Uri> {
		const uri = vscode.Uri.joinPath(fixture, path);
		await vscode.workspace.fs.writeFile(uri, Buffer.from(contents));
		return uri;
	}

	async function folder(path: string): Promise<vscode.Uri> {
		const uri = vscode.Uri.joinPath(fixture, path);
		await vscode.workspace.fs.createDirectory(uri);
		return uri;
	}

	async function makeBatch() {
		const archive = await folder('Archive');
		const alpha = await file('Alpha.md', '# Alpha\n');
		const beta = await file('Beta.md', '# Beta\n');
		const originalLinks = '[Alpha](Alpha.md) and [Beta](Beta.md)\n';
		const movedLinks = '[Alpha](Archive/Alpha.md) and [Beta](Archive/Beta.md)\n';
		const index = await file('Index.md', originalLinks);
		const requests: MoveRequest[] = [alpha, beta].map(source => ({
			source, destination: vscode.Uri.joinPath(archive, source.path.split('/').pop()!), isFolder: false,
		}));
		return { index, requests, originalLinks, movedLinks };
	}

	async function assertBatchLocation(batch: Awaited<ReturnType<typeof makeBatch>>, moved: boolean): Promise<void> {
		await persisted(batch.index, moved ? batch.movedLinks : batch.originalLinks);
		for (const [index, request] of batch.requests.entries()) {
			assert.equal(await text(moved ? request.destination : request.source), index === 0 ? '# Alpha\n' : '# Beta\n');
			await missing(moved ? request.source : request.destination);
		}
	}
});

async function undo(): Promise<boolean | undefined> { return vscode.commands.executeCommand<boolean>(undoCommand); }
async function redo(): Promise<boolean | undefined> { return vscode.commands.executeCommand<boolean>(redoCommand); }
async function text(uri: vscode.Uri): Promise<string> { return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'); }

async function missing(uri: vscode.Uri): Promise<void> {
	await assert.rejects(async () => vscode.workspace.fs.stat(uri), error => error instanceof vscode.FileSystemError && error.code === 'FileNotFound');
}

async function persisted(uri: vscode.Uri, expected: string): Promise<void> {
	let actual: string | undefined;
	for (let attempt = 0; attempt < 100; attempt++) {
		actual = await text(uri);
		if (actual === expected) return;
		await delay(25);
	}
	assert.equal(actual, expected, `persisted bytes for ${uri.path}`);
}

async function appendInEditor(uri: vscode.Uri, addition: string, save: boolean): Promise<vscode.TextDocument> {
	const document = await vscode.workspace.openTextDocument(uri);
	const editor = await vscode.window.showTextDocument(document);
	assert.equal(await editor.edit(edit => edit.insert(document.positionAt(document.getText().length), addition)), true);
	if (save) await persistDocument(document);
	return document;
}

async function persistDocument(document: vscode.TextDocument): Promise<void> {
	const expected = document.getText();
	// Autosave may have already started the same save. Its boolean is not the
	// durability proof; validate the exact bytes after both paths have settled.
	await document.save();
	await persisted(document.uri, expected);
}

async function exactEntries(uri: vscode.Uri, expected: string[]): Promise<void> {
	assert.deepEqual((await vscode.workspace.fs.readDirectory(uri)).map(([name]) => name).sort(), [...expected].sort());
}
