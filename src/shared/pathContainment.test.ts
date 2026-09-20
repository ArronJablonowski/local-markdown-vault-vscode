import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { isPathInside, normalizePathForCompare, resolveVaultRelativePath } from './pathContainment';

describe('normalizePathForCompare', () => {
	it('resolves . and .. segments', () => {
		expect(normalizePathForCompare('/a/b/../c/./d', false)).toBe('a/c/d');
	});

	it('unifies separators', () => {
		expect(normalizePathForCompare('C:\\a\\b', true)).toBe(normalizePathForCompare('C:/a/b', true));
	});

	it('folds case only when asked', () => {
		expect(normalizePathForCompare('/A/B', true)).toBe('a/b');
		expect(normalizePathForCompare('/A/B', false)).toBe('A/B');
	});

	// Climbing above the root must not leave a `..` behind, or `/../x` and `/x`
	// compare as different paths even though the filesystem treats them alike.
	it('drops a .. that would climb past the root', () => {
		expect(normalizePathForCompare('/../secret', false)).toBe('secret');
	});
});

describe('resolveVaultRelativePath', () => {
	const root = resolve('vault-test-root');

	it('resolves ordinary nested paths and the vault root', () => {
		expect(resolveVaultRelativePath(root, 'Folder/Note.md', false)).toBe(resolve(root, 'Folder', 'Note.md'));
		expect(resolveVaultRelativePath(root, '', false)).toBe(root);
	});

	it.each([
		'../outside.md', 'Folder/../../outside.md', './Note.md', 'Folder//Note.md',
		'/absolute.md', '\\\\server\\share.md', 'C:/absolute.md', 'C:relative.md',
		'Folder/Note.md\0suffix', 'Folder/Note.md\nnext',
	])('rejects unsafe vault-relative path %o', (path) => {
		expect(resolveVaultRelativePath(root, path, false)).toBeUndefined();
	});

	it('does not reinterpret percent-encoded filename characters', () => {
		expect(resolveVaultRelativePath(root, '%2e%2e/Note.md', false)).toBe(resolve(root, '%2e%2e', 'Note.md'));
	});
});

describe('isPathInside', () => {
	const dir = '/home/user/notes';

	it('accepts a direct child', () => {
		expect(isPathInside(dir, '/home/user/notes/diagram.drawio', false)).toBe(true);
	});

	it('accepts a nested child', () => {
		expect(isPathInside(dir, '/home/user/notes/assets/sub/d.drawio', false)).toBe(true);
	});

	it('accepts the directory itself', () => {
		expect(isPathInside(dir, '/home/user/notes', false)).toBe(true);
	});

	// The whole point of the check: a reference read out of a Markdown file can
	// say anything, and this is the escape it must not permit.
	it('rejects a path that climbs out with ..', () => {
		expect(isPathInside(dir, '/home/user/notes/../../../etc/passwd', false)).toBe(false);
	});

	it('rejects an unrelated absolute path', () => {
		expect(isPathInside(dir, '/etc/passwd', false)).toBe(false);
	});

	// A plain string-prefix test would wrongly accept this: "/home/user/notes"
	// is literally a prefix of "/home/user/notes-secret".
	it('rejects a sibling whose name merely starts with the directory name', () => {
		expect(isPathInside(dir, '/home/user/notes-secret/x.drawio', false)).toBe(false);
	});

	it('accepts a re-entrant path that ends up back inside', () => {
		expect(isPathInside(dir, '/home/user/notes/sub/../other.drawio', false)).toBe(true);
	});

	it('honours case-insensitivity on Windows-style paths', () => {
		expect(isPathInside('C:\\Users\\me\\Notes', 'c:\\users\\me\\notes\\d.drawio', true)).toBe(true);
		// …and not when the platform is case-sensitive.
		expect(isPathInside('/Users/me/Notes', '/users/me/notes/d.drawio', false)).toBe(false);
	});
});
