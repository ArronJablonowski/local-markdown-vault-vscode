const MAX_INDEXED_PATH_LENGTH = 4096;
const MAX_TAG_LENGTH = 512;
const MAX_REVEAL_LINE = 10_000_000;

export interface OpenIndexedPathArguments {
	path: string;
	line?: number;
}

/** Validates the public command boundary before it can reach the vault index. */
export function validateOpenIndexedPathArguments(path: unknown, line: unknown): OpenIndexedPathArguments | undefined {
	if (typeof path !== 'string' || path.length === 0 || path.length > MAX_INDEXED_PATH_LENGTH) return undefined;
	if (/[/\\]/.test(path[0]) || /^[a-z]:/i.test(path) || path.includes('\\') || /[\u0000-\u001f\u007f]/.test(path)) return undefined;
	if (path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) return undefined;
	if (line !== undefined && (!Number.isSafeInteger(line) || (line as number) < 1 || (line as number) > MAX_REVEAL_LINE)) return undefined;
	return line === undefined ? { path } : { path, line: line as number };
}

/**
 * Tag-tree commands accept only an Obsidian-compatible tag token. Verifying
 * that it exists in the current index remains a separate capability check.
 */
export function validateSearchTagArgument(value: unknown): string | undefined {
	if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TAG_LENGTH) return undefined;
	return /^[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*$/u.test(value) ? value : undefined;
}

