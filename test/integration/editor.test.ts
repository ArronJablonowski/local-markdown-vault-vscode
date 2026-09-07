import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * Opening a document in the custom editor.
 *
 * These exercise the path a user takes — open a `.md`, switch to the live
 * preview, edit, switch back — which is where the host and the webview have to
 * agree with each other. A unit test sees neither side of that.
 */
suite('custom editor', () => {
	let file: vscode.Uri;

	suiteSetup(async () => {
		const folder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(folder, 'the tests need a workspace folder');
		file = vscode.Uri.joinPath(folder.uri, 'integration-sample.md');
		await vscode.workspace.fs.writeFile(
			file,
			new TextEncoder().encode('# Heading\n\nBody with **bold** text.\n\n![alt](assets/pic.png)\n'),
		);
	});

	suiteTeardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		try {
			await vscode.workspace.fs.delete(file);
		} catch {
			// Already gone; nothing to clean up.
		}
	});

	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('opens a .md file in the live preview editor', async () => {
		await vscode.commands.executeCommand('vscode.openWith', file, 'mdLivePreview.editor');
		// The custom editor is a webview, so there is no TextEditor to inspect —
		// what is observable is that the command resolved and the tab is ours.
		const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
		assert.ok(tab, 'no tab is active');
		const input = tab.input as { viewType?: string };
		assert.strictEqual(input.viewType, 'mdLivePreview.editor');
	});

	test('opens the same file in the normal text editor', async () => {
		const document = await vscode.workspace.openTextDocument(file);
		await vscode.window.showTextDocument(document);
		assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), file.toString());
		assert.strictEqual(vscode.window.activeTextEditor?.document.languageId, 'markdown');
	});

	test('leaves the file on disk as plain Markdown', async () => {
		await vscode.commands.executeCommand('vscode.openWith', file, 'mdLivePreview.editor');
		const bytes = await vscode.workspace.fs.readFile(file);
		const text = new TextDecoder().decode(bytes);
		// The selling point of the extension: opening a document in the rendered
		// editor must not rewrite it into some other format.
		assert.ok(text.startsWith('# Heading'), `file was rewritten: ${JSON.stringify(text)}`);
		assert.ok(text.includes('**bold**'));
	});

	test('the open-source command returns to the text editor', async () => {
		await vscode.commands.executeCommand('vscode.openWith', file, 'mdLivePreview.editor');
		await vscode.commands.executeCommand('mdLivePreview.openWithSource');
		assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), file.toString());
	});
});
