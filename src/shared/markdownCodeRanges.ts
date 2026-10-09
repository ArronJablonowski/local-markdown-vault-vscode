import { parser, Table } from '@lezer/markdown';

export type MarkdownSourceRange = readonly [from: number, to: number];

// Block parsing supplies container-aware source boundaries. Scan backtick
// runs separately to avoid repeated closer searches in hostile inline input.
const blockParser = parser.configure([Table, { remove: ['Escape', 'Entity', 'InlineCode', 'HTMLTag', 'Emphasis', 'HardBreak', 'Link', 'Image'] }]);

/**
 * Returns fenced/indented blocks and inline backtick spans as UTF-16 source
 * ranges. Fence closers must use the same marker and at least the opener's
 * length; inline spans close only on a run of exactly the opener's length.
 * The scan is linear even for a line containing thousands of unmatched runs.
 */
export function markdownCodeRanges(text: string): MarkdownSourceRange[] {
	const ranges: MarkdownSourceRange[] = [];
	blockParser.parse(text).iterate({ enter(node) {
		if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
			ranges.push([node.from, node.to]);
			return false;
		}
		if (node.name === 'Paragraph' || node.name === 'TableCell' || /^ATXHeading[1-6]$/.test(node.name) || /^SetextHeading[12]$/.test(node.name)) {
			for (const [from, to] of inlineCodeRanges(text.slice(node.from, node.to))) ranges.push([node.from + from, node.from + to]);
			return false;
		}
	} });
	return ranges;
}

function inlineCodeRanges(line: string): MarkdownSourceRange[] {
	const runs: Array<{ from: number; to: number; length: number }> = [];
	for (let cursor = 0; cursor < line.length;) {
		if (line[cursor] !== '`') {
			cursor++;
			continue;
		}
		const from = cursor;
		while (cursor < line.length && line[cursor] === '`') cursor++;
		runs.push({ from, to: cursor, length: cursor - from });
	}
	// Precompute closers once instead of rescanning every unmatched opening run.
	const nextSameLength = new Array<number | undefined>(runs.length);
	const nextByLength = new Map<number, number>();
	for (let index = runs.length - 1; index >= 0; index--) {
		nextSameLength[index] = nextByLength.get(runs[index].length);
		nextByLength.set(runs[index].length, index);
	}
	const ranges: MarkdownSourceRange[] = [];
	for (let index = 0; index < runs.length; index++) {
		let slashes = 0;
		for (let cursor = runs[index].from - 1; cursor >= 0 && line[cursor] === '\\'; cursor--) slashes++;
		if (slashes % 2) continue;
		const closingIndex = nextSameLength[index];
		if (closingIndex === undefined) continue;
		ranges.push([runs[index].from, runs[closingIndex].to]);
		index = closingIndex;
	}
	return ranges;
}
