import { describe, expect, it } from 'vitest';
import { classifyVaultWorkspace, isCurrentVaultWorkspace } from './vaultWorkspace';

const folder = (scheme: string, path = 'vault') => ({
	uri: { scheme, toString: () => `${scheme}:/${path}` },
});

describe('classifyVaultWorkspace', () => {
	it.each([
		[undefined, 'noWorkspace'],
		[[], 'noWorkspace'],
		[[folder('file'), folder('file')], 'multipleWorkspaces'],
		[[folder('file'), folder('vscode-remote')], 'multipleWorkspaces'],
		[[folder('vscode-remote')], 'nonLocalWorkspace'],
		[[folder('vscode-vfs')], 'nonLocalWorkspace'],
	] as const)('rejects unsupported workspace %# as %s', (folders, reason) => {
		expect(classifyVaultWorkspace(folders)).toEqual({ available: false, reason });
	});

	it('accepts exactly one local file workspace', () => {
		expect(classifyVaultWorkspace([folder('file')])).toEqual({ available: true });
	});
});

describe('isCurrentVaultWorkspace', () => {
	it('accepts only the exact current single local root', () => {
		expect(isCurrentVaultWorkspace([folder('file')], 'file:/vault')).toBe(true);
		expect(isCurrentVaultWorkspace([folder('file')], 'file:/other')).toBe(false);
		expect(isCurrentVaultWorkspace([folder('file'), folder('file', 'other')], 'file:/vault')).toBe(false);
		expect(isCurrentVaultWorkspace([folder('vscode-remote')], 'vscode-remote:/vault')).toBe(false);
		expect(isCurrentVaultWorkspace(undefined, 'file:/vault')).toBe(false);
	});
});
