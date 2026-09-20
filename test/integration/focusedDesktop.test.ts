import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'arronjablonowski.local-markdown-vault';

interface VaultServiceApi {
	rootUri: vscode.Uri;
	createFolder(parent: vscode.Uri, name: string): Promise<vscode.Uri>;
	createNote(parent: vscode.Uri, name: string): Promise<vscode.Uri>;
}

interface DevelopmentApi {
	getVaultService(): VaultServiceApi | undefined;
	renameOrMoveMany(requests: readonly {
		source: vscode.Uri;
		destination: vscode.Uri;
		isFolder: boolean;
	}[]): Promise<boolean>;
	settleCaseRenameTransactions(): Promise<void>;
}

suite('focused macOS desktop transactions', () => {
	if (process.env.MDLP_FOCUSED_DESKTOP_TEST !== '1') return;

	let api: DevelopmentApi;
	let service: VaultServiceApi;
	const fixtures: vscode.Uri[] = [];

	suiteSetup(async function () {
		if (process.platform !== 'darwin') this.skip();
		await waitFor(() => vscode.window.state.focused, 'the isolated VS Code window never received macOS focus', 15_000);
		const extension = vscode.extensions.getExtension<DevelopmentApi>(EXTENSION_ID);
		assert.ok(extension, `extension ${EXTENSION_ID} is not installed`);
		api = await extension.activate();
		const resolved = api.getVaultService();
		assert.ok(resolved, 'the focused workspace must be a local single-folder vault');
		service = resolved;
	});

	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		for (const fixture of fixtures.splice(0)) {
			try { await vscode.workspace.fs.delete(fixture, { recursive: true }); } catch { /* already removed */ }
		}
	});

	test('undo and redo one text edit at a time in the focused editor', async () => {
		const fixture = await makeFixture('text');
		const note = await service.createNote(fixture, 'Focused Editing');
		await vscode.workspace.fs.writeFile(note, bytes('# Title\n'));
		const document = await vscode.workspace.openTextDocument(note);
		await vscode.window.showTextDocument(document);
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');

		await insert(document, 7, ' one');
		await insert(document, 11, ' two');
		assert.strictEqual(document.lineAt(0).text, '# Title one two');
		await vscode.commands.executeCommand('undo');
		await waitFor(() => document.lineAt(0).text === '# Title one', 'undo did not remove exactly one edit');
		await vscode.commands.executeCommand('undo');
		await waitFor(() => document.lineAt(0).text === '# Title', 'second undo did not restore the original text');
		await vscode.commands.executeCommand('redo');
		await waitFor(() => document.lineAt(0).text === '# Title one', 'redo did not restore exactly one edit');
		await vscode.commands.executeCommand('redo');
		await waitFor(() => document.lineAt(0).text === '# Title one two', 'second redo did not restore the final text');
	});

	test('undoes and redoes a vault move and link rewrite as one unit', async () => {
		const fixture = await makeFixture('move');
		const archive = await service.createFolder(fixture, 'Archive');
		const source = await service.createNote(fixture, 'Move Target');
		const index = await service.createNote(fixture, 'Move Index');
		await vscode.workspace.fs.writeFile(source, bytes('# Move target\n'));
		await vscode.workspace.fs.writeFile(index, bytes('[[Move Target]]\n'));
		const indexDocument = await vscode.workspace.openTextDocument(index);
		await vscode.window.showTextDocument(indexDocument);
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
		const destination = vscode.Uri.joinPath(archive, 'Moved Target.md');

		assert.strictEqual(await api.renameOrMoveMany([{ source, destination, isFolder: false }]), true);
		await waitFor(async () => await exists(destination) && !(await exists(source)), 'vault move did not commit');
		assert.strictEqual(indexDocument.getText(), '[[Moved Target]]\n');
		await vscode.commands.executeCommand('undo');
		await waitFor(async () => await exists(source) && !(await exists(destination)) && indexDocument.getText() === '[[Move Target]]\n', 'one undo did not restore the source and link');
		await vscode.commands.executeCommand('redo');
		await waitFor(async () => await exists(destination) && !(await exists(source)) && indexDocument.getText() === '[[Moved Target]]\n', 'one redo did not restore the move and link');
	});

	test('replays a case-only rename after undo and keeps one-step inverse behavior', async () => {
		const fixture = await makeFixture('case');
		const source = await service.createNote(fixture, 'FocusedCase');
		const index = await service.createNote(fixture, 'Case Index');
		await vscode.workspace.fs.writeFile(source, bytes('# Focused case\n'));
		await vscode.workspace.fs.writeFile(index, bytes('[[FocusedCase]]\n'));
		const indexDocument = await vscode.workspace.openTextDocument(index);
		await vscode.window.showTextDocument(indexDocument);
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
		const destination = vscode.Uri.joinPath(fixture, 'focusedcase.md');

		assert.strictEqual(await api.renameOrMoveMany([{ source, destination, isFolder: false }]), true);
		await waitFor(async () => (await entryNames(fixture)).includes('focusedcase.md'), 'case-only rename did not commit');
		assert.strictEqual(indexDocument.getText(), '[[focusedcase]]\n');
		await vscode.commands.executeCommand('undo');
		await waitFor(async () => (await entryNames(fixture)).includes('FocusedCase.md'), 'case-only undo did not restore exact casing');
		await api.settleCaseRenameTransactions();
		assert.strictEqual(indexDocument.getText(), '[[FocusedCase]]\n');
		await vscode.commands.executeCommand('mdLivePreview.caseAwareRedo');
		await waitFor(async () => (await entryNames(fixture)).includes('focusedcase.md'), 'case-aware redo did not replay the rename');
		assert.strictEqual(indexDocument.getText(), '[[focusedcase]]\n');
		await vscode.commands.executeCommand('undo');
		await waitFor(async () => (await entryNames(fixture)).includes('FocusedCase.md'), 'replayed transaction did not undo in one step');
		await api.settleCaseRenameTransactions();
		assert.strictEqual(indexDocument.getText(), '[[FocusedCase]]\n');
	});

	async function makeFixture(suffix: string): Promise<vscode.Uri> {
		const fixture = await service.createFolder(service.rootUri, `.focused-${suffix}-${Date.now()}`);
		fixtures.push(fixture);
		return fixture;
	}
});

async function insert(document: vscode.TextDocument, offset: number, text: string): Promise<void> {
	const edit = new vscode.WorkspaceEdit();
	edit.insert(document.uri, document.positionAt(offset), text);
	assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
}

function bytes(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

async function entryNames(directory: vscode.Uri): Promise<string[]> {
	return (await vscode.workspace.fs.readDirectory(directory)).map(([name]) => name);
}

async function waitFor(
	check: () => boolean | Promise<boolean>,
	message: string,
	timeoutMs = 5_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	assert.fail(message);
}
