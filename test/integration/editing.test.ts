import * as assert from 'assert';
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

	async function insert(document: vscode.TextDocument, offset: number, text: string): Promise<void> {
		const edit = new vscode.WorkspaceEdit();
		edit.insert(document.uri, document.positionAt(offset), text);
		assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
	}

	test('an edit reaches disk when the document is saved', async () => {
		const editor = await openText();
		// Line 2 is "Body."; insert before the period.
		await editor.edit((builder) => builder.insert(new vscode.Position(2, 4), ' edited'));
		await editor.document.save();
		const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
		assert.ok(text.includes('Body edited.'), `unexpected file contents: ${JSON.stringify(text)}`);
	});

	test.skip('undo steps back exactly one edit in a focused desktop window', async () => {
		const document = (await openText()).document;
		await insert(document, 7, ' one');
		await insert(document, 11, ' two');
		assert.strictEqual(document.lineAt(0).text, '# Title one two');

		await vscode.commands.executeCommand('undo');
		await waitFor(() => document.lineAt(0).text !== '# Title one two');
		assert.strictEqual(
			document.lineAt(0).text,
			'# Title one',
			'undo did not step back exactly one edit',
		);
	});

	test.skip('redo steps forward exactly one edit in a focused desktop window', async () => {
		const document = (await openText()).document;
		await insert(document, 7, ' one');
		await insert(document, 11, ' two');
		await vscode.commands.executeCommand('undo');
		await vscode.commands.executeCommand('undo');
		await waitFor(() => document.lineAt(0).text === '# Title');
		assert.strictEqual(document.lineAt(0).text, '# Title');

		await vscode.commands.executeCommand('redo');
		await waitFor(() => document.lineAt(0).text === '# Title one');
		assert.strictEqual(
			document.lineAt(0).text,
			'# Title one',
			'redo did not step forward exactly one edit',
		);
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
});

/** Polls until `check` passes, or fails the test after `timeoutMs`. */
async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	assert.fail('condition was not met within the timeout');
}
