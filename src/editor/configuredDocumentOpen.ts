import * as vscode from 'vscode';
import { configuredEditorViewTypeForPath } from '../shared/editorOpenPolicy';

/** Opens an already-authorized local resource using the user's editor policy. */
export async function openConfiguredVaultResource(uri: vscode.Uri): Promise<void> {
	const configuredEditor = vscode.workspace
		.getConfiguration('mdLivePreview', uri)
		.get<string>('defaultEditor', 'prompt');
	const viewType = configuredEditorViewTypeForPath(uri.path, configuredEditor);
	if (viewType) {
		await vscode.commands.executeCommand('vscode.openWith', uri, viewType);
		return;
	}
	await vscode.commands.executeCommand('vscode.open', uri);
}
