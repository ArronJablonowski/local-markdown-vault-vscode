import { describe, expect, it } from 'vitest';
import { rebaseEmbeddedLink } from './embeddedLink';

describe('embedded Markdown link rebasing', () => {
	it('resolves relative paths from the embedded note directory', () => {
		expect(rebaseEmbeddedLink('Folder/Embed.md', 'Parent.md', 'Sibling.md#part'))
			.toBe('Folder/Sibling.md#part');
		expect(rebaseEmbeddedLink('Folder/Embed.md', 'Notes/Parent.md', '../Shared.md'))
			.toBe('../Shared.md');
	});

	it('resolves vault-root and anchor-only links safely', () => {
		expect(rebaseEmbeddedLink('Folder/Embed.md', 'Notes/Parent.md', '/Root.md'))
			.toBe('../Root.md');
		expect(rebaseEmbeddedLink('Folder/Embed.md', 'Notes/Parent.md', '#heading'))
			.toBe('../Folder/Embed.md#heading');
	});

	it('preserves encoded filenames and explicit schemes for host validation', () => {
		expect(rebaseEmbeddedLink('Folder/Embed.md', 'Parent.md', 'My%20Note.md'))
			.toBe('Folder/My%20Note.md');
		expect(rebaseEmbeddedLink('Folder/Embed.md', 'Parent.md', 'https://example.test/a'))
			.toBe('https://example.test/a');
	});

	it('rejects traversal, protocol-relative URLs, controls, and malformed encoding', () => {
		expect(rebaseEmbeddedLink('Folder/Embed.md', 'Parent.md', '../../outside.md')).toBeUndefined();
		expect(rebaseEmbeddedLink('Folder/Embed.md', 'Parent.md', '//tracker.test/x')).toBeUndefined();
		expect(rebaseEmbeddedLink('Folder/Embed.md', 'Parent.md', 'bad%ZZ.md')).toBeUndefined();
		expect(rebaseEmbeddedLink('Folder/Embed.md', 'Parent.md', 'bad\0.md')).toBeUndefined();
	});
});
