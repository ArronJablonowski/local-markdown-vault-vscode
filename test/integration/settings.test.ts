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
	let originalOpenBehavior: string | undefined;

	suiteSetup(() => {
		original = config().get('defaultEditor');
		originalOpenBehavior = config().get('vault.openBehavior');
	});

	suiteTeardown(async () => {
		await config().update('defaultEditor', original, vscode.ConfigurationTarget.Global);
		await config().update('vault.openBehavior', originalOpenBehavior, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('defaultEditor applies every documented viewing mode', async () => {
		const expectedViewTypes: Record<string, string | undefined> = {
			prompt: undefined,
			textEditor: 'default',
			markdownPreview: 'vscode.markdown.preview.editor',
			vscodeMarkdownEditor: 'vscode.markdown.editor',
			markdownEditor: 'vscode.markdown.editor',
			livePreview: 'mdLivePreview.editor',
		};
		for (const [value, expectedViewType] of Object.entries(expectedViewTypes)) {
			await config().update('defaultEditor', value, vscode.ConfigurationTarget.Global);
			assert.strictEqual(config().get('defaultEditor'), value);
			await waitFor(() => {
				const associations = vscode.workspace
					.getConfiguration()
					.get<Record<string, string>>('workbench.editorAssociations');
				return associations?.['*.md'] === expectedViewType
					&& associations?.['*.markdown'] === expectedViewType;
			});
		}
	});

	test('opens new Markdown files in the selected editor through VS Code and the vault', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root);
		for (const [mode, expected] of [
			['markdownEditor', 'vscode.markdown.editor'],
			['livePreview', 'mdLivePreview.editor'],
		]) {
			await config().update('defaultEditor', mode, vscode.ConfigurationTarget.Global);
			await waitFor(() => vscode.workspace.getConfiguration()
				.get<Record<string, string>>('workbench.editorAssociations')?.['*.md'] === expected);
			for (const path of ['README.md', 'obsidian-core.md']) {
				const uri = vscode.Uri.joinPath(root, path);
				await vscode.commands.executeCommand('workbench.action.closeAllEditors');
				await vscode.commands.executeCommand('vscode.open', uri);
				await waitFor(() => {
					const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
					return input instanceof vscode.TabInputCustom && input.viewType === expected
						&& input.uri.toString() === uri.toString();
				});
				await vscode.commands.executeCommand('workbench.action.closeAllEditors');
				await vscode.commands.executeCommand('mdLivePreview.openIndexedPath', path);
				const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
				assert.ok(input instanceof vscode.TabInputCustom);
				assert.strictEqual(input.viewType, expected);
				assert.strictEqual(input.uri.toString(), uri.toString());
			}
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

	test('does not copy workspace editor associations into user settings', async () => {
		const root = vscode.workspace.getConfiguration();
		const key = 'workbench.editorAssociations';
		const originalWorkspace = root.inspect<Record<string, string>>(key)?.workspaceValue;
		const originalGlobal = root.inspect<Record<string, string>>(key)?.globalValue;
		try {
			await root.update(key, { ...originalWorkspace, '*.review-workspace-only': 'default' }, vscode.ConfigurationTarget.Workspace);
			await config().update('defaultEditor', 'livePreview', vscode.ConfigurationTarget.Global);
			await waitFor(() => root.inspect<Record<string, string>>(key)?.globalValue?.['*.md'] === 'mdLivePreview.editor');
			assert.strictEqual(root.inspect<Record<string, string>>(key)?.globalValue?.['*.review-workspace-only'], undefined);
		} finally {
			await root.update(key, originalWorkspace, vscode.ConfigurationTarget.Workspace);
			await root.update(key, originalGlobal, vscode.ConfigurationTarget.Global);
		}
	});

	test('defaultEditingMode accepts Editing and Locked', async () => {
		const previous = config().get('defaultEditingMode');
		for (const value of ['editing', 'locked']) {
			await config().update('defaultEditingMode', value, vscode.ConfigurationTarget.Global);
			assert.strictEqual(config().get('defaultEditingMode'), value);
		}
		await config().update('defaultEditingMode', previous, vscode.ConfigurationTarget.Global);
	});

	test('reuses one preview tab by default and can keep files in separate tabs', async () => {
		const folder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(folder);
		const first = vscode.Uri.joinPath(folder.uri, 'README.md');
		const second = vscode.Uri.joinPath(folder.uri, 'obsidian-core.md');
		await config().update('defaultEditor', 'markdownEditor', vscode.ConfigurationTarget.Global);
		try {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await config().update('vault.openBehavior', 'reuseTab', vscode.ConfigurationTarget.Global);
			await vscode.commands.executeCommand('mdLivePreview.openIndexedPath', 'README.md');
			await vscode.commands.executeCommand('mdLivePreview.openIndexedPath', 'obsidian-core.md');
			assert.deepStrictEqual(openMarkdownTabUris(first, second), [second.toString()]);
			assert.strictEqual(vscode.window.tabGroups.activeTabGroup.activeTab?.isPreview, true);

			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await config().update('vault.openBehavior', 'newTab', vscode.ConfigurationTarget.Global);
			await vscode.commands.executeCommand('mdLivePreview.openIndexedPath', 'README.md');
			await vscode.commands.executeCommand('mdLivePreview.openIndexedPath', 'obsidian-core.md');
			assert.deepStrictEqual(openMarkdownTabUris(first, second).sort(), [first.toString(), second.toString()].sort());
			assert.strictEqual(vscode.window.tabGroups.activeTabGroup.activeTab?.isPreview, false);
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		}
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

function openMarkdownTabUris(...targets: vscode.Uri[]): string[] {
	const wanted = new Set(targets.map((uri) => uri.toString()));
	const open: string[] = [];
	for (const group of vscode.window.tabGroups.all) {
		for (const tab of group.tabs) {
			const input = tab.input;
			if (
				(input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) &&
				wanted.has(input.uri.toString())
			) open.push(input.uri.toString());
		}
	}
	return open;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	assert.fail('timed out waiting for the configured Markdown viewing mode');
}
