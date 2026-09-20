import { describe, expect, it } from 'vitest';
import { resolveWorkspaceRemoteMediaPolicy } from './securitySettings';

describe('resolveWorkspaceRemoteMediaPolicy', () => {
	it('blocks by default and ignores inherited global permission', () => {
		expect(resolveWorkspaceRemoteMediaPolicy(true, undefined)).toBe('block');
		expect(resolveWorkspaceRemoteMediaPolicy(true, {})).toBe('block');
	});

	it('allows HTTPS only from an explicit workspace or workspace-folder value', () => {
		expect(resolveWorkspaceRemoteMediaPolicy(true, { workspaceValue: 'https' })).toBe('https');
		expect(resolveWorkspaceRemoteMediaPolicy(true, {
			workspaceValue: 'block',
			workspaceFolderValue: 'https',
		})).toBe('https');
		expect(resolveWorkspaceRemoteMediaPolicy(true, {
			workspaceValue: 'https',
			workspaceFolderValue: 'block',
		})).toBe('block');
	});

	it('forces blocking in Restricted Mode', () => {
		expect(resolveWorkspaceRemoteMediaPolicy(false, { workspaceValue: 'https' })).toBe('block');
		expect(resolveWorkspaceRemoteMediaPolicy(false, { workspaceFolderValue: 'https' })).toBe('block');
	});
});
