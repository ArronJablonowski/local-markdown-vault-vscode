import { describe, expect, it } from 'vitest';
import { applyNormalizedTextChanges, createLineEndingMap, normalizeInsertedLineEndings } from './lineEndings';

describe('host/webview line-ending coordinates', () => {
	it('maps every LF document offset identically', () => {
		const text = 'one\ntwo\n😀 three\n';
		const map = createLineEndingMap(text);
		expect(map.normalizedText).toBe(text);
		for (let offset = 0; offset <= text.length; offset++) {
			expect(map.toRawOffset(offset)).toBe(offset);
			expect(map.toNormalizedOffset(offset)).toBe(offset);
		}
	});

	it('maps CRLF offsets in both directions without shifting Unicode', () => {
		const raw = 'one\r\ntwo\r\n😀 three\r\n';
		const map = createLineEndingMap(raw);
		expect(map.normalizedText).toBe('one\ntwo\n😀 three\n');
		expect(map.toRawOffset(4)).toBe(5); // start of line two
		expect(map.toRawOffset(8)).toBe(10); // start of the emoji line
		expect(map.toNormalizedOffset(5)).toBe(4);
		expect(map.toNormalizedOffset(10)).toBe(8);
		expect(map.toRawOffset(map.normalizedText.length)).toBe(raw.length);
		expect(map.toNormalizedOffset(raw.length)).toBe(map.normalizedText.length);
	});

	it('collapses either half of a CRLF boundary to one webview boundary', () => {
		const map = createLineEndingMap('a\r\nb');
		expect(map.toNormalizedOffset(1)).toBe(1);
		expect(map.toNormalizedOffset(2)).toBe(1);
		expect(map.toNormalizedOffset(3)).toBe(2);
		expect(map.toRawOffset(1)).toBe(1);
		expect(map.toRawOffset(2)).toBe(3);
	});

	it('keeps mixed line endings and lone carriage returns stable', () => {
		const raw = 'a\r\nb\nc\rd\r\n😀';
		const map = createLineEndingMap(raw);
		expect(map.normalizedText).toBe('a\nb\nc\rd\n😀');

		for (let normalizedOffset = 0; normalizedOffset <= map.normalizedText.length; normalizedOffset++) {
			expect(map.toNormalizedOffset(map.toRawOffset(normalizedOffset))).toBe(normalizedOffset);
		}

		// A raw offset that points at either code unit of a CRLF has one shared
		// normalized boundary. Every other raw boundary round-trips exactly.
		for (let rawOffset = 0; rawOffset <= raw.length; rawOffset++) {
			const isLfHalfOfCrlf = rawOffset > 0 && raw[rawOffset - 1] === '\r' && raw[rawOffset] === '\n';
			const expected = isLfHalfOfCrlf ? rawOffset - 1 : rawOffset;
			expect(map.toRawOffset(map.toNormalizedOffset(rawOffset))).toBe(expected);
		}
	});

	it('normalizes inserted lines to the document convention', () => {
		expect(normalizeInsertedLineEndings('a\r\nb\nc', false)).toBe('a\nb\nc');
		expect(normalizeInsertedLineEndings('a\r\nb\nc', true)).toBe('a\r\nb\r\nc');
	});

	it('reconciles same-snapshot change batches independent of input order', () => {
		expect(applyNormalizedTextChanges('one\ntwo\nthree', [
			{ from: 8, to: 13, insert: 'THREE' },
			{ from: 0, to: 3, insert: 'ONE' },
		])).toBe('ONE\ntwo\nTHREE');
	});

	it('rejects overlapping, reversed, unsafe, and out-of-range changes', () => {
		expect(applyNormalizedTextChanges('abcd', [
			{ from: 1, to: 3, insert: '' },
			{ from: 2, to: 4, insert: '' },
		])).toBeUndefined();
		expect(applyNormalizedTextChanges('abcd', [{ from: 3, to: 2, insert: '' }])).toBeUndefined();
		expect(applyNormalizedTextChanges('abcd', [{ from: Number.MAX_SAFE_INTEGER + 1, to: 4, insert: '' }])).toBeUndefined();
		expect(applyNormalizedTextChanges('abcd', [{ from: 4, to: 5, insert: '' }])).toBeUndefined();
	});

	it('exposes a CRLF-half edit as a reconciliation mismatch', () => {
		const before = createLineEndingMap('a\r\nb');
		// A provider deleting only the LF half maps to deletion of the normalized
		// newline, while the authoritative raw result retains a lone CR. The host
		// detects this inequality and sends a full snapshot.
		const patched = applyNormalizedTextChanges(before.normalizedText, [{
			from: before.toNormalizedOffset(2),
			to: before.toNormalizedOffset(3),
			insert: '',
		}]);
		expect(patched).toBe('ab');
		expect(patched).not.toBe(createLineEndingMap('a\rb').normalizedText);
	});
});
