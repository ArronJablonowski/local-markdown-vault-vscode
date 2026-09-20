const OPEN_ONLY_ATTACHMENT_EXTENSIONS = new Set([
	'.3gp',
	'.aac',
	'.flac',
	'.m4a',
	'.mp3',
	'.ogg',
	'.pdf',
	'.wav',
	'.webm',
]);

/**
 * Normalizes an Obsidian-style attachment target that may be opened by VS Code.
 *
 * These formats are deliberately "open only": the live-preview webview does
 * not parse or render their bytes. Returning a vault-relative path here does
 * not grant access by itself; VaultService still resolves the path, follows
 * symlinks, and re-checks canonical vault containment before it can be opened.
 */
export function normalizeOpenOnlyAttachmentTarget(authoredTarget: string): string | undefined {
	if (!authoredTarget || authoredTarget.length > 4096 || /[\u0000-\u001f\u007f]/.test(authoredTarget)) return undefined;
	const trimmed = authoredTarget.trim();
	if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('\\\\') || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || /^[a-z]:[\\/]/i.test(trimmed)) {
		return undefined;
	}

	let decoded: string;
	try { decoded = decodeURIComponent(trimmed).replace(/\\/g, '/'); }
	catch { return undefined; }
	if (decoded.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(decoded) || /^[a-z]:\//i.test(decoded)) return undefined;
	// A single leading slash is Obsidian's vault-root notation, not an OS root.
	decoded = decoded.replace(/^\//, '');
	if (!decoded || decoded.startsWith('/') || /[\u0000-\u001f\u007f]/.test(decoded)) return undefined;
	const segments = decoded.split('/');
	if (segments.length > 64 || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return undefined;
	const leaf = segments.at(-1)!;
	const dot = leaf.lastIndexOf('.');
	const extension = dot > 0 ? leaf.slice(dot).toLocaleLowerCase() : '';
	return OPEN_ONLY_ATTACHMENT_EXTENSIONS.has(extension) ? decoded : undefined;
}

export function isOpenOnlyAttachmentTarget(authoredTarget: string): boolean {
	return normalizeOpenOnlyAttachmentTarget(authoredTarget) !== undefined;
}
