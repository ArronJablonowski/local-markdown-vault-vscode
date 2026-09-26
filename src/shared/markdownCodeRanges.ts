export type MarkdownSourceRange = readonly [from: number, to: number];

/**
 * Returns fenced-code blocks and inline backtick spans as UTF-16 source
 * ranges. Fence closers must use the same marker and at least the opener's
 * length; inline spans close only on a run of exactly the opener's length.
 * The scan is linear even for a line containing thousands of unmatched runs.
 */
export function markdownCodeRanges(text: string): MarkdownSourceRange[] {
	const ranges: MarkdownSourceRange[] = [];
	let fenceStart = -1;
	let fenceMarker: '`' | '~' | '' = '';
	let fenceLength = 0;
	let offset = 0;
	for (const line of text.split(/(?<=\n)/)) {
		if (fenceStart >= 0) {
			const closing = /^[ \t]{0,3}(`+|~+)[ \t]*(?:\r?\n)?$/.exec(line);
			if (closing && closing[1][0] === fenceMarker && closing[1].length >= fenceLength) {
				ranges.push([fenceStart, offset + line.length]);
				fenceStart = -1;
				fenceMarker = '';
				fenceLength = 0;
			}
			offset += line.length;
			continue;
		}

		const opening = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
		if (opening && !(opening[1][0] === '`' && line.slice(opening[0].length).includes('`'))) {
			fenceStart = offset;
			fenceMarker = opening[1][0] as '`' | '~';
			fenceLength = opening[1].length;
		} else {
			for (const [from, to] of inlineCodeRanges(line)) ranges.push([offset + from, offset + to]);
		}
		offset += line.length;
	}
	if (fenceStart >= 0) ranges.push([fenceStart, text.length]);
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
		const closingIndex = nextSameLength[index];
		if (closingIndex === undefined) continue;
		ranges.push([runs[index].from, runs[closingIndex].to]);
		index = closingIndex;
	}
	return ranges;
}
