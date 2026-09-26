const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

/** Apply portable filename rules on every host so a vault can later move between systems. */
export function validateVaultEntryName(name: string): string | undefined {
	if (!name || name.trim() !== name) return 'Enter a name without leading or trailing whitespace.';
	if (name === '.' || name === '..' || /[\\/]/.test(name)) return 'The name must not contain path separators.';
	if (/[\u0000-\u001f\u007f]/.test(name)) return 'The name contains a control character.';
	if (/[<>:"|?*]/.test(name)) return 'The name contains a character that is not portable across supported systems.';
	if (/[. ]$/.test(name)) return 'The name must not end with a period or space.';
	if (WINDOWS_RESERVED.test(name)) return 'That name is reserved by Windows.';
	if (new TextEncoder().encode(name).byteLength > 255) return 'The name is longer than 255 bytes.';
	return undefined;
}

export function noteFileName(input: string): string {
	return /\.(?:md|markdown)$/i.test(input) ? input : `${input}.md`;
}

/** Validates a Quick Switcher/unresolved-note path without touching disk. */
export function validateVaultRelativeNotePath(input: string): string | undefined {
	const normalized = input.replace(/\\/g, '/').replace(/^\.\//, '');
	if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) {
		return 'The note path must be relative to the Document Vault.';
	}
	const parts = normalized.split('/');
	if (parts.length > 64) return 'The note path is too deeply nested.';
	for (let index = 0; index < parts.length; index++) {
		const part = index === parts.length - 1 ? noteFileName(parts[index]) : parts[index];
		const error = validateVaultEntryName(part);
		if (error) return error;
	}
	return undefined;
}
