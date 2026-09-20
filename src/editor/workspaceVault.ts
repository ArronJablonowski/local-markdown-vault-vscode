import * as vscode from 'vscode';
import { classifyVaultWorkspace } from '../vault/vaultWorkspace';

/**
 * Returns the product's one supported vault root for a document. Merely being
 * inside one folder of a multi-root window is not sufficient: multi-root vault
 * selection is deferred, so granting any one folder resource authority would
 * silently invent a vault the user never selected.
 */
export function localWorkspaceVaultRoot(documentUri: vscode.Uri): vscode.Uri | undefined {
	const folders = vscode.workspace.workspaceFolders;
	if (!classifyVaultWorkspace(folders).available || documentUri.scheme !== 'file') return undefined;
	const root = folders![0].uri;
	const containing = vscode.workspace.getWorkspaceFolder(documentUri)?.uri;
	return containing?.toString() === root.toString() ? root : undefined;
}
