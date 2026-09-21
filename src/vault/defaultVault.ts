import * as vscode from 'vscode';
import { homedir } from 'node:os';
import { defaultVaultPath, shouldOpenDefaultVault } from './defaultVaultLocation';

/**
 * Creates and opens the default vault on first use from an empty window.
 *
 * Opening a folder restarts the extension host, so callers must stop activation
 * when this returns true. Failures leave the empty window usable and are
 * surfaced without falling back to another filesystem location.
 */
export async function openDefaultVaultWhenNeeded(): Promise<boolean> {
	const enabled = vscode.workspace.getConfiguration('mdLivePreview.vault')
		.get<boolean>('openDefaultOnStartup', true);
	if (!shouldOpenDefaultVault(vscode.workspace.workspaceFolders, enabled)) return false;

	const uri = vscode.Uri.file(defaultVaultPath(homedir()));
	try {
		await vscode.workspace.fs.createDirectory(uri);
		await vscode.commands.executeCommand('vscode.openFolder', uri, false);
		return true;
	} catch {
		void vscode.window.showWarningMessage(vscode.l10n.t(
			'The default vault could not be created or opened in your Documents folder.',
		));
		return false;
	}
}
