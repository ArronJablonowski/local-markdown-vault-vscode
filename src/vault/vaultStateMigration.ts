import type { BacklinkFilter, BacklinkSort } from './backlinkOrdering';
import { vaultStateKey } from './vaultStateKey';

export interface VaultStateStore {
	get<T>(key: string): T | undefined;
	update(key: string, value: unknown): PromiseLike<void>;
}

export async function migrateVaultScopedState(
	currentId: string,
	legacyIds: readonly string[],
	state: VaultStateStore,
): Promise<void> {
	const recent = vaultStateKey(currentId, 'recent');
	const filter = vaultStateKey(currentId, 'backlinks.filter');
	const sort = vaultStateKey(currentId, 'backlinks.sort');
	const migrations: Array<{ legacy: string; current: string; accept(value: unknown): boolean }> = [
		...legacyIds.flatMap((legacyId) => [
			{ legacy: vaultStateKey(legacyId, 'recent'), current: recent, accept: Array.isArray },
			{ legacy: vaultStateKey(legacyId, 'backlinks.filter'), current: filter, accept: isBacklinkFilter },
			{ legacy: vaultStateKey(legacyId, 'backlinks.sort'), current: sort, accept: isBacklinkSort },
		]),
		...[currentId, ...legacyIds].map((legacyId) => ({
			legacy: `mdLivePreview.recent.${legacyId}`,
			current: recent,
			accept: Array.isArray,
		})),
		{ legacy: 'mdLivePreview.backlinks.filter', current: filter, accept: isBacklinkFilter },
		{ legacy: 'mdLivePreview.backlinks.sort', current: sort, accept: isBacklinkSort },
	];
	for (const migration of migrations) {
		const legacy = state.get<unknown>(migration.legacy);
		// Preserve any newer choice before removing the obsolete key, making reruns harmless.
		if (state.get<unknown>(migration.current) === undefined && migration.accept(legacy)) {
			await state.update(migration.current, legacy);
		}
		if (legacy !== undefined) await state.update(migration.legacy, undefined);
	}
}

export function isBacklinkFilter(value: unknown): value is BacklinkFilter {
	return value === 'all' || value === 'linked' || value === 'unlinked';
}

export function isBacklinkSort(value: unknown): value is BacklinkSort {
	return value === 'linkedFirst' || value === 'path' || value === 'modifiedNewest';
}
