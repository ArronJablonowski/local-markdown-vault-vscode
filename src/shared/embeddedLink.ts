/**
 * Re-bases a Markdown link authored inside an embedded note so the extension
 * host can resolve it relative to the parent document without losing the
 * embedded note's original directory context.
 */
export function rebaseEmbeddedLink(sourcePath: string, parentPath: string, href: string): string | undefined {
	const trimmed = href.trim();
	if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed) || trimmed.startsWith('//') || trimmed.startsWith('\\')) {
		return undefined;
	}
	// Preserve explicit schemes for the host allowlist/interstitial. This helper
	// only changes local-path resolution and never grants a URL permission.
	if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
	const separator = firstSeparator(trimmed, '?', '#');
	const rawPath = separator < 0 ? trimmed : trimmed.slice(0, separator);
	const suffix = separator < 0 ? '' : trimmed.slice(separator);
	let decoded: string;
	try { decoded = decodeURIComponent(rawPath); } catch { return undefined; }
	if (/\p{Cc}/u.test(decoded) || /^[a-zA-Z]:[\\/]/.test(decoded)) return undefined;
	const sourceDirectory = directoryParts(sourcePath);
	const normalizedDecoded = decoded.replace(/\\/g, '/');
	const target = normalizeParts(normalizedDecoded.startsWith('/') ? [] : sourceDirectory, normalizedDecoded.replace(/^\/+/, '').split('/'));
	if (!target) return undefined;
	// An anchor-only link points back into the embedded source note, not the
	// parent that happens to display it.
	const targetParts = rawPath ? target : normalizeParts([], sourcePath.replace(/^\/+/, '').split('/'));
	if (!targetParts) return undefined;
	const parentDirectory = directoryParts(parentPath);
	let shared = 0;
	while (shared < parentDirectory.length && shared < targetParts.length && parentDirectory[shared] === targetParts[shared]) shared++;
	const relative = [
		...Array.from({ length: parentDirectory.length - shared }, () => '..'),
		...targetParts.slice(shared),
	];
	if (relative.length === 0) return undefined;
	return relative.map((segment) => encodeURIComponent(segment)).join('/') + suffix;
}

function directoryParts(path: string): string[] {
	const parts = normalizeParts([], path.replace(/\\/g, '/').replace(/^\/+/, '').split('/')) ?? [];
	return parts.slice(0, -1);
}

function normalizeParts(base: readonly string[], additions: readonly string[]): string[] | undefined {
	const result = [...base];
	for (const raw of additions) {
		const part = raw.replace(/\\/g, '/');
		if (!part || part === '.') continue;
		if (part === '..') {
			if (result.length === 0) return undefined;
			result.pop();
		} else {
			result.push(part);
		}
	}
	return result;
}

function firstSeparator(value: string, ...separators: string[]): number {
	const positions = separators.map((separator) => value.indexOf(separator)).filter((position) => position >= 0);
	return positions.length ? Math.min(...positions) : -1;
}
