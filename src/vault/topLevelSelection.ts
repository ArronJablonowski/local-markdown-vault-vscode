/** Keep a selected folder's descendants inside it rather than moving them twice. */
export function topLevelSelection<T>(
	items: readonly T[], path: (item: T) => string, isFolder: (item: T) => boolean,
): T[] {
	const folders = items.filter(isFolder).map(item => `${path(item)}/`);
	return items.filter(item => !folders.some(prefix => path(item).startsWith(prefix)));
}
