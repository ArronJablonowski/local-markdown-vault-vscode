import { describe, expect, it } from 'vitest';
import {
	extractVaultMetadata,
	MAX_INDEX_FILE_BYTES,
	MAX_INDEX_HEADING_TEXT_LENGTH,
	MAX_INDEX_LINK_FRAGMENT_LENGTH,
	MAX_INDEX_LINK_TARGET_LENGTH,
	MAX_INDEX_SEARCH_TOKEN_LENGTH,
	MAX_INDEX_TAG_LENGTH,
	MAX_INDEX_TASK_TEXT_LENGTH,
} from './vaultMetadata';

describe('vault metadata extraction', () => {
	it('indexes Obsidian-compatible metadata without storing note content', () => {
		const metadata = extractVaultMetadata('Notes/Project.md', `---
aliases: [Launch, "Project X"]
tags: [work/active]
status: active
---
# Roadmap
See [[Specs/API#Auth|API]] and ![[Assets/diagram.png]].
- [ ] Task ^task-1 #priority/high
[Local](../Home.md#Start)
` + '```md\n[[Ignored]] #ignored\n```');
		expect(metadata.basename).toBe('Project');
		expect(metadata.aliases).toEqual(['Launch', 'Project X']);
		expect(metadata.headings).toEqual([{ level: 1, text: 'Roadmap', line: 6 }]);
		expect(metadata.blockIds).toEqual(['task-1']);
		expect(metadata.tags).toEqual(['priority/high', 'work/active']);
		expect(metadata.links).toEqual([
			{ kind: 'wikilink', target: 'Specs/API', fragment: '#Auth', line: 7 },
			{ kind: 'wikiEmbed', target: 'Assets/diagram.png', line: 7 },
			{ kind: 'markdown', target: '../Home.md', fragment: '#Start', line: 9 },
		]);
		expect(metadata.tasks).toEqual([{ completed: false, text: 'Task ^task-1 #priority/high', line: 8 }]);
		expect(metadata.properties).toEqual({ aliases: null, tags: null, status: null });
		expect(metadata).not.toHaveProperty('content');
		expect(metadata.searchTokens).toContain('roadmap');
	});

	it('never retains arbitrary frontmatter values in live index metadata', () => {
		const metadata = extractVaultMetadata('Private.md', [
			'---',
			'password: hunter2',
			'apiToken: secret-token-value',
			'status: private draft',
			'---',
			'# Private',
		].join('\n'));
		expect(metadata.properties).toEqual({ password: null, apiToken: null, status: null });
		expect(JSON.stringify(metadata)).not.toMatch(/hunter2|secret-token-value|private draft/);
	});

	it('ignores malformed YAML and code-like links safely', () => {
		const metadata = extractVaultMetadata('Bad.md', '---\naliases: [\n---\n`[[Nope]]`\n# Visible');
		expect(metadata.properties).toEqual({});
		expect(metadata.links).toEqual([]);
		expect(metadata.headings[0]?.text).toBe('Visible');
	});

	it('drops aliases and headings that cannot safely cross navigation boundaries', () => {
		const oversizedAlias = 'a'.repeat(513);
		const oversizedHeading = 'h'.repeat(MAX_INDEX_HEADING_TEXT_LENGTH + 1);
		const metadata = extractVaultMetadata('Bounded.md', [
			'---',
			'aliases:',
			'  - Safe alias',
			'  - "bad|alias"',
			'  - "bad\\nline"',
			`  - ${oversizedAlias}`,
			'---',
			`# ${oversizedHeading}`,
			'## Visible heading',
		].join('\n'));
		expect(metadata.aliases).toEqual(['Safe alias']);
		expect(metadata.headings).toEqual([{ level: 2, text: 'Visible heading', line: 9 }]);
	});

	it('drops oversized tags, tasks, link targets, and fragments at the producer boundary', () => {
		const oversizedTag = 't'.repeat(MAX_INDEX_TAG_LENGTH + 1);
		const oversizedTask = 'x'.repeat(MAX_INDEX_TASK_TEXT_LENGTH + 1);
		const oversizedTarget = 'n'.repeat(MAX_INDEX_LINK_TARGET_LENGTH + 1);
		const oversizedFragment = `#${'f'.repeat(MAX_INDEX_LINK_FRAGMENT_LENGTH)}`;
		const metadata = extractVaultMetadata('Bounded.md', [
			'---',
			`tags: [safe, ${oversizedTag}]`,
			'---',
			`#${oversizedTag}`,
			'#visible',
			`- [ ] ${oversizedTask}`,
			'- [x] bounded task',
			`[[${oversizedTarget}]]`,
			`[[Target${oversizedFragment}]]`,
			`[local](${oversizedTarget})`,
			`[fragment](Target.md${oversizedFragment})`,
			'[[Kept#Heading]]',
			'[kept](Kept.md#Heading)',
		].join('\n'));
		expect(metadata.tags).toEqual(['safe', 'visible']);
		expect(metadata.tasks).toEqual([{ completed: true, text: 'bounded task', line: 7 }]);
		expect(metadata.links).toEqual([
			{ kind: 'wikilink', target: 'Kept', fragment: '#Heading', line: 12 },
			{ kind: 'markdown', target: 'Kept.md', fragment: '#Heading', line: 13 },
		]);
	});

	it('streams unique search terms and drops individual tokens above the index limit', () => {
		const accepted = 'a'.repeat(MAX_INDEX_SEARCH_TOKEN_LENGTH);
		const rejected = 'b'.repeat(MAX_INDEX_SEARCH_TOKEN_LENGTH + 1);
		const metadata = extractVaultMetadata('Tokens.md', `${accepted} ${rejected} visible visible`);
		expect(metadata.searchTokens).toContain(accepted);
		expect(metadata.searchTokens).toContain('visible');
		expect(metadata.searchTokens).not.toContain(rejected);
		expect(metadata.searchTokens.filter((token) => token === 'visible')).toHaveLength(1);
	});

	it('keeps single-character candidate tokens for short names and punctuation aliases', () => {
		const metadata = extractVaultMetadata('C++.md', 'Use C++ with R and X.');
		expect(metadata.searchTokens).toEqual(expect.arrayContaining(['c', 'r', 'x']));
	});

	it('keeps code masked after astral Unicode characters', () => {
		const metadata = extractVaultMetadata('Unicode.md', [
			'😀 prefix `[[Inline Secret]] #inline-secret`',
			'```md',
			'😀 [[Fenced Secret]] #fenced-secret',
			'- [ ] hidden task',
			'```',
			'Visible [[Public Note]] #public-tag',
		].join('\n'));
		expect(metadata.links).toEqual([{ kind: 'wikilink', target: 'Public Note', line: 6 }]);
		expect(metadata.tags).toEqual(['public-tag']);
		expect(metadata.tasks).toEqual([]);
		expect(metadata.searchTokens).not.toContain('secret');
	});

	it('honors exact fence and inline delimiter lengths while indexing', () => {
		const metadata = extractVaultMetadata('Code.md', [
			'````md',
			'```',
			'[[Fenced Secret]] #fenced-secret',
			'````',
			'``code ` [[Inline Secret]] #inline-secret``',
			'Visible [[Public Note]] #public-tag',
		].join('\n'));
		expect(metadata.links).toEqual([{ kind: 'wikilink', target: 'Public Note', line: 6 }]);
		expect(metadata.tags).toEqual(['public-tag']);
		expect(metadata.searchTokens).not.toContain('secret');
	});

	it('does not interpret fence-like frontmatter values as body code', () => {
		const metadata = extractVaultMetadata('Frontmatter.md', [
			'---',
			'marker: "```"',
			'---',
			'Visible [[Public Note]] #public-tag',
		].join('\n'));
		expect(metadata.links).toEqual([{ kind: 'wikilink', target: 'Public Note', line: 4 }]);
		expect(metadata.tags).toEqual(['public-tag']);
	});

	it('rejects oversized files before parsing', () => {
		expect(() => extractVaultMetadata('Huge.md', 'x'.repeat(MAX_INDEX_FILE_BYTES + 1))).toThrow(/limit/);
	});

	it('aborts metadata extraction when its per-note time budget expires', () => {
		let clock = 0;
		expect(() => extractVaultMetadata(
			'Slow.md',
			Array.from({ length: 500 }, (_, index) => `line ${index} [[Note-${index}]]`).join('\n'),
			{ timeBudgetMs: 150, now: () => (clock += 100) },
		)).toThrow(/time limit/);
	});

	it('rejects invalid parser budgets instead of disabling the limit', () => {
		expect(() => extractVaultMetadata('Note.md', '# Note', { timeBudgetMs: 0 })).toThrow(/time limit/);
		expect(() => extractVaultMetadata('Note.md', '# Note', { timeBudgetMs: Number.POSITIVE_INFINITY })).toThrow(/time limit/);
	});
});
