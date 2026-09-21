import { join } from 'node:path';

export const DEFAULT_VAULT_FOLDER_NAME = 'Markdown Vault';

interface WorkspaceFolderLike {
	readonly uri: { readonly scheme: string };
}

/** Returns the fixed, local-first vault location used for an empty VS Code window. */
export function defaultVaultPath(homeDirectory: string): string {
	return join(homeDirectory, 'Documents', DEFAULT_VAULT_FOLDER_NAME);
}

/** Existing workspaces always win: bootstrap only a genuinely empty window. */
export function shouldOpenDefaultVault(
	folders: readonly WorkspaceFolderLike[] | undefined,
	enabled: boolean,
): boolean {
	return enabled && (!folders || folders.length === 0);
}
