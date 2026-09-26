import { realpath } from 'node:fs/promises';
import { isPathInside } from '../shared/pathContainment';

/** Authorizes two existing filesystem paths only after resolving symlinks. */
export async function isCanonicalPathInside(rootPath: string, targetPath: string): Promise<boolean> {
	try {
		const [realRoot, realTarget] = await Promise.all([realpath(rootPath), realpath(targetPath)]);
		return isPathInside(realRoot, realTarget, process.platform === 'win32');
	} catch {
		// Missing or unreadable paths are not evidence of containment.
		return false;
	}
}
