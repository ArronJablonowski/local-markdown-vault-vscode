import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';

const CONTROL = /[\u0000-\u001f\u007f]/;

export function validateAttachmentFolder(value: string): string | undefined {
	if (!value.trim()) return 'The attachment folder cannot be empty.';
	if (value.length > 512) return 'The attachment folder is too long.';
	if (CONTROL.test(value)) return 'The attachment folder contains control characters.';
	if (isAbsolute(value) || /^[a-z]:/i.test(value) || value.startsWith('\\\\')) {
		return 'The attachment folder must be relative to the vault.';
	}
	const parts = value.replace(/\\/g, '/').split('/');
	if (parts.some((part) => !part || part === '.' || part === '..')) {
		return 'The attachment folder cannot contain empty, current-directory, or parent-directory segments.';
	}
	return undefined;
}

/** Lexical path validation only; callers must authorize symlinks before filesystem access. */
export function resolveAttachmentFolder(vaultRoot: string, noteDirectory: string, value: string): string {
	const error = validateAttachmentFolder(value);
	if (error) throw new Error(error);
	const notePath = relative(vaultRoot, noteDirectory);
	if (notePath === '..' || notePath.startsWith(`..${sep}`) || isAbsolute(notePath)) {
		throw new Error('The note is outside the vault.');
	}
	const target = resolve(noteDirectory, normalize(value));
	const path = relative(vaultRoot, target);
	if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
		throw new Error('The attachment folder is outside the vault.');
	}
	return target;
}
