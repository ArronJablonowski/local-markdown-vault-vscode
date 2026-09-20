import { describe, expect, it } from 'vitest';
import { filterAndSortBacklinks } from './backlinkOrdering';

const items = [
	{ linked: false, record: { path: 'Notes/Zeta.md', mtime: 3 } },
	{ linked: true, record: { path: 'Notes/Beta.md', mtime: 1 } },
	{ linked: true, record: { path: 'Notes/Alpha.md', mtime: 2 } },
];

describe('backlink filtering and sorting', () => {
	it('filters linked and unlinked mentions independently', () => {
		expect(filterAndSortBacklinks(items, 'linked', 'path').map((item) => item.record.path)).toEqual(['Notes/Alpha.md', 'Notes/Beta.md']);
		expect(filterAndSortBacklinks(items, 'unlinked', 'path').map((item) => item.record.path)).toEqual(['Notes/Zeta.md']);
	});

	it('sorts linked-first, path, or newest without mutating the input', () => {
		expect(filterAndSortBacklinks(items, 'all', 'linkedFirst').map((item) => item.record.path)).toEqual(['Notes/Alpha.md', 'Notes/Beta.md', 'Notes/Zeta.md']);
		expect(filterAndSortBacklinks(items, 'all', 'modifiedNewest').map((item) => item.record.path)).toEqual(['Notes/Zeta.md', 'Notes/Alpha.md', 'Notes/Beta.md']);
		expect(items[0].record.path).toBe('Notes/Zeta.md');
	});
});
