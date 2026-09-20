import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'arronjablonowski.local-markdown-vault';
const restrictedOnly = process.env.MDLP_RESTRICTED_TEST === '1' ? test : test.skip;

suite('Restricted Mode extension host', () => {
	restrictedOnly('runs in a genuinely untrusted workspace with limited extension support', async () => {
		assert.strictEqual(vscode.workspace.isTrusted, false, 'the restricted runner accidentally trusted the workspace');
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, `extension ${EXTENSION_ID} is not installed`);
		await extension.activate();
		assert.strictEqual(extension.isActive, true, 'the limited extension did not activate');
	});

	restrictedOnly('keeps plain Markdown and Live Preview available', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root, 'the restricted runner did not open its fixture workspace');
		const note = vscode.Uri.joinPath(root, 'README.md');
		await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
		const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		assert.ok(input instanceof vscode.TabInputCustom, 'Live Preview did not open in Restricted Mode');
		assert.strictEqual(input.viewType, 'mdLivePreview.editor');
	});

	restrictedOnly('blocks Document Vault mutations before prompting for names', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root, 'the restricted runner did not open its fixture workspace');
		const before = (await vscode.workspace.fs.readDirectory(root)).map(([name]) => name).sort();
		await vscode.commands.executeCommand('mdLivePreview.vault.newFolder');
		const after = (await vscode.workspace.fs.readDirectory(root)).map(([name]) => name).sort();
		assert.deepStrictEqual(after, before, 'a vault mutation escaped the Restricted Mode guard');
	});

	restrictedOnly('blocks custom CSS creation through forged command invocation', async () => {
		const before = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		const created = await vscode.commands.executeCommand('mdLivePreview.newStyle');
		assert.strictEqual(created, undefined, 'Restricted Mode created a custom CSS theme');
		assert.strictEqual(vscode.window.tabGroups.activeTabGroup.activeTab?.input, before, 'Restricted Mode opened a CSS editor');
	});
});
