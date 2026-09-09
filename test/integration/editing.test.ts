import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * The document round-trip: edits reaching disk, undo and redo stepping once,
 * and an external change being followed.
 *
 * These run against the real `vscode` API rather than the webview, because the
 * host half is where the fragile part lives — edits, undo and redo are all
 * funnelled through one promise chain in `DocumentSyncSession` to keep them in
 * order, and getting that wrong desyncs the file from what the user sees.
 * `Ctrl+Z` is documented in the README as working "exactly as you'd expect",
 * and until now nothing checked it at all.
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
		return vscode.window.showTextDocument(document);
	}

	test('an edit reaches disk when the document is saved', async () => {
		const editor = await openText();
		// Line 2 is "Body."; insert before the period.
		await editor.edit((builder) => builder.insert(new vscode.Position(2, 4), ' edited'));
		await editor.document.save();
		const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
		assert.ok(text.includes('Body edited.'), `unexpected file contents: ${JSON.stringify(text)}`);
	});

	test('undo steps back exactly one edit', async () => {
		const editor = await openText();
		await editor.edit((builder) => builder.insert(new vscode.Position(0, 7), ' one'));
		await editor.edit((builder) => builder.insert(new vscode.Position(0, 11), ' two'));
		assert.strictEqual(editor.document.lineAt(0).text, '# Title one two');

		await vscode.commands.executeCommand('undo');
		assert.strictEqual(
			editor.document.lineAt(0).text,
			'# Title one',
			'undo did not step back exactly one edit',
		);
	});

	test('redo steps forward exactly one edit', async () => {
		const editor = await openText();
		await editor.edit((builder) => builder.insert(new vscode.Position(0, 7), ' one'));
		await editor.edit((builder) => builder.insert(new vscode.Position(0, 11), ' two'));
		await vscode.commands.executeCommand('undo');
		await vscode.commands.executeCommand('undo');
		assert.strictEqual(editor.document.lineAt(0).text, '# Title');

		await vscode.commands.executeCommand('redo');
		assert.strictEqual(
			editor.document.lineAt(0).text,
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
