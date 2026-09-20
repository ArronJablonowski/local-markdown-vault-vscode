import { describe, expect, it } from 'vitest';
import { buildTagTree } from './tagTree';

describe('nested tag tree', () => {
	it('groups path segments and counts each note once at every level', () => {
		expect(buildTagTree([
			{ tags: ['work/active', 'work/urgent', 'work/active'] },
			{ tags: ['work/active', 'personal'] },
		])).toEqual([
			{ segment: 'personal', path: 'personal', count: 1, children: [] },
			{
				segment: 'work', path: 'work', count: 2, children: [
					{ segment: 'active', path: 'work/active', count: 2, children: [] },
					{ segment: 'urgent', path: 'work/urgent', count: 1, children: [] },
				],
			},
		]);
	});
});
