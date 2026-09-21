export interface InlineHighlightRange {
	from: number;
	to: number;
}

/** Maximum source inspected for highlights on any one mounted line. */
export const MAX_HIGHLIGHT_LINE_CHARACTERS = 256 * 1024;

/** Maximum rendered highlights across the mounted editor viewport. */
export const MAX_HIGHLIGHTS_PER_VIEWPORT = 512;

/**
 * Finds bounded, single-line Obsidian highlight ranges.
 *
 * The index-based scanner is deliberately linear and stops as soon as the
 * caller's decoration budget is exhausted. Source beyond either bound remains
 * visible and editable as ordinary Markdown.
 */
export function findInlineHighlightRanges(
	lineText: string,
	limit = MAX_HIGHLIGHTS_PER_VIEWPORT,
): readonly InlineHighlightRange[] {
	if (limit <= 0) return [];
	const source = lineText.slice(0, MAX_HIGHLIGHT_LINE_CHARACTERS);
	const ranges: InlineHighlightRange[] = [];
	let cursor = 0;
	while (ranges.length < limit) {
		const open = source.indexOf('==', cursor);
		if (open < 0) break;
		const contentFrom = open + 2;
		const close = source.indexOf('==', contentFrom);
		if (close < 0) break;
		if (close > contentFrom && source[contentFrom] !== '=' && source[close - 1] !== '=') {
			ranges.push({ from: open, to: close + 2 });
			cursor = close + 2;
		} else {
			cursor = contentFrom;
		}
	}
	return ranges;
}
