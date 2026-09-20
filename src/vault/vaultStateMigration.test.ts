import { describe, expect, it } from 'vitest';
import { vaultStateKey } from './vaultStateKey';
import { migrateVaultScopedState, type VaultStateStore } from './vaultStateMigration';

class MemoryState implements VaultStateStore {
	constructor(readonly values = new Map<string, unknown>()) {}
	get<T>(key: string): T | undefined { return this.values.get(key) as T | undefined; }
	async update(key: string, value: unknown): Promise<void> {
		if (value === undefined) this.values.delete(key);
		else this.values.set(key, value);
	}
}

describe('vault state migration', () => {
	const current = 'a'.repeat(64);
	const legacy = 'b'.repeat(64);

	it('moves path-hash-scoped state into the canonical-URI namespace', async () => {
		const state = new MemoryState(new Map<string, unknown>([
			[vaultStateKey(legacy, 'recent'), ['Note.md']],
			[vaultStateKey(legacy, 'backlinks.filter'), 'linked'],
			[vaultStateKey(legacy, 'backlinks.sort'), 'path'],
		]));
		await migrateVaultScopedState(current, [legacy], state);
		expect(state.get(vaultStateKey(current, 'recent'))).toEqual(['Note.md']);
		expect(state.get(vaultStateKey(current, 'backlinks.filter'))).toBe('linked');
		expect(state.get(vaultStateKey(current, 'backlinks.sort'))).toBe('path');
		expect([...state.values.keys()]).not.toContain(vaultStateKey(legacy, 'recent'));
	});

	it('preserves current values while deleting stale and invalid legacy values', async () => {
		const currentKey = vaultStateKey(current, 'backlinks.filter');
		const legacyKey = vaultStateKey(legacy, 'backlinks.filter');
		const state = new MemoryState(new Map<string, unknown>([
			[currentKey, 'unlinked'],
			[legacyKey, 'linked'],
			['mdLivePreview.backlinks.sort', 'invalid'],
		]));
		await migrateVaultScopedState(current, [legacy], state);
		expect(state.get(currentKey)).toBe('unlinked');
		expect(state.get(legacyKey)).toBeUndefined();
		expect(state.get('mdLivePreview.backlinks.sort')).toBeUndefined();
		expect(state.get(vaultStateKey(current, 'backlinks.sort'))).toBeUndefined();
	});

	it('migrates the oldest recent-note and global Backlinks keys', async () => {
		const state = new MemoryState(new Map<string, unknown>([
			[`mdLivePreview.recent.${legacy}`, ['Old.md']],
			['mdLivePreview.backlinks.filter', 'all'],
			['mdLivePreview.backlinks.sort', 'modifiedNewest'],
		]));
		await migrateVaultScopedState(current, [legacy], state);
		expect(state.get(vaultStateKey(current, 'recent'))).toEqual(['Old.md']);
		expect(state.get(vaultStateKey(current, 'backlinks.filter'))).toBe('all');
		expect(state.get(vaultStateKey(current, 'backlinks.sort'))).toBe('modifiedNewest');
	});
});
