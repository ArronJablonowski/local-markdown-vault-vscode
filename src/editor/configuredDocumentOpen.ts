import * as vscode from 'vscode';
import { configuredEditorViewTypeForPath, DEFAULT_EDITOR_SETTING } from '../shared/editorOpenPolicy';

/** Opens an already-authorized local resource using the user's editor policy. */
export async function openConfiguredVaultResource(uri: vscode.Uri): Promise<void> {
	const configuredEditor = vscode.workspace
		.getConfiguration('mdLivePreview', uri)
		.get<string>('defaultEditor', DEFAULT_EDITOR_SETTING);
	const viewType = configuredEditorViewTypeForPath(uri.path, configuredEditor);
	if (viewType) {
		await vscode.commands.executeCommand('vscode.openWith', uri, viewType);
		return;
	}
	await vscode.commands.executeCommand('vscode.open', uri);
}
