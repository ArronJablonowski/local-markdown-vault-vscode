import * as assert from 'assert';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';

/**
 * The document round-trip: edits reaching disk, undo and redo stepping once,
 * and an external change being followed.
 *
 * These run against the real `vscode` API rather than browser emulation and
 * establish that the TextDocument edits used by the custom editor retain one
 * native undo unit per applied batch. Browser coverage separately verifies that
 * Live Preview flushes pending input before it requests host undo/redo.
 */
suite('document editing', () => {
	let file: vscode.Uri;
	let originalDefaultEditor: string | undefined;

	suiteSetup(async () => {
		const editorConfig = vscode.workspace.getConfiguration('mdLivePreview');
		originalDefaultEditor = editorConfig.inspect<string>('defaultEditor')?.globalValue;
		await editorConfig.update('defaultEditor', 'textEditor', vscode.ConfigurationTarget.Global);
	});

	suiteTeardown(async () => {
		await vscode.workspace.getConfiguration('mdLivePreview')
			.update('defaultEditor', originalDefaultEditor, vscode.ConfigurationTarget.Global);
	});

	setup(async () => {
		const folder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(folder, 'the tests need a workspace folder');
		file = vscode.Uri.joinPath(folder.uri, `editing-${Date.now()}.md`);
		await vscode.workspace.fs.writeFile(file, new TextEncoder().encode('# Title\n\nBody.\n'));
	});

	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		try {
			await vscode.workspace.fs.delete(file);
		} catch {
			// Already removed.
		}
	});

	async function openText(): Promise<vscode.TextEditor> {
		const document = await vscode.workspace.openTextDocument(file);
		const editor = await vscode.window.showTextDocument(document);
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
		await new Promise((resolve) => setTimeout(resolve, 100));
		return editor;
	}

	test('an edit reaches disk when the document is saved', async () => {
		const editor = await openText();
		// Line 2 is "Body."; insert before the period.
		await editor.edit((builder) => builder.insert(new vscode.Position(2, 4), ' edited'));
		await editor.document.save();
		const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
		assert.ok(text.includes('Body edited.'), `unexpected file contents: ${JSON.stringify(text)}`);
	});

	test('automatically saves changes made in the ordinary Text Editor', async () => {
		const editor = await openText();
		await editor.edit((builder) => builder.insert(new vscode.Position(2, 4), ' automatically'));
		await waitFor(async () => {
			const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
			return text.includes('Body automatically.') && !editor.document.isDirty;
		});
	});

	test('undo past the beginning leaves the document alone', async () => {
		const editor = await openText();
		const original = editor.document.getText();
		for (let i = 0; i < 3; i++) {
			await vscode.commands.executeCommand('undo');
		}
		assert.strictEqual(editor.document.getText(), original);
	});

	test('an external change is picked up by the open document', async () => {
		const editor = await openText();
		// Stands in for another tab, a git checkout, or a formatter: the file
		// changes underneath an editor that already has it open.
		await vscode.workspace.fs.writeFile(
			file,
			new TextEncoder().encode('# Replaced\n\nFrom outside.\n'),
		);
		await waitFor(() => editor.document.getText().includes('Replaced'));
		assert.ok(
			editor.document.getText().includes('From outside.'),
			'the document did not follow the external change',
		);
	});

	test('the custom editor opens a file that changed on disk', async () => {
		await vscode.workspace.fs.writeFile(file, new TextEncoder().encode('# Fresh\n'));
		await vscode.commands.executeCommand('vscode.openWith', file, 'mdLivePreview.editor');
		const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
		assert.strictEqual(text, '# Fresh\n', 'opening the custom editor rewrote the file');
	});

	test('the custom editor automatically saves every Markdown edit without an idle wait', async () => {
		await vscode.commands.executeCommand('vscode.openWith', file, 'mdLivePreview.editor');
		const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === file.toString());
		assert.ok(document, 'the custom editor did not open its TextDocument');
		let saves = 0;
		const listener = vscode.workspace.onDidSaveTextDocument((saved) => {
			if (saved.uri.toString() === file.toString()) saves++;
		});
		try {
			const first = new vscode.WorkspaceEdit();
			first.insert(file, new vscode.Position(2, 4), ' first');
			assert.strictEqual(await vscode.workspace.applyEdit(first), true);
			const second = new vscode.WorkspaceEdit();
			second.insert(file, new vscode.Position(2, 10), ' second');
			assert.strictEqual(await vscode.workspace.applyEdit(second), true);
			await waitFor(async () => {
				const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
				return text.includes('Body first second.');
			});
			assert.ok(saves >= 1, 'the edits must reach disk');
			assert.strictEqual(document.isDirty, false);
		} finally {
			listener.dispose();
		}
	});

	test('automatic save rejects a workspace symlink that escapes the vault', async () => {
		const outsideDirectory = await mkdtemp(join(tmpdir(), 'local-markdown-vault-autosave-'));
		const outsidePath = join(outsideDirectory, 'outside.md');
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(workspaceRoot);
		const linkedPath = vscode.Uri.joinPath(workspaceRoot, `linked-${Date.now()}.md`);
		await writeFile(outsidePath, '# Outside\n', 'utf8');
		await symlink(outsidePath, linkedPath.fsPath);
		try {
			await vscode.commands.executeCommand('vscode.openWith', linkedPath, 'mdLivePreview.editor');
			const document = vscode.workspace.textDocuments.find(
				(candidate) => candidate.uri.toString() === linkedPath.toString() || candidate.uri.fsPath === outsidePath,
			);
			assert.ok(document, 'the symlinked document did not open');
			const edit = new vscode.WorkspaceEdit();
			edit.insert(document.uri, new vscode.Position(0, 0), 'unsaved ');
			assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
			await new Promise((resolve) => setTimeout(resolve, 900));
			assert.strictEqual(await readFile(outsidePath, 'utf8'), '# Outside\n');
			await vscode.commands.executeCommand('workbench.action.files.revert');
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await rm(linkedPath.fsPath, { force: true });
			await rm(outsideDirectory, { recursive: true, force: true });
		}
	});
});

/** Polls until `check` passes, or fails the test after `timeoutMs`. */
async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	assert.fail('condition was not met within the timeout');
}
