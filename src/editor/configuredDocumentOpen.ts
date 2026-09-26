import * as vscode from 'vscode';
import { configuredEditorViewTypeForPath, DEFAULT_EDITOR_SETTING } from '../shared/editorOpenPolicy';
import { DEFAULT_VAULT_OPEN_BEHAVIOR, shouldUsePreviewTab } from '../shared/vaultOpenBehavior';

/** Opens an already-authorized local resource using the user's editor policy. */
export async function openConfiguredVaultResource(uri: vscode.Uri): Promise<void> {
	// Read per-resource settings at navigation time so existing tabs do not pin old preferences.
	const configuredEditor = vscode.workspace
		.getConfiguration('mdLivePreview', uri)
		.get<string>('defaultEditor', DEFAULT_EDITOR_SETTING);
	const viewType = configuredEditorViewTypeForPath(uri.path, configuredEditor);
	const openBehavior = vscode.workspace
		.getConfiguration('mdLivePreview', uri)
		.get<string>('vault.openBehavior', DEFAULT_VAULT_OPEN_BEHAVIOR);
	const options: vscode.TextDocumentShowOptions = { preview: shouldUsePreviewTab(openBehavior) };
	if (viewType) {
		await vscode.commands.executeCommand('vscode.openWith', uri, viewType, options);
		return;
	}
	await vscode.commands.executeCommand('vscode.open', uri, options);
}
