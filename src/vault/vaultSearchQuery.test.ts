import { describe, expect, it } from 'vitest';
import { collectBoundedSearchText, findVaultContentMatch, MAX_SEARCH_CANDIDATE_TEXT_LENGTH, parseVaultQuery, searchVaultRecords } from './vaultSearchQuery';
import type { VaultIndexRecord } from './VaultIndex';

const records: VaultIndexRecord[] = [
	{
		path: 'Projects/Launch.md', basename: 'Launch', aliases: ['Release'], headings: [{ level: 1, text: 'Security Plan', line: 2 }],
		blockIds: [], tags: ['work/active'], properties: { status: 'ready' }, links: [], searchTokens: ['security', 'launch'],
		tasks: [{ completed: false, text: 'Review threat model', line: 5 }], mtime: 2, size: 100,
	},
	{
		path: 'Archive/Old.md', basename: 'Old', aliases: [], headings: [], blockIds: [], tags: ['archive'],
		properties: { status: 'done' }, links: [], searchTokens: ['legacy'], tasks: [{ completed: true, text: 'Ship it', line: 1 }],
		mtime: 1, size: 50,
	},
];

describe('vault search query', () => {
	it('stops consuming candidate fields once the search-text budget is full', () => {
		function* fields(): Generator<string> {
			yield 'A'.repeat(MAX_SEARCH_CANDIDATE_TEXT_LENGTH);
			throw new Error('fields beyond the bound must not be consumed');
		}
		const text = collectBoundedSearchText(fields());
		expect(text).toHaveLength(MAX_SEARCH_CANDIDATE_TEXT_LENGTH);
		expect(text).toBe('a'.repeat(MAX_SEARCH_CANDIDATE_TEXT_LENGTH));
	});

	it('does not materialize later record fields after filling the candidate budget', () => {
		const properties = {} as Record<string, unknown>;
		Object.defineProperty(properties, 'late', {
			enumerable: true,
			get: () => { throw new Error('late properties must not be read'); },
		});
		const record: VaultIndexRecord = {
			...records[0],
			properties,
			searchTokens: ['x'.repeat(MAX_SEARCH_CANDIDATE_TEXT_LENGTH)],
		};
		expect(searchVaultRecords([record], 'missing')).toEqual([]);
	});

	it('supports phrases, OR, and negation', () => {
		expect(searchVaultRecords(records, '"security plan" -path:archive').map((item) => item.basename)).toEqual(['Launch']);
		expect(searchVaultRecords(records, 'file:launch OR tag:archive')).toHaveLength(2);
	});

	it('parses a negated quoted phrase without splitting or negating a literal quoted dash', () => {
		expect(parseVaultQuery('-"remote images"')?.groups).toEqual([[{
			kind: 'text', value: 'remote images', exact: true, negated: true,
		}]]);
		expect(parseVaultQuery('"-remote"')?.groups).toEqual([[{
			kind: 'text', value: '-remote', exact: true, negated: false,
		}]]);
	});

	it('does not reject a negated phrase using unordered index tokens', () => {
		const record = { ...records[0], searchTokens: ['remote', 'images'] };
		expect(searchVaultRecords([record], '-"remote images"')).toEqual([record]);
		expect(findVaultContentMatch(record, 'Remote access is allowed. Images stay local.', '-"remote images"')).toBeDefined();
		expect(findVaultContentMatch(record, 'Remote images stay local.', '-"remote images"')).toBeUndefined();
	});

	it('supports tag, task, property, and bounded regex filters', () => {
		expect(searchVaultRecords(records, 'tag:work task:open property:status=ready')).toEqual([records[0]]);
		expect(searchVaultRecords(records, '/threat\\s+model/i')).toEqual([records[0]]);
	});

	it('treats privacy-reduced property names as candidates for on-demand value checks', () => {
		const privateRecord = { ...records[0], properties: { status: null } };
		expect(searchVaultRecords([privateRecord], 'property:status=ready')).toEqual([privateRecord]);
		expect(searchVaultRecords([privateRecord], '-property:status=archived')).toEqual([privateRecord]);
		expect(findVaultContentMatch(privateRecord, '---\nstatus: ready\n---\n', 'property:status=ready')).toBeDefined();
		expect(findVaultContentMatch(privateRecord, '---\nstatus: draft\n---\n', 'property:status=ready')).toBeUndefined();
		expect(findVaultContentMatch(privateRecord, '---\nstatus: ready\n---\n', '-property:status=archived')).toBeDefined();
		expect(findVaultContentMatch(privateRecord, '---\nstatus: archived\n---\n', '-property:status=archived')).toBeUndefined();
	});

	it('executes traditional backtracking bombs through the linear-time engine', () => {
		const hostile = { ...records[0], searchTokens: [`${'a'.repeat(100_000)}!`] };
		expect(parseVaultQuery('/(a+)+$/')).toBeDefined();
		expect(parseVaultQuery('/(a|aa)+$/')).toBeDefined();
		expect(searchVaultRecords([hostile], '/(a+)+$/')).toEqual([]);
		expect(searchVaultRecords([hostile], '/(a|aa)+$/')).toEqual([]);
	});

	it('rejects unsupported, excessive, or malformed regular expressions', () => {
		expect(parseVaultQuery('/(a)\\1/')).toBeUndefined();
		expect(parseVaultQuery('/a(?=b)/')).toBeUndefined();
		expect(parseVaultQuery('/a{1,1001}/')).toBeUndefined();
		expect(parseVaultQuery('/a{1001}/')).toBeUndefined();
		expect(parseVaultQuery('/a/ii')).toBeUndefined();
		expect(parseVaultQuery(`/${'a'.repeat(129)}/`)).toBeUndefined();
	});

	it('retains useful linear-time regular expression forms', () => {
		expect(parseVaultQuery('/threat\\s+model/i')).toBeDefined();
		expect(parseVaultQuery('/(threat|risk) model/i')).toBeDefined();
		expect(parseVaultQuery('/[a-z]{1,40} plan/iu')).toBeDefined();
	});
});
