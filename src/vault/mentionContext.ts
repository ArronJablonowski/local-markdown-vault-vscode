import { markdownCodeRanges } from '../shared/markdownCodeRanges';

export interface MentionContext { line: number; context: string }

const MAX_MENTION_TERMS = 100;
const MAX_MENTION_TERM_LENGTH = 512;

/** Finds a bounded, single-line context for a case-insensitive note mention. */
export function findMentionContext(text: string, terms: readonly string[]): MentionContext | undefined {
	const wanted = [...new Set(terms.map((term) => term.trim()).filter((term) => term.length > 0 && term.length <= MAX_MENTION_TERM_LENGTH))]
		.slice(0, MAX_MENTION_TERMS)
		.map((term) => new RegExp(escapeRegex(term), 'giu'));
	if (!wanted.length) return undefined;
	const ignored = markdownCodeRanges(text);
	const lines = text.split(/\r?\n/);
	let lineStart = 0;
	for (let index = 0; index < Math.min(lines.length, 1_000_000); index++) {
		let hit: number | undefined;
		for (const pattern of wanted) {
			pattern.lastIndex = 0;
			for (let match = pattern.exec(lines[index]); match; match = pattern.exec(lines[index])) {
				const from = lineStart + match.index;
				const to = from + match[0].length;
				if (!overlapsIgnoredRange(from, to, ignored) && hasWordEdges(lines[index], match.index, match[0])) {
					hit = hit === undefined ? match.index : Math.min(hit, match.index);
					break;
				}
			}
		}
		if (hit === undefined) {
			lineStart += lines[index].length + (text.slice(lineStart + lines[index].length, lineStart + lines[index].length + 2) === '\r\n' ? 2 : 1);
			continue;
		}
		const from = Math.max(0, hit - 70);
		const to = Math.min(lines[index].length, hit + 140);
		const raw = lines[index].slice(from, to).replace(/\s+/g, ' ').trim();
		return { line: index + 1, context: `${from ? '…' : ''}${raw}${to < lines[index].length ? '…' : ''}` };
	}
	return undefined;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function overlapsIgnoredRange(from: number, to: number, ranges: readonly (readonly [number, number])[]): boolean {
	let low = 0;
	let high = ranges.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (ranges[middle][1] <= from) low = middle + 1;
		else high = middle;
	}
	return low < ranges.length && ranges[low][0] < to;
}

function hasWordEdges(line: string, index: number, match: string): boolean {
	// Check Unicode neighbors rather than ASCII \b so short and non-English note names stay precise.
	const first = codePointAt(match, 0);
	const last = codePointBefore(match, match.length);
	const previous = codePointBefore(line, index);
	const next = codePointAt(line, index + match.length);
	return !(isWordCharacter(first) && isWordCharacter(previous))
		&& !(isWordCharacter(last) && isWordCharacter(next));
}

function codePointAt(value: string, index: number): string | undefined {
	const point = value.codePointAt(index);
	return point === undefined ? undefined : String.fromCodePoint(point);
}

function codePointBefore(value: string, index: number): string | undefined {
	if (index <= 0) return undefined;
	let start = index - 1;
	if (start > 0 && /[\uDC00-\uDFFF]/.test(value[start]) && /[\uD800-\uDBFF]/.test(value[start - 1])) start--;
	return codePointAt(value, start);
}

function isWordCharacter(value: string | undefined): boolean {
	return value !== undefined && /^[\p{L}\p{N}_-]$/u.test(value);
}
