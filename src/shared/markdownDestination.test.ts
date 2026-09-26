import { describe, expect, it } from 'vitest';
import { markdownDestination } from './markdownDestination';
import { resolveLinkTarget } from './linkTarget';

describe('Markdown destination normalization', () => {
	it('removes parser-provided angle wrappers and punctuation escapes once', () => {
		expect(markdownDestination('<Notes/Meeting notes.md>')).toBe('Notes/Meeting notes.md');
		expect(markdownDestination('Notes/Topic\\(draft\\).md')).toBe('Notes/Topic(draft).md');
		expect(markdownDestination('<images/chart\\(draft\\).png>')).toBe('images/chart(draft).png');
		expect(markdownDestination('notes/a\\\\b.md')).toBe('notes/a\\b.md');
	});
	it('does not remove literal escaped angle characters or ordinary backslashes', () => {
		expect(markdownDestination('\\<note\\>')).toBe('<note>');
		expect(markdownDestination('folder\\note.md')).toBe('folder\\note.md');
	});
	it('preserves percent encoding and unsafe protocols for the authorization boundary', () => {
		for (const value of ['../outside.md', '%2e%2e/outside.md', 'javascript:alert(1)', 'command:workbench.action.closeWindow', 'https://example.invalid/image.png']) {
			expect(markdownDestination(`<${value}>`)).toBe(value);
		}
	});
	it('leaves unsafe normalized targets blocked by the existing authorization policy', () => {
		for (const source of ['<javascript:alert(1)>', 'command\\:workbench.action.closeWindow', '<data:text/html;base64,PGgxPng8L2gxPg==>', '<file:///outside.md>', '<//example.invalid/tracker>', '<%2foutside.md>']) {
			expect(resolveLinkTarget(markdownDestination(source)).kind).toBe('blocked');
		}
	});
});
