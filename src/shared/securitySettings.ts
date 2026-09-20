import type { RemoteMediaPolicy } from './messages';

export interface InspectedSetting<T> {
	workspaceValue?: T;
	workspaceFolderValue?: T;
}

/**
 * Network permission is intentionally not inherited from user/global settings.
 * A workspace (or its folder in a multi-root window) must opt in explicitly,
 * and Restricted Mode always wins over configuration.
 */
export function resolveWorkspaceRemoteMediaPolicy(
	trusted: boolean,
	inspected: InspectedSetting<RemoteMediaPolicy> | undefined,
): RemoteMediaPolicy {
	if (!trusted) return 'block';
	const local = inspected?.workspaceFolderValue ?? inspected?.workspaceValue;
	return local === 'https' ? 'https' : 'block';
}
