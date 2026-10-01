import { describe, expect, it, vi } from 'vitest';
import { readClipboardText } from './clipboardText';

function data(values: Record<string, string>) {
	return { types: Object.keys(values), getData: vi.fn((type: string) => values[type] ?? '') };
}

describe('external clipboard text representations', () => {
	it.each(['text/csv', 'text/tab-separated-values'])('skips empty %s metadata for readable plain text', mime => {
		expect(readClipboardText(data({ [mime]: '', 'text/plain': 'Copied text' })))
			.toEqual({ type: 'text/plain', text: 'Copied text', hasText: true });
	});
	it('retains declared nonempty spreadsheet priority, including malformed content', () => {
		expect(readClipboardText(data({ 'text/tab-separated-values': '"unfinished', 'text/csv': 'A,B', 'text/plain': 'Fallback' })))
			.toEqual({ type: 'text/tab-separated-values', text: '"unfinished', hasText: true });
	});
	it('skips empty higher-priority grid data for a usable lower-priority grid', () => {
		expect(readClipboardText(data({ 'text/tab-separated-values': '', 'text/csv': 'A,B', 'text/plain': 'Fallback' })).type).toBe('text/csv');
	});
	it('preserves URI fallback and literal boundary whitespace', () => {
		expect(readClipboardText(data({ 'text/plain': '', 'text/uri-list': 'https://example.invalid' })).type).toBe('text/uri-list');
		expect(readClipboardText(data({ 'text/plain': '\t \n', 'text/uri-list': 'Other' })).text).toBe('\t \n');
	});
	it('retains an explicitly empty cell when no readable fallback exists', () => {
		expect(readClipboardText(data({ 'text/csv': '', 'text/plain': '' }))).toEqual({ type: 'text/csv', text: '', hasText: true });
	});
	it('plain mode ignores grid metadata but retains the original plain payload', () => {
		expect(readClipboardText(data({ 'text/csv': 'A,B', 'text/plain': 'A\tB' }), 'plain'))
			.toEqual({ type: 'text/plain', text: 'A\tB', hasText: true });
	});
	it('never requests HTML, rich-text formats, unknown types, or files', () => {
		const clipboard = data({ 'text/html': '<script>active</script>', 'text/rtf': 'rich data', 'Files': 'file data', 'application/x-private': 'opaque' });
		expect(readClipboardText(clipboard)).toEqual({ type: 'text/plain', text: '', hasText: false });
		expect(clipboard.getData).not.toHaveBeenCalled();
		expect(readClipboardText(null).hasText).toBe(false);
	});
	it('performs at most four supported-format reads', () => {
		const clipboard = data({ 'text/tab-separated-values': '', 'text/csv': '', 'text/plain': '', 'text/uri-list': '' });
		readClipboardText(clipboard);
		expect(clipboard.getData).toHaveBeenCalledTimes(4);
	});
});
