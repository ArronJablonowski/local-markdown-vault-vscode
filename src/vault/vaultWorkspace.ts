export type VaultUnavailableReason = 'noWorkspace' | 'multipleWorkspaces' | 'nonLocalWorkspace';

interface WorkspaceFolderLike {
	readonly uri: { readonly scheme: string; toString(): string };
}

export type VaultWorkspaceClassification =
	| { readonly available: true }
	| { readonly available: false; readonly reason: VaultUnavailableReason };

/**
 * Classifies the one workspace shape supported by the initial Document Vault.
 *
 * Kept independent of the VS Code runtime so every caller—filesystem service,
 * editor resource policy, and native tree—uses the same fail-closed decision.
 * Canonical filesystem resolution is a separate step performed only after this
 * admits exactly one local `file:` folder.
 */
export function classifyVaultWorkspace(
	folders: readonly WorkspaceFolderLike[] | undefined,
): VaultWorkspaceClassification {
	if (!folders || folders.length === 0) return { available: false, reason: 'noWorkspace' };
	if (folders.length !== 1) return { available: false, reason: 'multipleWorkspaces' };
	if (folders[0].uri.scheme !== 'file') return { available: false, reason: 'nonLocalWorkspace' };
	return { available: true };
}

/** Checks that a previously issued vault capability still names this window's vault. */
export function isCurrentVaultWorkspace(
	folders: readonly WorkspaceFolderLike[] | undefined,
	rootUri: string,
): boolean {
	return classifyVaultWorkspace(folders).available && folders![0].uri.toString() === rootUri;
}
