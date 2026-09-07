import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 't-shoot.markdown-live-preview-editor';

/**
 * What a unit test cannot see.
 *
 * The Node suite covers logic; these cover the parts that only exist once VS
 * Code has loaded the extension — the manifest being well formed, activation
 * succeeding, the custom editor claiming the file types it claims to, and the
 * localization bundles actually shipping.
 */
suite('extension', () => {
	test('is installed and activates', async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, `extension ${EXTENSION_ID} is not installed`);
		await extension.activate();
		assert.strictEqual(extension.isActive, true);
	});

	test('registers its commands', async () => {
		const commands = await vscode.commands.getCommands(true);
		for (const id of [
			'mdLivePreview.openWithLivePreview',
			'mdLivePreview.openWithSource',
			'mdLivePreview.newStyle',
		]) {
			assert.ok(commands.includes(id), `command ${id} is not registered`);
		}
	});

	test('contributes its settings with the documented defaults', () => {
		const config = vscode.workspace.getConfiguration('mdLivePreview');
		assert.strictEqual(config.get('codeTheme'), 'auto');
		assert.strictEqual(config.get('defaultEditor'), 'prompt');
		// `enabledStyles` is application-scoped, so a real installation's value
		// leaks into the test window; only its type is worth asserting.
		assert.ok(Array.isArray(config.get('enabledStyles')));
	});

	test('claims .md and .markdown for its custom editor', () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension);
		const editors = extension.packageJSON.contributes.customEditors as Array<{
			viewType: string;
			selector: Array<{ filenamePattern: string }>;
		}>;
		const editor = editors.find((e) => e.viewType === 'mdLivePreview.editor');
		assert.ok(editor, 'the custom editor is not contributed');
		const patterns = editor.selector.map((s) => s.filenamePattern);
		assert.deepStrictEqual(patterns, ['*.md', '*.markdown']);
	});

	test('ships its localization bundles', async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension);
		// A missing bundle is invisible in an English VS Code and turns the whole
		// UI into raw `%key%` placeholders in a Japanese one, so its presence is
		// asserted rather than assumed.
		for (const name of ['package.nls.json', 'package.nls.ja.json']) {
			const uri = vscode.Uri.joinPath(extension.extensionUri, name);
			await vscode.workspace.fs.stat(uri);
		}
	});

	test('resolves every manifest placeholder', async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension);
		const uri = vscode.Uri.joinPath(extension.extensionUri, 'package.nls.json');
		const bundle = JSON.parse(
			new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)),
		) as Record<string, string>;
		// `packageJSON` is already localized by the host, so the placeholders are
		// read back out of the raw manifest on disk.
		const rawUri = vscode.Uri.joinPath(extension.extensionUri, 'package.json');
		const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(rawUri));
		const used = new Set(Array.from(raw.matchAll(/"%([^%"]+)%"/g), (m) => m[1]));
		assert.ok(used.size > 0, 'the manifest uses no placeholders at all');
		for (const key of used) {
			assert.ok(key in bundle, `%${key}% has no entry in package.nls.json`);
		}
	});
});
