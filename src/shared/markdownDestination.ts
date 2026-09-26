/**
 * Convert a parser-confirmed Markdown destination to the target it denotes.
 * Angle brackets and punctuation escapes are Markdown syntax, not filename
 * characters. Do this once, before the existing host/path/media authorization;
 * never URL-decode here or treat this normalization as permission to open it.
 */
export function markdownDestination(source: string): string {
	const destination = source.startsWith('<') && source.endsWith('>') ? source.slice(1, -1) : source;
	return destination.replace(/\\([!-/:-@[-`{-~])/g, '$1');
}
