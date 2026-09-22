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
	let api: { getCodeTokenizationRunCount(): number };
	let originalDefaultEditor: string | undefined;

	suiteSetup(async () => {
		const editorConfig = vscode.workspace.getConfiguration('mdLivePreview');
		originalDefaultEditor = editorConfig.inspect<string>('defaultEditor')?.globalValue;
		// This suite explicitly switches between the Text Editor and Live Preview;
		// keep the new product default from immediately reopening its source-view
		// fixture in VS Code's Markdown Editor.
		await editorConfig.update('defaultEditor', 'textEditor', vscode.ConfigurationTarget.Global);
		const folder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(folder, 'the tests need a workspace folder');
		const extension = vscode.extensions.getExtension<{ getCodeTokenizationRunCount(): number }>('arronjablonowski.local-markdown-vault');
		assert.ok(extension, 'the extension is not installed');
		api = await extension.activate();
		file = vscode.Uri.joinPath(folder.uri, 'integration-sample.md');
		await vscode.workspace.fs.writeFile(
			file,
			new TextEncoder().encode('# Heading\n\nBody with **bold** text.\n\n![alt](assets/pic.png)\n'),
		);
	});

	suiteTeardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await vscode.workspace.getConfiguration('mdLivePreview')
			.update('defaultEditor', originalDefaultEditor, vscode.ConfigurationTarget.Global);
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

	test('respects an explicit Reopen Editor With Text Editor choice', async () => {
		const editorConfig = vscode.workspace.getConfiguration('mdLivePreview');
		await editorConfig.update('defaultEditor', 'markdownEditor', vscode.ConfigurationTarget.Global);
		try {
			await vscode.commands.executeCommand('vscode.openWith', file, 'mdLivePreview.editor');
			await vscode.commands.executeCommand('vscode.openWith', file, 'default');
			await delay(1_750);
			assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), file.toString());
		} finally {
			await editorConfig.update('defaultEditor', 'textEditor', vscode.ConfigurationTarget.Global);
		}
	});

	test('defers syntax tokenization while a Live Preview tab is hidden', async () => {
		const folder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(folder);
		const hiddenFile = vscode.Uri.joinPath(folder.uri, `hidden-idle-${Date.now()}.md`);
		const coverFile = vscode.Uri.joinPath(folder.uri, `hidden-idle-${Date.now()}.txt`);
		try {
			await vscode.workspace.fs.writeFile(hiddenFile, new TextEncoder().encode('# Hidden\n\n```js\nconst value = 1;\n```\n'));
			await vscode.workspace.fs.writeFile(coverFile, new TextEncoder().encode('cover\n'));
			const document = await vscode.workspace.openTextDocument(hiddenFile);
			await vscode.commands.executeCommand('vscode.openWith', hiddenFile, 'mdLivePreview.editor');
			await waitFor(() => api.getCodeTokenizationRunCount() > 0);

			await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(coverFile), { preview: false });
			await delay(250);
			const hiddenCount = api.getCodeTokenizationRunCount();
			const edit = new vscode.WorkspaceEdit();
			edit.insert(document.uri, new vscode.Position(3, 0), 'const background = 2;\n');
			assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
			await delay(400);
			assert.strictEqual(
				api.getCodeTokenizationRunCount(),
				hiddenCount,
				'a background edit invoked syntax tokenization while the panel was hidden',
			);

			await vscode.commands.executeCommand('vscode.openWith', hiddenFile, 'mdLivePreview.editor');
			await waitFor(() => api.getCodeTokenizationRunCount() > hiddenCount);
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			for (const uri of [hiddenFile, coverFile]) {
				try { await vscode.workspace.fs.delete(uri); } catch { /* test cleanup */ }
			}
		}
	});

	test('opening a configured editor preserves an intentional source split', async () => {
		const config = vscode.workspace.getConfiguration('mdLivePreview');
		const splitFile = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'review-source-split.md');
		await vscode.workspace.fs.writeFile(splitFile, new TextEncoder().encode('# Split\n'));
		await config.update('defaultEditor', 'textEditor', vscode.ConfigurationTarget.Global);
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(splitFile), { viewColumn: vscode.ViewColumn.One, preview: false });
		const sourceGroup = vscode.window.tabGroups.activeTabGroup;
		try {
			await config.update('defaultEditor', 'livePreview', vscode.ConfigurationTarget.Global);
			await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(splitFile), { viewColumn: vscode.ViewColumn.Beside, preview: true });
			await waitFor(() => vscode.window.tabGroups.all.some((group) => group !== sourceGroup
				&& group.tabs.some((tab) => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'mdLivePreview.editor')));
			await delay(250);
			assert.ok(sourceGroup.tabs.some((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === splitFile.toString()), 'the original source split was closed');
		} finally {
			await config.update('defaultEditor', 'textEditor', vscode.ConfigurationTarget.Global);
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await vscode.workspace.fs.delete(splitFile);
		}
	});
});

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (check()) return;
		await delay(50);
	}
	assert.fail('condition was not met within the timeout');
}
