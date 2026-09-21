import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { resolveAttachmentFolder, validateAttachmentFolder } from './attachmentPath';

describe('attachment folder paths', () => {
	it.each(['assets', 'attachments/images', '\u30e1\u30c7\u30a3\u30a2'])('accepts %s', (value) => {
		expect(validateAttachmentFolder(value)).toBeUndefined();
	});

	it.each(['', '../outside', 'a/../outside', '/tmp/files', 'C:\\files', 'a//b', 'a\0b'])('rejects %o', (value) => {
		expect(validateAttachmentFolder(value)).toBeTypeOf('string');
	});

	it('resolves beneath the vault root', () => {
		const vault = resolve('vault-test-root');
		const noteDirectory = join(vault, 'notes', 'daily');
		expect(resolveAttachmentFolder(vault, noteDirectory, 'assets/images')).toBe(
			join(noteDirectory, 'assets', 'images'),
		);
	});

	it('rejects a note directory outside the vault', () => {
		expect(() => resolveAttachmentFolder(resolve('vault-test-root'), resolve('other-root'), 'assets')).toThrow();
	});
});
