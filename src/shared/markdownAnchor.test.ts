import { describe, expect, it } from 'vitest';
import { findMarkdownAnchorLine } from './markdownAnchor';

describe('Markdown anchor navigation', () => {
	const source = [
		'# Overview',
		'',
		'## Install Guide ##',
		'',
		'Setext section',
		'---------------',
		'',
		'Paragraph with a block marker ^block-1',
	].join('\n');

	it('matches ATX and Setext headings using Obsidian-style slugs', () => {
		expect(findMarkdownAnchorLine(source, '#overview')).toBe(1);
		expect(findMarkdownAnchorLine(source, '#Install Guide')).toBe(3);
		expect(findMarkdownAnchorLine(source, '#setext-section')).toBe(5);
	});

	it('matches bounded block identifiers', () => {
		expect(findMarkdownAnchorLine(source, '^block-1')).toBe(8);
		expect(findMarkdownAnchorLine(source, '^bad id')).toBeUndefined();
	});

	it('does not guess when a fragment is missing or malformed', () => {
		expect(findMarkdownAnchorLine(source, '#missing')).toBeUndefined();
		expect(findMarkdownAnchorLine(source, '')).toBeUndefined();
	});
});
