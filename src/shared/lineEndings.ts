export interface LineEndingMap {
	readonly normalizedText: string;
	readonly rawLength: number;
	toRawOffset(normalizedOffset: number): number;
	toNormalizedOffset(rawOffset: number): number;
}

export interface NormalizedTextChange {
	readonly from: number;
	readonly to: number;
	readonly insert: string;
}

interface LineSpan {
	rawStart: number;
	normalizedStart: number;
	contentLength: number;
}

/**
 * CodeMirror uses one LF code unit per line break, while VS Code offsets count
 * both CR and LF in a CRLF document. This map is the single translation
 * boundary between those coordinate systems. Lone CR characters are retained
 * as content; only actual CRLF pairs are normalized.
 */
export function createLineEndingMap(rawText: string): LineEndingMap {
	const spans: LineSpan[] = [];
	const normalized: string[] = [];
	let rawStart = 0;
	let normalizedStart = 0;
	let cursor = 0;
	while (cursor <= rawText.length) {
		const newline = rawText.indexOf('\n', cursor);
		if (newline < 0) {
			const content = rawText.slice(cursor);
			spans.push({ rawStart, normalizedStart, contentLength: content.length });
			normalized.push(content);
			break;
		}
		const hasCarriageReturn = newline > cursor && rawText.charCodeAt(newline - 1) === 13;
		const contentEnd = newline - (hasCarriageReturn ? 1 : 0);
		const content = rawText.slice(cursor, contentEnd);
		spans.push({ rawStart, normalizedStart, contentLength: content.length });
		normalized.push(content, '\n');
		cursor = newline + 1;
		rawStart = cursor;
		normalizedStart += content.length + 1;
		if (cursor === rawText.length) {
			spans.push({ rawStart, normalizedStart, contentLength: 0 });
			break;
		}
	}
	const normalizedText = normalized.join('');
	return {
		normalizedText,
		rawLength: rawText.length,
		toRawOffset(offset: number): number {
			const safe = clampOffset(offset, normalizedText.length);
			const span = spans[lastStartAtOrBefore(spans, safe, 'normalizedStart')];
			return Math.min(rawText.length, span.rawStart + Math.min(safe - span.normalizedStart, span.contentLength));
		},
		toNormalizedOffset(offset: number): number {
			const safe = clampOffset(offset, rawText.length);
			const span = spans[lastStartAtOrBefore(spans, safe, 'rawStart')];
			return Math.min(normalizedText.length, span.normalizedStart + Math.min(safe - span.rawStart, span.contentLength));
		},
	};
}

export function normalizeLineEndingsForWebview(text: string): string {
	return text.replace(/\r\n/g, '\n');
}

export function normalizeInsertedLineEndings(text: string, useCrlf: boolean): string {
	const lf = normalizeLineEndingsForWebview(text);
	return useCrlf ? lf.replace(/\n/g, '\r\n') : lf;
}

/**
 * Applies a batch whose offsets all refer to the same normalized snapshot.
 * Returning undefined lets protocol callers fail closed if a provider ever
 * supplies overlapping or out-of-range changes despite its API contract.
 */
export function applyNormalizedTextChanges(
	text: string,
	changes: readonly NormalizedTextChange[],
): string | undefined {
	const ordered = [...changes].sort((a, b) => a.from - b.from || a.to - b.to);
	let previousEnd = 0;
	for (const change of ordered) {
		if (!Number.isSafeInteger(change.from) || !Number.isSafeInteger(change.to) ||
			change.from < previousEnd || change.from < 0 || change.to < change.from || change.to > text.length) {
			return undefined;
		}
		previousEnd = change.to;
	}
	let result = text;
	// Apply from the end so earlier offsets still refer to the original snapshot.
	for (let index = ordered.length - 1; index >= 0; index--) {
		const change = ordered[index];
		result = result.slice(0, change.from) + change.insert + result.slice(change.to);
	}
	return result;
}

function clampOffset(value: number, maximum: number): number {
	return Math.max(0, Math.min(Number.isSafeInteger(value) ? value : 0, maximum));
}

function lastStartAtOrBefore(
	spans: readonly LineSpan[],
	offset: number,
	key: 'rawStart' | 'normalizedStart',
): number {
	let low = 0;
	let high = spans.length;
	while (low + 1 < high) {
		const middle = (low + high) >>> 1;
		if (spans[middle][key] <= offset) low = middle;
		else high = middle;
	}
	return low;
}
