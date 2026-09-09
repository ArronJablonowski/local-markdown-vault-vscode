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

	test('contributes the outline and theme views into its own container', () => {
		const extension = vscode.extensions.getExtension('t-shoot.markdown-live-preview-editor');
		assert.ok(extension);
		const views = extension.packageJSON.contributes.views as Record<
			string,
			Array<{ id: string; type?: string }>
		>;
		const ids = (views.mdLivePreview ?? []).map((v) => v.id);
		assert.ok(ids.includes('mdLivePreview.outline'), 'the outline view is not contributed');
		assert.ok(ids.includes('mdLivePreview.styleManager'), 'the theme view is not contributed');
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
		// depend on one being there.
		const before = await listStyles();
		await vscode.commands.executeCommand('mdLivePreview.newStyle');
		const after = await listStyles();
		assert.ok(after.length >= before.length, 'the command removed a style');
	});
});

/** The CSS files the style manager keeps, or `[]` before any exist. */
async function listStyles(): Promise<string[]> {
	const extension = vscode.extensions.getExtension('t-shoot.markdown-live-preview-editor');
	assert.ok(extension);
	const dir = vscode.Uri.joinPath(extension.extensionUri, '..', 'mdlp-styles');
	try {
		const entries = await vscode.workspace.fs.readDirectory(dir);
		return entries.map(([name]) => name);
	} catch {
		return [];
	}
}
