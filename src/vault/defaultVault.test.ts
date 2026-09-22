import { describe, expect, it } from 'vitest';
import { join, parse } from 'node:path';
import { defaultVaultPath, shouldOpenDefaultVault } from './defaultVaultLocation';

const folder = (scheme: string) => ({ uri: { scheme } });

describe('defaultVaultPath', () => {
	it('places the default vault in the user Documents folder', () => {
		const homeDirectory = join(parse(process.cwd()).root, 'Users', 'example');
		expect(defaultVaultPath(homeDirectory)).toBe(join(homeDirectory, 'Documents', 'Markdown Vault'));
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
