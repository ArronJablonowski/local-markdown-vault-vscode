import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'arronjablonowski.local-markdown-vault';

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
			'mdLivePreview.vault.open',
			'mdLivePreview.vault.newNote',
			'mdLivePreview.vault.newFolder',
			'mdLivePreview.vault.refresh',
			'mdLivePreview.vault.expandAll',
			'mdLivePreview.vault.collapseAll',
			'mdLivePreview.vault.rename',
			'mdLivePreview.vault.move',
			'mdLivePreview.vault.delete',
			'mdLivePreview.vault.copyRelativePath',
			'mdLivePreview.vault.revealInOS',
			'mdLivePreview.quickSwitcher',
			'mdLivePreview.vaultSearch',
			'mdLivePreview.vault.rebuildIndex',
			'mdLivePreview.backlinks.filter',
			'mdLivePreview.backlinks.sort',
			'mdLivePreview.showDiagnostics',
			'mdLivePreview.caseAwareRedo',
		]) {
			assert.ok(commands.includes(id), `command ${id} is not registered`);
		}
	});

	test('routes text-editor redo through the case-rename coordinator only while needed', () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension);
		const bindings = extension.packageJSON.contributes.keybindings as Array<{
			command: string;
			key: string;
			mac?: string;
			when?: string;
		}>;
		const redo = bindings.filter((binding) => binding.command === 'mdLivePreview.caseAwareRedo');
		assert.strictEqual(redo.length, 2);
		assert.ok(redo.some((binding) => binding.key === 'ctrl+y' && binding.mac === 'cmd+shift+z'));
		assert.ok(redo.some((binding) => binding.key === 'ctrl+shift+z'));
		for (const binding of redo) {
			assert.match(binding.when ?? '', /editorTextFocus/);
			assert.match(binding.when ?? '', /isWorkspaceTrusted/);
			assert.match(binding.when ?? '', /mdLivePreview\.caseRenameRedoAvailable/);
		}
	});

	test('contributes a trusted-workspace Move action to vault item menus', () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension);
		const menus = extension.packageJSON.contributes.menus as Record<string, Array<{
			command: string;
			when?: string;
			group?: string;
		}>>;
		const move = menus['view/item/context']?.find((item) => item.command === 'mdLivePreview.vault.move');
		assert.ok(move, 'the vault Move action is not contributed');
		assert.match(move.when ?? '', /view == mdLivePreview\.vault/);
		assert.match(move.when ?? '', /isWorkspaceTrusted/);
	});

	test('contributes its settings with the documented defaults', () => {
		const config = vscode.workspace.getConfiguration('mdLivePreview');
		assert.strictEqual(config.get('codeTheme'), 'auto');
		assert.strictEqual(config.get('defaultEditor'), 'prompt');
		assert.strictEqual(config.get('remoteMedia'), 'block');
		assert.strictEqual(config.get('diagramRendering'), 'safe');
		assert.strictEqual(config.get('vault.updateLinksOnMove'), true);
		assert.strictEqual(config.get('vault.attachmentFolder'), 'assets');
		assert.strictEqual(config.get('vault.sortOrder'), 'nameAsc');
		assert.strictEqual(config.get('vault.autoReveal'), true);
		assert.strictEqual(config.get('diagnostics.enabled'), false);
		// `enabledStyles` is application-scoped, so a real installation's value
		// leaks into the test window; only its type is worth asserting.
		assert.ok(Array.isArray(config.get('enabledStyles')));
	});

	test('keeps diagnostics opt-in and application-scoped', () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension);
		const configuration = extension.packageJSON.contributes.configuration as {
			properties: Record<string, { default?: unknown; scope?: string }>;
		};
		const diagnostics = configuration.properties['mdLivePreview.diagnostics.enabled'];
		assert.strictEqual(diagnostics?.default, false);
		assert.strictEqual(diagnostics?.scope, 'application');
	});

	test('declares limited untrusted-workspace support', () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension);
		const capabilities = extension.packageJSON.capabilities as {
			untrustedWorkspaces?: { supported?: string; restrictedConfigurations?: string[] };
			virtualWorkspaces?: { supported?: boolean };
		};
		assert.strictEqual(capabilities.untrustedWorkspaces?.supported, 'limited');
		assert.ok(capabilities.untrustedWorkspaces?.restrictedConfigurations?.includes('mdLivePreview.remoteMedia'));
		assert.ok(capabilities.untrustedWorkspaces?.restrictedConfigurations?.includes('mdLivePreview.diagramRendering'));
		assert.strictEqual(capabilities.virtualWorkspaces?.supported, false);
	});

	test('contributes trusted file and folder Trash surfaces and keyboard shortcuts', () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension);
		const menus = extension.packageJSON.contributes.menus as Record<string, Array<{
			command: string;
			when?: string;
		}>>;
		const removeMenu = menus['view/item/context']?.find((item) => item.command === 'mdLivePreview.vault.delete');
		assert.ok(removeMenu, 'the vault Trash action is not contributed');
		assert.match(removeMenu.when ?? '', /view == mdLivePreview\.vault/);
		assert.match(removeMenu.when ?? '', /isWorkspaceTrusted/);
		for (const contextValue of ['vaultFile', 'vaultFolder', 'vaultSymlink']) {
			assert.match(removeMenu.when ?? '', new RegExp(`viewItem == ${contextValue}`));
		}
		const bindings = extension.packageJSON.contributes.keybindings as Array<{
			command: string;
			key: string;
			mac?: string;
			when?: string;
		}>;
		const rename = bindings.find((binding) => binding.command === 'mdLivePreview.vault.rename');
		const remove = bindings.find((binding) => binding.command === 'mdLivePreview.vault.delete');
		assert.strictEqual(rename?.key, 'f2');
		assert.strictEqual(remove?.key, 'delete');
		assert.strictEqual(remove?.mac, 'cmd+backspace');
		assert.match(rename?.when ?? '', /isWorkspaceTrusted/);
		assert.match(remove?.when ?? '', /isWorkspaceTrusted/);
	});

	test('scopes knowledge shortcuts to every extension view', () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension);
		const bindings = extension.packageJSON.contributes.keybindings as Array<{
			command: string;
			key: string;
			mac?: string;
			when?: string;
		}>;
		for (const command of ['mdLivePreview.quickSwitcher', 'mdLivePreview.vaultSearch']) {
			const binding = bindings.find((candidate) => candidate.command === command);
			assert.ok(binding, `${command} has no keybinding`);
			assert.match(binding.when ?? '', /activeCustomEditorId == mdLivePreview\.editor/);
			for (const view of ['vault', 'backlinks', 'brokenLinks', 'tags', 'outline', 'styleManager']) {
				assert.match(binding.when ?? '', new RegExp(`focusedView == mdLivePreview\\.${view}`));
			}
		}
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
