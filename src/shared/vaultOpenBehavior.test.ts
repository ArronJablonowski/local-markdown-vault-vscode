import { describe, expect, it } from 'vitest';
import { normalizeVaultOpenBehavior, shouldUsePreviewTab } from './vaultOpenBehavior';

describe('vault open behavior', () => {
	it('reuses one preview tab by default', () => {
		expect(normalizeVaultOpenBehavior(undefined)).toBe('reuseTab');
		expect(normalizeVaultOpenBehavior('invalid')).toBe('reuseTab');
		expect(shouldUsePreviewTab(undefined)).toBe(true);
	});

	it('keeps files in separate tabs only when explicitly selected', () => {
		expect(normalizeVaultOpenBehavior('newTab')).toBe('newTab');
		expect(shouldUsePreviewTab('newTab')).toBe(false);
	});
});
