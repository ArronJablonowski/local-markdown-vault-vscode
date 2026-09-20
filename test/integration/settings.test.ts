import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * Settings and the views they drive.
 *
 * `defaultEditor` decides what happens when a `.md` file is opened at all, and
 * the sidebar views are contributed rather than created in code — both are
 * things only the host can answer, and both were manual checklist steps.
 */
suite('settings and views', () => {
	const config = () => vscode.workspace.getConfiguration('mdLivePreview');
	let original: string | undefined;

	suiteSetup(() => {
		original = config().get('defaultEditor');
	});

	suiteTeardown(async () => {
		await config().update('defaultEditor', original, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('defaultEditor accepts each documented value', async () => {
		for (const value of ['prompt', 'livePreview', 'default']) {
			await config().update('defaultEditor', value, vscode.ConfigurationTarget.Global);
			assert.strictEqual(config().get('defaultEditor'), value);
		}
	});

	test('codeTheme accepts each documented value', async () => {
		const previous = config().get('codeTheme');
		for (const value of ['auto', 'dark-plus', 'light-plus', 'github-dark', 'github-light']) {
			await config().update('codeTheme', value, vscode.ConfigurationTarget.Global);
			assert.strictEqual(config().get('codeTheme'), value);
		}
		await config().update('codeTheme', previous, vscode.ConfigurationTarget.Global);
	});

	test('contributes the vault, outline, and theme views into its own container', () => {
		const extension = vscode.extensions.getExtension('arronjablonowski.local-markdown-vault');
		assert.ok(extension);
		const views = extension.packageJSON.contributes.views as Record<
			string,
			Array<{ id: string; type?: string }>
		>;
		const ids = (views.mdLivePreview ?? []).map((v) => v.id);
		assert.ok(ids.includes('mdLivePreview.vault'), 'the Document Vault view is not contributed');
		assert.ok(ids.includes('mdLivePreview.backlinks'), 'the Backlinks view is not contributed');
		assert.ok(ids.includes('mdLivePreview.brokenLinks'), 'the Broken Links view is not contributed');
		assert.ok(ids.includes('mdLivePreview.tags'), 'the Tags view is not contributed');
		assert.ok(ids.includes('mdLivePreview.outline'), 'the outline view is not contributed');
		assert.ok(ids.includes('mdLivePreview.styleManager'), 'the theme view is not contributed');
	});

	test('the Document Vault view can be revealed', async () => {
		await vscode.commands.executeCommand('mdLivePreview.vault.focus');
	});

	test('the local knowledge views can be revealed', async () => {
		await vscode.commands.executeCommand('mdLivePreview.backlinks.focus');
		await vscode.commands.executeCommand('mdLivePreview.brokenLinks.focus');
		await vscode.commands.executeCommand('mdLivePreview.tags.focus');
	});

	test('the local metadata index can be discarded and rebuilt', async () => {
		const extension = vscode.extensions.getExtension<{ getVaultRecentPaths(): readonly string[] }>('arronjablonowski.local-markdown-vault');
		assert.ok(extension);
		const api = await extension.activate();
		await vscode.commands.executeCommand('mdLivePreview.openIndexedPath', 'README.md');
		assert.ok(api.getVaultRecentPaths().includes('README.md'), 'opening an indexed note did not record it as recent');
		await vscode.commands.executeCommand('mdLivePreview.vault.rebuildIndex');
		assert.deepStrictEqual(api.getVaultRecentPaths(), [], 'metadata reset retained recent-note history');
	});

	test('the outline view can be revealed', async () => {
		// A view that throws on open is invisible in every other test, since
		// nothing else instantiates its provider.
		await vscode.commands.executeCommand('mdLivePreview.outline.focus');
	});

	test('the CSS themes view can be revealed', async () => {
		await vscode.commands.executeCommand('mdLivePreview.styleManager.focus');
	});

	test('the new-style command runs without a document open', async () => {
		// It creates a file rather than acting on the active editor, so it must not
		// depend on one being there. The command returns the new global-storage URI
		// so this test can clean up only the artifact it created.
		const created = await vscode.commands.executeCommand<vscode.Uri | undefined>('mdLivePreview.newStyle');
		assert.ok(created, 'the command did not create a style');
		try {
			const stat = await vscode.workspace.fs.stat(created);
			assert.ok(stat.type & vscode.FileType.File);
			assert.match(created.path, /\/styles\/[^/]+\.css$/i);
		} finally {
			await vscode.workspace.fs.delete(created);
		}
	});
});
