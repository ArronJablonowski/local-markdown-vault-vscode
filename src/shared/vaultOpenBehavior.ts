export type VaultOpenBehavior = 'reuseTab' | 'newTab';

export const DEFAULT_VAULT_OPEN_BEHAVIOR: VaultOpenBehavior = 'reuseTab';

export function normalizeVaultOpenBehavior(value: string | undefined): VaultOpenBehavior {
	return value === 'newTab' ? 'newTab' : DEFAULT_VAULT_OPEN_BEHAVIOR;
}

export function shouldUsePreviewTab(value: string | undefined): boolean {
	// Request VS Code's reusable preview slot; pinned and dirty tabs remain native decisions.
	return normalizeVaultOpenBehavior(value) === 'reuseTab';
}
