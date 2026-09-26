import { describe, expect, it } from 'vitest';
import { linkReplacementsForMove, rewriteLinksForMoves, type VaultMove } from './linkRewrite';
import { assignWikiTargets } from './vaultMovePlan';

function apply(text: string, source: string, move: VaultMove): string {
	let result = text;
	for (const edit of linkReplacementsForMove(text, source, move)) {
		result = result.slice(0, edit.from) + edit.text + result.slice(edit.to);
	}
	return result;
}

describe('vault link rewriting', () => {
	it('updates relative Markdown links after a target rename', () => {
		expect(apply('[Roadmap](../Plans/Old.md#next)', 'Notes/Index.md', {
			oldPath: 'Plans/Old.md', newPath: 'Plans/New.md', isFolder: false,
		})).toBe('[Roadmap](../Plans/New.md#next)');
	});

	it('keeps bare Markdown links valid when the new filename contains spaces and URL delimiters', () => {
		expect(apply('[target](Old.md#heading "Keep title")', 'Index.md', {
			oldPath: 'Old.md', newPath: 'Plans/New note #1? (draft) 100%.md', isFolder: false,
		})).toBe('[target](Plans/New%20note%20%231%3F%20%28draft%29%20100%25.md#heading "Keep title")');
	});

	it('escapes filename delimiters without changing readable angle-wrapped link spaces or Unicode', () => {
		expect(apply('![image](<Old image.png#caption>)', 'Index.md', {
			oldPath: 'Old image.png', newPath: 'Café image #2? 50%.png', isFolder: false,
		})).toBe('![image](<Café image %232%3F 50%25.png#caption>)');
	});

	it('keeps reference definitions valid when a containing directory gains whitespace', () => {
		expect(apply('[reference][id]\n[id]: Old/Note.md "Keep title"', 'Index.md', {
			oldPath: 'Old', newPath: 'New folder', isFolder: true,
		})).toBe('[reference][id]\n[id]: New%20folder/Note.md "Keep title"');
	});

	it.each(['Report (draft).md', 'Report (draft (review)).md'])('rewrites balanced-parenthesis destinations: %s', name => {
		const authored = name.replace(/ /g, '%20');
		expect(apply(`[target](${authored}#next "Keep title")`, 'Index.md', {
			oldPath: name, newPath: 'Archive/Final (review).md', isFolder: false,
		})).toBe('[target](Archive/Final%20%28review%29.md#next "Keep title")');
	});

	it('rewrites escaped parentheses and punctuation using the actual filesystem name', () => {
		expect(apply('[target](Report\\(draft\\)\\!.md#next)', 'Index.md', {
			oldPath: 'Report(draft)!.md', newPath: 'Final (approved).md', isFolder: false,
		})).toBe('[target](Final%20%28approved%29.md#next)');
	});

	it('normalizes escaped punctuation in reference definitions without changing their title', () => {
		expect(apply('[target][id]\n[id]: Report\\(draft\\).md "Keep title"', 'Index.md', {
			oldPath: 'Report(draft).md', newPath: 'Final (approved).md', isFolder: false,
		})).toBe('[target][id]\n[id]: Final%20%28approved%29.md "Keep title"');
	});

	it('leaves malformed or excessively nested destinations untouched', () => {
		const move = { oldPath: 'Old.md', newPath: 'New.md', isFolder: false };
		for (const input of ['[x](Old.md unexpected words)', '[x](Old.md "unclosed title)', '[x](Old.md', '[x](<Old.md)', '[x](Old.md(foo)']) {
			expect(apply(input, 'Index.md', move)).toBe(input);
		}
		const name = `${'('.repeat(33)}Old${')'.repeat(33)}.md`;
		expect(apply(`[x](${name})`, 'Index.md', { oldPath: name, newPath: 'New.md', isFolder: false })).toBe(`[x](${name})`);
	});

	it('preserves parenthesized link examples in fenced blocks and inline code', () => {
		const input = '`[inline](Report(draft).md)`\n```md\n[fenced](Report\\(draft\\).md)\n```\n[real](Report(draft).md)';
		expect(apply(input, 'Index.md', {
			oldPath: 'Report(draft).md', newPath: 'Final.md', isFolder: false,
		})).toBe('`[inline](Report(draft).md)`\n```md\n[fenced](Report\\(draft\\).md)\n```\n[real](Final.md)');
	});

	it('bounds long destinations and does not repeatedly scan unmatched opening brackets', () => {
		const longName = `${'x'.repeat(8192)}.md`;
		const longLink = `[x](${longName})`;
		expect(apply(longLink, 'Index.md', { oldPath: longName, newPath: 'New.md', isFolder: false })).toBe(longLink);
		const unmatched = '['.repeat(100_000);
		expect(apply(unmatched, 'Index.md', { oldPath: 'Old.md', newPath: 'New.md', isFolder: false })).toBe(unmatched);
	});

	it.each(['"Title"', "'Title'", '(Title)'])('preserves supported link title delimiters: %s', title => {
		expect(apply(`[target](Report(draft).md ${title})`, 'Index.md', {
			oldPath: 'Report(draft).md', newPath: 'Final.md', isFolder: false,
		})).toBe(`[target](Final.md ${title})`);
	});

	it('does not treat link titles or destinations as independently nested links', () => {
		const move = { oldPath: 'Old.md', newPath: 'New.md', isFolder: false };
		for (const input of [
			'[external](https://example.invalid "[example](Old.md)")',
			'[external](https://example.invalid/[example](Old.md))',
		]) expect(apply(input, 'Index.md', move)).toBe(input);
	});

	it('never rewrites Markdown destinations that escape above the vault root', () => {
		const move = { oldPath: 'Old.md', newPath: 'New.md', isFolder: false } as const;
		for (const destination of ['../Old.md', '%2e%2e/Old.md', '..\\Old.md', '%2f%2fserver/Old.md']) {
			const input = `[outside](${destination})`;
			expect(apply(input, 'Index.md', move)).toBe(input);
		}
		expect(apply('[outside](../../Old.md)', 'Notes/Index.md', move)).toBe('[outside](../../Old.md)');
		expect(apply('[inside](../Old.md)', 'Notes/Index.md', move)).toBe('[inside](../New.md)');
	});

	it('updates angle-wrapped Unicode and emoji destinations', () => {
		expect(apply('[target](<Cafe\u0301 😀.md>)', 'Fixture/Index.md', {
			oldPath: 'Fixture/Cafe\u0301 😀.md', newPath: 'Fixture/Archive/\u7814\u7a76 🧭.md', isFolder: false,
		})).toBe('[target](<Archive/\u7814\u7a76 🧭.md>)');
	});

	it('matches canonically equivalent Unicode filenames reported by the filesystem', () => {
		expect(apply('[target](<Café 😀.md>)', 'Fixture/Index.md', {
			oldPath: 'Fixture/Cafe\u0301 😀.md', newPath: 'Fixture/Archive/\u7814\u7a76 🧭.md', isFolder: false,
		})).toBe('[target](<Archive/\u7814\u7a76 🧭.md>)');
	});

	it('updates links when their containing folder moves', () => {
		expect(apply('[Home](../Home.md)', 'Notes/Daily/Today.md', {
			oldPath: 'Notes/Daily', newPath: 'Archive/Daily', isFolder: true,
		})).toBe('[Home](../../Notes/Home.md)');
	});

	it('updates wikilinks, embeds, aliases, and headings', () => {
		const input = '[[Plans/Old|Plan]] ![[Plans/Old#Next]] [[Old]]';
		expect(apply(input, 'Index.md', {
			oldPath: 'Plans/Old.md', newPath: 'Projects/New.md', isFolder: false,
		})).toBe('[[Projects/New|Plan]] ![[Projects/New#Next]] [[New]]');
	});

	it('leaves remote URLs, fragments, and code inert', () => {
		const input = '[remote](https://example.com/Old.md) [heading](#Old) `[[Old]]` \\[[Old]] \\[old](Old.md)\n```md\n[[Old]]\n```';
		expect(apply(input, 'Index.md', {
			oldPath: 'Old.md', newPath: 'New.md', isFolder: false,
		})).toBe(input);
	});

	it('does not close a long fenced block with a shorter delimiter', () => {
		const input = '````md\n```\n[inside](Old.md)\n````\n[outside](Old.md)';
		expect(apply(input, 'Index.md', {
			oldPath: 'Old.md', newPath: 'New.md', isFolder: false,
		})).toBe('````md\n```\n[inside](Old.md)\n````\n[outside](New.md)');
	});

	it('protects code spans containing shorter backtick runs', () => {
		const input = '``code ` [inside](Old.md)`` and [outside](Old.md)';
		expect(apply(input, 'Index.md', {
			oldPath: 'Old.md', newPath: 'New.md', isFolder: false,
		})).toBe('``code ` [inside](Old.md)`` and [outside](New.md)');
	});

	it('requires a matching fence character and closing-only line', () => {
		const input = '~~~~\n```\n[inside](Old.md)\n~~~~ trailing\n[still inside](Old.md)';
		expect(apply(input, 'Index.md', {
			oldPath: 'Old.md', newPath: 'New.md', isFolder: false,
		})).toBe(input);
	});

	it('uses a vault-relative wikilink when the destination basename is ambiguous', () => {
		expect(apply('[[Old]]', 'Index.md', {
			oldPath: 'Old.md',
			newPath: 'Archive/New.md',
			isFolder: false,
			wikiTarget: 'Archive/New',
		})).toBe('[[Archive/New]]');
	});

	it('preserves new root-note links when undoing a nested rename with the same basename', () => {
		const moves = assignWikiTargets([
			{ oldPath: 'Docs/B.md', newPath: 'Docs/A.md', isFolder: false },
		], ['Docs/B.md', 'B.md', 'Index.md']);
		expect(rewriteLinksForMoves('[[B]] [[B.md|Root]] ![[B#Heading]] [[Docs/B]]', 'Index.md', moves).text)
			.toBe('[[B]] [[B.md|Root]] ![[B#Heading]] [[Docs/A]]');
	});

	it('leaves ambiguous nested basename links untouched while updating qualified links', () => {
		const moves = assignWikiTargets([
			{ oldPath: 'Docs/A.md', newPath: 'Docs/B.md', isFolder: false },
		], ['Docs/A.md', 'Other/A.md']);
		expect(rewriteLinksForMoves('[[A]] [[Docs/A]] [[Other/A]]', 'Index.md', moves).text)
			.toBe('[[A]] [[Docs/B]] [[Other/A]]');
	});

	it('still rewrites an exact root wikilink when a nested duplicate exists', () => {
		const moves = assignWikiTargets([
			{ oldPath: 'A.md', newPath: 'Archive/B.md', isFolder: false },
		], ['A.md', 'Other/A.md']);
		expect(rewriteLinksForMoves('[[A]] [[A.md]] [[Other/A]]', 'Index.md', moves).text)
			.toBe('[[B]] [[B.md]] [[Other/A]]');
	});

	it('uses the disambiguated destination for nested basename links and preserves explicit extensions', () => {
		const moves = assignWikiTargets([
			{ oldPath: 'Docs/A.markdown', newPath: 'Docs/B.markdown', isFolder: false },
		], ['Docs/A.markdown', 'B.md']);
		expect(rewriteLinksForMoves('[[A]] [[A.markdown|Label]] ![[A#Heading|320]]', 'Index.md', moves).text)
			.toBe('[[Docs/B]] [[Docs/B.markdown|Label]] ![[Docs/B#Heading|320]]');
	});

	it('does not assign ambiguous extensionless root links to one of two Markdown extensions', () => {
		const moves = assignWikiTargets([
			{ oldPath: 'A.md', newPath: 'B.md', isFolder: false },
		], ['A.md', 'A.markdown']);
		expect(rewriteLinksForMoves('[[A]]', 'Index.md', moves).text).toBe('[[A]]');
	});

	it('respects case-insensitive wikilink resolution on case-sensitive filesystems', () => {
		const moves = assignWikiTargets([
			{ oldPath: 'Docs/B.md', newPath: 'Docs/A.md', isFolder: false },
		], ['Docs/B.md', 'b.md', 'a.md'], false);
		expect(rewriteLinksForMoves('[[B]] [[Docs/B]]', 'Index.md', moves).text)
			.toBe('[[B]] [[Docs/A]]');
		expect(moves[0].wikiTarget).toBe('Docs/A');
	});

	it('preserves extensionless wikilinks for .markdown notes', () => {
		expect(apply('[[Old]]', 'Index.md', {
			oldPath: 'Old.markdown',
			newPath: 'Archive/New.markdown',
			isFolder: false,
		})).toBe('[[New]]');
	});

	it('preserves basename-only wikilinks for nested .markdown notes', () => {
		expect(apply('[[Old]]', 'Index.md', {
			oldPath: 'Notes/Old.markdown',
			newPath: 'Archive/New.markdown',
			isFolder: false,
		})).toBe('[[New]]');
	});

	it('preserves encoded Markdown metadata and wikilink embed dimensions', () => {
		expect(apply('![label](Old%20Name.md#part "title")', 'Index.md', {
			oldPath: 'Old Name.md', newPath: 'Archive/New Name.md', isFolder: false,
		})).toBe('![label](Archive/New%20Name.md#part "title")');
		expect(apply('![[Old Name#part|320]]', 'Index.md', {
			oldPath: 'Old Name.md', newPath: 'Archive/New Name.md', isFolder: false,
		})).toBe('![[New Name#part|320]]');
	});

	it('rewrites reference definitions and root-relative links', () => {
		const input = '[x][id]\n[id]: /Docs/Old.md "title"';
		expect(apply(input, 'Index.md', {
			oldPath: 'Docs/Old.md', newPath: 'Docs/New.md', isFolder: false,
		})).toBe('[x][id]\n[id]: /Docs/New.md "title"');
	});

	it('rewrites multiple independent targets and links inside moved notes', () => {
		const moves: VaultMove[] = [
			{ oldPath: 'A.md', newPath: 'Archive/A.md', isFolder: false },
			{ oldPath: 'B.md', newPath: 'Archive/B.md', isFolder: false },
		];
		const result = rewriteLinksForMoves('[A](A.md) [B](B.md)', 'A.md', moves);
		expect(result.text).toBe('[A](A.md) [B](B.md)');
		expect(result.sourcePath).toBe('Archive/A.md');
	});

	it('updates links from an unmoved note for every selected move', () => {
		const result = rewriteLinksForMoves('[[A]] and [B](B.md)', 'Index.md', [
			{ oldPath: 'A.md', newPath: 'Archive/A.md', isFolder: false },
			{ oldPath: 'B.md', newPath: 'Archive/B.md', isFolder: false },
		]);
		expect(result.text).toBe('[[A]] and [B](Archive/B.md)');
		expect(result.sourcePath).toBe('Index.md');
	});
});
