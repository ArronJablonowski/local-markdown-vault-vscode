import { describe, expect, it } from 'vitest';
import { rewriteLinksForMoves } from './linkRewrite';
import { assignWikiTargets } from './vaultMovePlan';
import { validateVaultEntryName } from './vaultName';

describe('Spark review confirmed regressions', () => {
	it.each(['New#topic.md', 'New^block.md', 'New[topic].md'])('refuses a new name with wikilink delimiters: %s', name => {
		expect(validateVaultEntryName(name)).toBeTypeOf('string');
	});
	it.each([
		'    [example](Old.md)\n\n[real](Old.md)',
		'> ```md\n> [example](Old.md)\n> ```\n\n[real](Old.md)',
		'`example\n[example](Old.md)`\n\n[real](Old.md)',
	])('preserves literal examples while updating a real link: %j', text => {
		const moves = assignWikiTargets([{ oldPath: 'Old.md', newPath: 'New.md', isFolder: false }], ['Old.md', 'Index.md']);
		expect(rewriteLinksForMoves(text, 'Index.md', moves).text).toBe(text.replace('[real](Old.md)', '[real](New.md)'));
	});
	it('updates resolver-equivalent casing for basename and qualified wikilinks', () => {
		const moves = assignWikiTargets([{ oldPath: 'Docs/Old.md', newPath: 'Docs/New.md', isFolder: false }], ['Docs/Old.md', 'Index.md']);
		expect(rewriteLinksForMoves('[[old]] ![[docs/OLD#Heading]]', 'Index.md', moves).text).toBe('[[New]] ![[Docs/New#Heading]]');
	});
	it('preserves an unmoved root note when renaming its same-name folder', () => {
		const moves = assignWikiTargets([{ oldPath: 'Old', newPath: 'New', isFolder: true }], ['Old.md', 'Old/Child.md', 'Index.md']);
		expect(rewriteLinksForMoves('[[Old]] ![[Old#Heading]] [[Old/Child]] [root](Old.md)', 'Index.md', moves).text)
			.toBe('[[Old]] ![[Old#Heading]] [[New/Child]] [root](Old.md)');
	});
	it('preserves ambiguity between case-distinct Linux notes and Markdown destinations', () => {
		const moves = assignWikiTargets([{ oldPath: 'Old.md', newPath: 'New.md', isFolder: false }], ['Old.md', 'old.md'], false);
		expect(rewriteLinksForMoves('[[OLD]] [other](old.md) [moved](Old.md)', 'Index.md', moves).text)
			.toBe('[[OLD]] [other](old.md) [moved](New.md)');
	});
	it('updates block fragments and qualified embeds and survives inverse planning', () => {
		const paths = ['Old.md', 'Old/Child.md', 'Index.md'];
		const source = '[[Old^block|Root]] ![[Old/Child#Heading]] [[Child]] [[UnknownAlias]]';
		const forward = assignWikiTargets([{ oldPath: 'Old', newPath: 'New', isFolder: true }], paths);
		const updated = rewriteLinksForMoves(source, 'Index.md', forward).text;
		expect(updated).toBe('[[Old^block|Root]] ![[New/Child#Heading]] [[Child]] [[UnknownAlias]]');
		const reverse = assignWikiTargets([{ oldPath: 'New', newPath: 'Old', isFolder: true }], ['Old.md', 'New/Child.md', 'Index.md']);
		expect(rewriteLinksForMoves(updated, 'Index.md', reverse).text).toBe(source);
		const noteMove = assignWikiTargets([{ oldPath: 'Old.md', newPath: 'Renamed.md', isFolder: false }], paths);
		expect(rewriteLinksForMoves('[[old^block|Root]]', 'Index.md', noteMove).text).toBe('[[Renamed^block|Root]]');
	});
	it('rejects unsafe rewrite targets even if admission was bypassed', () => {
		const moves = assignWikiTargets([{ oldPath: 'Old.md', newPath: 'New#topic.md', isFolder: false }], ['Old.md']);
		expect(() => rewriteLinksForMoves('[[Old]]', 'Index.md', moves)).toThrow(/represented safely/);
	});
	it('does not strip a repeated Markdown extension twice', () => {
		const moves = assignWikiTargets([{ oldPath: 'Old.md.md', newPath: 'New.md.md', isFolder: false }], ['Old.md.md']);
		expect(rewriteLinksForMoves('[[Old.md.md]]', 'Index.md', moves).text).toBe('[[New.md.md]]');
	});
});
