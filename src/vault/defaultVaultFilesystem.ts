import { lstat, mkdir, realpath } from 'node:fs/promises';
import type { Stats } from 'node:fs';

function sameEntry(left: Stats, right: Stats): boolean {
	return left.dev === right.dev && left.ino === right.ino;
}

/**
 * Creates the fixed first-run vault and returns the canonical directory path.
 *
 * A pre-positioned symlink named `Markdown Vault` must not redirect first-run
 * activation into an unrelated directory. The entry is identified before and
 * after canonicalization so a concurrent replacement fails closed as well.
 */
export async function createSafeDefaultVaultDirectory(path: string): Promise<string> {
	await mkdir(path, { recursive: true, mode: 0o700 });

	const before = await lstat(path);
	if (before.isSymbolicLink() || !before.isDirectory()) {
		throw new Error('The default vault path is not an ordinary directory.');
	}

	const canonicalPath = await realpath(path);
	const after = await lstat(path);
	if (after.isSymbolicLink() || !after.isDirectory() || !sameEntry(before, after)) {
		throw new Error('The default vault path changed while it was being verified.');
	}
	return canonicalPath;
}
