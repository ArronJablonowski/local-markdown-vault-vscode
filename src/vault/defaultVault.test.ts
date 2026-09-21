import { describe, expect, it } from 'vitest';
import { defaultVaultPath, shouldOpenDefaultVault } from './defaultVaultLocation';

const folder = (scheme: string) => ({ uri: { scheme } });

describe('defaultVaultPath', () => {
	it('places the default vault in the user Documents folder', () => {
		expect(defaultVaultPath('/Users/example')).toBe('/Users/example/Documents/Markdown Vault');
	});
});

describe('shouldOpenDefaultVault', () => {
	it('opens the default vault only from an empty window when enabled', () => {
		expect(shouldOpenDefaultVault(undefined, true)).toBe(true);
		expect(shouldOpenDefaultVault([], true)).toBe(true);
		expect(shouldOpenDefaultVault([folder('file')], true)).toBe(false);
		expect(shouldOpenDefaultVault([folder('vscode-remote')], true)).toBe(false);
		expect(shouldOpenDefaultVault(undefined, false)).toBe(false);
	});
});
