import { describe, expect, it } from 'vitest';
import { resolveAttachmentFolder, validateAttachmentFolder } from './attachmentPath';

describe('attachment folder paths', () => {
	it.each(['assets', 'attachments/images', 'メディア'])('accepts %s', (value) => {
		expect(validateAttachmentFolder(value)).toBeUndefined();
	});

	it.each(['', '../outside', 'a/../outside', '/tmp/files', 'C:\\files', 'a//b', 'a\0b'])('rejects %o', (value) => {
		expect(validateAttachmentFolder(value)).toBeTypeOf('string');
	});

	it('resolves beneath the vault root', () => {
		expect(resolveAttachmentFolder('/vault', '/vault/notes/daily', 'assets/images')).toBe('/vault/notes/daily/assets/images');
	});

	it('rejects a note directory outside the vault', () => {
		expect(() => resolveAttachmentFolder('/vault', '/other', 'assets')).toThrow();
	});
});
