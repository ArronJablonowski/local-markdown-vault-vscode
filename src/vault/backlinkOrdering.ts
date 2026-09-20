export type BacklinkFilter = 'all' | 'linked' | 'unlinked';
export type BacklinkSort = 'linkedFirst' | 'path' | 'modifiedNewest';

export interface BacklinkOrderItem {
	linked: boolean;
	record: { path: string; mtime: number };
}

export function filterAndSortBacklinks<T extends BacklinkOrderItem>(
	items: readonly T[],
	filter: BacklinkFilter,
	sort: BacklinkSort,
): T[] {
	return items
		.filter((item) => filter === 'all' || (filter === 'linked' ? item.linked : !item.linked))
		.sort((a, b) => {
			if (sort === 'linkedFirst') {
				const kind = Number(b.linked) - Number(a.linked);
				if (kind) return kind;
			}
			if (sort === 'modifiedNewest') {
				const modified = b.record.mtime - a.record.mtime;
				if (modified) return modified;
			}
			return a.record.path.localeCompare(b.record.path, undefined, { numeric: true, sensitivity: 'base' });
		});
}
