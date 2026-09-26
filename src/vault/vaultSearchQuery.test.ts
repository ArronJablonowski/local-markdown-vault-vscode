import { describe, expect, it, vi } from 'vitest';
import { collectBoundedSearchText, findParsedVaultContentMatch, findVaultContentMatch, MAX_SEARCH_CANDIDATE_TEXT_LENGTH, parseVaultQuery, searchVaultRecords } from './vaultSearchQuery';
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

	it.each(['file', 'path', 'tag', 'task', 'property'])('keeps a fully quoted %s: term literal without changing unquoted filters', (field) => {
		expect(parseVaultQuery(`"${field}:value"`)?.groups).toEqual([[{
			kind: 'text', value: `${field}:value`, exact: true, negated: false,
		}]]);
		expect(parseVaultQuery(`-"${field}:value"`)?.groups).toEqual([[{
			kind: 'text', value: `${field}:value`, exact: true, negated: true,
		}]]);
		expect(parseVaultQuery(`${field}:value`)?.groups).toEqual([[{
			kind: 'filter', field, value: 'value', negated: false,
		}]]);
	});

	it('matches quoted filter-looking content as text, including negation', () => {
		const record = { ...records[0], tags: ['value'], searchTokens: ['tag:value'] };
		expect(findVaultContentMatch(record, 'Documented syntax: tag:value', '"tag:value"')).toEqual({ index: 19, length: 9 });
		expect(findVaultContentMatch(record, 'No filter-looking text here.', '"tag:value"')).toBeUndefined();
		expect(findVaultContentMatch(record, 'No filter-looking text here.', 'tag:value')).toBeDefined();
		expect(findVaultContentMatch(record, 'Documented syntax: tag:value', '-"tag:value"')).toBeUndefined();
		expect(findVaultContentMatch(record, 'No filter-looking text here.', '-"tag:value"')).toBeDefined();
		expect(searchVaultRecords([record], '"tag:value"')).toEqual([record]);
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

	it('preserves metadata case for regular expressions without affecting case-insensitive text queries', () => {
		const record = { ...records[0], path: 'Notes/Security.md', basename: 'Security', headings: [], aliases: [], tags: [], properties: {} };
		expect(findVaultContentMatch(record, 'Unrelated body.', '/Security/')).toEqual({ index: 0, length: 0 });
		expect(findVaultContentMatch(record, 'Unrelated body.', '/security/')).toBeUndefined();
		expect(findVaultContentMatch(record, 'Unrelated body.', '/security/i')).toEqual({ index: 0, length: 0 });
		expect(findVaultContentMatch(record, 'Unrelated body.', 'security')).toEqual({ index: 0, length: 0 });
	});

	it('maps Unicode offsets once per note even for hundreds of matching text clauses', () => {
		const text = `İ${'x'.repeat(100_000)} needle`;
		const parsed = parseVaultQuery('needle '.repeat(290))!;
		const iterate = vi.spyOn(String.prototype, Symbol.iterator);
		try {
			expect(findParsedVaultContentMatch(records[0], text, parsed)).toEqual({ index: 100_002, length: 6 });
			expect(iterate).toHaveBeenCalledTimes(1);
		} finally { iterate.mockRestore(); }
	});

	it('does not remap Unicode offsets for unsuccessful query groups', () => {
		const text = `İ${'x'.repeat(100_000)} needle`;
		const parsed = parseVaultQuery('needle absent OR needle forbidden')!;
		const iterate = vi.spyOn(String.prototype, Symbol.iterator);
		try {
			expect(findParsedVaultContentMatch(records[0], text, parsed)).toBeUndefined();
			expect(iterate).not.toHaveBeenCalled();
		} finally { iterate.mockRestore(); }
	});

	it('compares folded text and original regex offsets only after Unicode conversion', () => {
		const text = 'İ first second';
		expect(findVaultContentMatch(records[0], text, 'second /first/')).toEqual({ index: 2, length: 5 });
		expect(findVaultContentMatch(records[0], text, '/second/ first')).toEqual({ index: 2, length: 5 });
		expect(findVaultContentMatch(records[0], text, '/fir/ first')).toEqual({ index: 2, length: 3 });
		expect(findVaultContentMatch(records[0], text, 'first /fir/')).toEqual({ index: 2, length: 5 });
	});
});
