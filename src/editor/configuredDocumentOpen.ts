import * as vscode from 'vscode';
import { shouldOpenInLivePreview } from '../shared/editorOpenPolicy';

/** Opens an already-authorized local resource using the user's editor policy. */
export async function openConfiguredVaultResource(uri: vscode.Uri): Promise<void> {
	const configuredEditor = vscode.workspace
		.getConfiguration('mdLivePreview', uri)
		.get<string>('defaultEditor', 'prompt');
	if (shouldOpenInLivePreview(uri.path, configuredEditor)) {
		await vscode.commands.executeCommand('vscode.openWith', uri, 'mdLivePreview.editor');
		return;
	}
	await vscode.commands.executeCommand('vscode.open', uri);
}
