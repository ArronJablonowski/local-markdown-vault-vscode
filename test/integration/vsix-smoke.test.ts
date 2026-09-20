import * as assert from 'assert';
import * as vscode from 'vscode';
import { isAbsolute, relative } from 'node:path';

const EXTENSION_ID = 'arronjablonowski.local-markdown-vault';
const mode = process.env.MDLP_VSIX_SMOKE_MODE;
const vsixOnly = mode === 'trusted' || mode === 'restricted' ? test : test.skip;

suite('Installed VSIX clean-profile smoke', () => {
	vsixOnly('loads the packaged extension rather than the development checkout', async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, `extension ${EXTENSION_ID} is not installed`);
		const installedRoot = process.env.MDLP_VSIX_EXTENSIONS_DIR;
		assert.ok(installedRoot, 'the VSIX smoke runner did not identify its isolated extension directory');
		const installedRelative = relative(installedRoot, extension.extensionPath);
		assert.ok(
			installedRelative && !isAbsolute(installedRelative) && installedRelative !== '..' &&
				!installedRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`),
			`the target extension was not loaded from the isolated VSIX directory: ${extension.extensionPath}`,
		);
		assert.strictEqual(extension.packageJSON.version, process.env.MDLP_VSIX_VERSION);
		const productionApi = await extension.activate();
		assert.strictEqual(extension.isActive, true);
		assert.strictEqual(productionApi, undefined, 'the packaged extension exposed its development-only test API');
	});

	vsixOnly('opens packaged Live Preview from a clean profile', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root, 'the VSIX smoke workspace is unavailable');
		const note = vscode.Uri.joinPath(root, 'README.md');
		await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
		const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		assert.ok(input instanceof vscode.TabInputCustom, 'the packaged Live Preview custom editor did not open');
		assert.strictEqual(input.viewType, 'mdLivePreview.editor');
	});

	vsixOnly('matches the requested clean-profile trust state', async () => {
		assert.strictEqual(vscode.workspace.isTrusted, mode === 'trusted');
	});

	(mode === 'trusted' ? test : test.skip)('registers packaged vault and knowledge commands in trusted mode', async () => {
		const commands = new Set(await vscode.commands.getCommands(true));
		for (const command of [
			'mdLivePreview.vault.refresh',
			'mdLivePreview.quickSwitcher',
			'mdLivePreview.vaultSearch',
			'mdLivePreview.vault.rebuildIndex',
		]) {
			assert.ok(commands.has(command), `missing packaged command ${command}`);
		}
		await vscode.commands.executeCommand('mdLivePreview.vault.refresh');
		await vscode.commands.executeCommand('mdLivePreview.vault.rebuildIndex');
	});

	(mode === 'restricted' ? test : test.skip)('blocks packaged vault mutations in Restricted Mode', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root, 'the VSIX smoke workspace is unavailable');
		const before = (await vscode.workspace.fs.readDirectory(root)).map(([name]) => name).sort();
		await vscode.commands.executeCommand('mdLivePreview.vault.newFolder');
		const after = (await vscode.workspace.fs.readDirectory(root)).map(([name]) => name).sort();
		assert.deepStrictEqual(after, before, 'the packaged extension mutated an untrusted workspace');
	});
});
