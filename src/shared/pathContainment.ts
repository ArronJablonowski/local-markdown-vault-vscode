/**
 * Confines a resolved file path to a directory tree.
 *
 * A `.drawio` reference is read straight out of a Markdown file the user merely
 * opened, so it can say anything — `../../../../etc/passwd`, or an absolute path
 * on Windows. Without this check the host would resolve it, read it, and hand
 * the contents to the webview, turning "open someone's notes" into an arbitrary
 * file read.
 *
 * The check has to run on the *resolved* path, because `..` segments only cancel
 * out after resolution — a raw-string test on the reference as written is
 * trivially defeated by `a/../../secret`.
 *
 * Kept apart from the `vscode` API and expressed over plain path strings so the
 * boundary cases can be unit-tested directly.
 * This is lexical only; filesystem callers must resolve symlinks separately.
 */

/**
 * Normalizes a path for comparison: separators unified, `.`/`..` resolved, and
 * (on Windows) case folded, since `C:\Notes` and `c:\notes` are the same folder
 * there but differ as strings.
 */
export function normalizePathForCompare(path: string, caseInsensitive: boolean): string {
	const parts = path.replace(/\\/g, '/').split('/');
	const stack: string[] = [];
	for (const part of parts) {
		if (part === '' || part === '.') continue;
		if (part === '..') {
			// A `..` that would climb above the root is dropped rather than kept, the
			// same way a filesystem treats it — keeping it would let `/../secret`
			// compare as a different (and seemingly outside) path than `/secret`.
			stack.pop();
			continue;
		}
		stack.push(part);
	}
	const joined = stack.join('/');
	return caseInsensitive ? joined.toLowerCase() : joined;
}

/**
 * Whether `childPath` is the directory itself or something beneath it.
 *
 * The trailing-separator comparison is what makes this a *path* test rather than
 * a string-prefix one: without it, `/home/user/notes-secret` counts as inside
 * `/home/user/notes`, because one is literally a prefix of the other.
 */
export function isPathInside(dirPath: string, childPath: string, caseInsensitive: boolean): boolean {
	const dir = normalizePathForCompare(dirPath, caseInsensitive);
	const child = normalizePathForCompare(childPath, caseInsensitive);
	if (dir === child) return true;
	if (dir === '') return true; // the filesystem root contains everything
	return child.startsWith(`${dir}/`);
}

/**
 * Resolves an already-decoded vault-relative path without allowing it to
 * introduce absolute, drive-relative, UNC, empty, or traversal segments.
 * Percent signs are intentionally left literal: filenames in the index come
 * from the filesystem, not from URL text, and `%2e%2e` may be a real filename.
 */
export function resolveVaultRelativePath(
	rootPath: string,
	relativePath: string,
	caseInsensitive: boolean,
): string | undefined {
	if (relativePath.includes('\0') || /[\r\n]/.test(relativePath)) return undefined;
	const normalized = relativePath.replace(/\\/g, '/');
	if (normalized === '') return resolve(rootPath);
	if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) return undefined;
	const segments = normalized.split('/');
	if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return undefined;
	const target = resolve(rootPath, ...segments);
	return isPathInside(rootPath, target, caseInsensitive) ? target : undefined;
}
import { resolve } from 'node:path';
