import { describe, expect, it } from 'vitest';
import { linkReplacementsForMove, rewriteLinksForMoves, type VaultMove } from './linkRewrite';

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
