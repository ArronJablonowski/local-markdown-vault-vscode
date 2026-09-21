import { describe, expect, it } from 'vitest';
import { noteFileName, validateVaultEntryName, validateVaultRelativeNotePath } from './vaultName';

describe('vault entry names', () => {
	it.each(['Note', '\u65e5\u672c\u8a9e.md', 'my note', '.hidden'])('accepts %s', (name) => {
		expect(validateVaultEntryName(name)).toBeUndefined();
	});

	it.each(['', ' ../secret', '..', 'a/b', 'a\\b', 'CON', 'lpt1.txt', 'name.', 'name ', 'a\0b'])('rejects %o', (name) => {
		expect(validateVaultEntryName(name)).toBeTypeOf('string');
	});

	it('adds the normal Markdown extension only when needed', () => {
		expect(noteFileName('Note')).toBe('Note.md');
		expect(noteFileName('Note.markdown')).toBe('Note.markdown');
	});
});

describe('validateVaultRelativeNotePath', () => {
	it.each(['Note', 'Folder/New Note', './Folder/\u65e5\u672c\u8a9e.markdown', 'Nested/Deep/Note.md'])(
		'accepts safe vault-relative note path %s',
		(path) => expect(validateVaultRelativeNotePath(path)).toBeUndefined(),
	);

	it.each([
		'', '/absolute', 'C:/absolute', '../escape', 'Folder/../escape',
		'Folder//Note', 'Folder/CON', 'Folder/bad?.md',
	])('rejects unsafe or invalid path %o', (path) => {
		expect(validateVaultRelativeNotePath(path)).toBeTypeOf('string');
	});

	it('rejects paths deeper than the supported creation limit', () => {
		expect(validateVaultRelativeNotePath(`${'folder/'.repeat(64)}note`)).toMatch(/deeply nested/);
	});
});
