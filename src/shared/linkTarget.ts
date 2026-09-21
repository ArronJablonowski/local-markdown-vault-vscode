/**
 * Where a link from the preview should be sent.
 *
 * Deciding this is easy to get wrong in ways that only show up as an OS error
 * dialog, so it is kept apart from the `vscode` API calls that act on it and
 * unit-tested directly.
 */
export type LinkTarget =
	/** Empty source that has no navigation target. */
	| { kind: 'ignore' }
	/** A heading or block fragment inside the current document. */
	| { kind: 'anchor'; fragment: string }
	/** An explicitly allowlisted scheme that may be handed to the shell. */
	| { kind: 'external'; href: string }
	/** Plain HTTP is permitted only after a user-facing warning. */
	| { kind: 'insecureHttp'; href: string }
	/** A URI or absolute path that must never be activated. */
	| { kind: 'blocked'; value: string }
	/** A path relative to the document's own folder, optionally with an internal fragment. */
	| { kind: 'relative'; path: string; fragment?: string };

/** RFC 3986 permits a one-letter URI scheme, so unknown values such as
 * `x:payload` must be rejected rather than treated as vault-relative paths.
 * Windows drive-absolute paths are rejected independently below; treating a
 * drive-relative form such as `C:note.md` as an unknown scheme is the safe,
 * unambiguous behavior for authored Markdown links.
 */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
// Unicode bidi formatting controls can make a malicious destination appear to
// have a different host or filename in confirmation UI and system dialogs.
const BIDI_CONTROL_RE = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

function containsUnsafeDisplayControl(value: string): boolean {
	if (BIDI_CONTROL_RE.test(value)) return true;
	try {
		return BIDI_CONTROL_RE.test(decodeURIComponent(value));
	} catch {
		return true;
	}
}

export function resolveLinkTarget(href: string): LinkTarget {
	const trimmed = href.trim();
	if (!trimmed) return { kind: 'ignore' };
	if (/[\u0000-\u001f\u007f]/.test(trimmed) || containsUnsafeDisplayControl(trimmed)) {
		return { kind: 'blocked', value: trimmed };
	}
	if (trimmed.startsWith('#')) {
		const fragment = decodeFragment(trimmed);
		return fragment ? { kind: 'anchor', fragment } : { kind: 'blocked', value: trimmed };
	}

	// Protocol-relative URLs inherit the embedding page's scheme in a browser.
	// They are ambiguous in a VS Code webview and bypass a scheme allowlist if
	// treated as a relative file path, so reject them outright.
	if (trimmed.startsWith('//') || trimmed.startsWith('\\\\')) {
		return { kind: 'blocked', value: trimmed };
	}

	const scheme = SCHEME_RE.exec(trimmed)?.[0].toLowerCase();
	if (scheme === 'https:' && isAbsoluteWebUrl(trimmed, 'https:')) return { kind: 'external', href: trimmed };
	if (scheme === 'mailto:' && isMailtoUrl(trimmed)) return { kind: 'external', href: trimmed };
	if (scheme === 'http:' && isAbsoluteWebUrl(trimmed, 'http:')) return { kind: 'insecureHttp', href: trimmed };
	if (scheme) return { kind: 'blocked', value: trimmed };

	// An authored Markdown link must not be able to name an absolute local path.
	// Local note links are resolved relative to the note and then confined again
	// by the host before any filesystem API is called.
	if (trimmed.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
		return { kind: 'blocked', value: trimmed };
	}

	// Drop a trailing `#fragment` so it cannot end up inside the filename, and
	// undo percent-encoding — a Markdown link to a file whose name contains a
	// space is normally written `my%20note.md`, and the filesystem wants the
	// space back.
	const hash = trimmed.indexOf('#');
	const query = trimmed.indexOf('?');
	const pathEnd = Math.min(...[hash, query].filter((index) => index >= 0), trimmed.length);
	const rawPath = trimmed.slice(0, pathEnd);
	if (!rawPath) return { kind: 'ignore' };
	let path = rawPath;
	try {
		path = decodeURIComponent(rawPath);
	} catch {
		return { kind: 'blocked', value: trimmed };
	}
	if (/\p{Cc}/u.test(path) || path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(path)) {
		return { kind: 'blocked', value: trimmed };
	}
	if (hash === -1) return { kind: 'relative', path };
	const fragment = decodeFragment(trimmed.slice(hash));
	return fragment ? { kind: 'relative', path, fragment } : { kind: 'blocked', value: trimmed };
}

export function isAbsoluteWebUrl(value: string, protocol: 'http:' | 'https:'): boolean {
	try {
		const authority = value.slice(protocol.length);
		if (!authority.startsWith('//') || authority.length <= 2 || authority[2] === '/' || authority[2] === '\\') {
			return false;
		}
		const parsed = new URL(value);
		return parsed.protocol === protocol && Boolean(parsed.hostname);
	} catch {
		return false;
	}
}

function isMailtoUrl(value: string): boolean {
	try {
		// Percent-encoded CR/LF and other controls are just as dangerous as their
		// literal forms: once a mail client decodes them they can split or inject
		// headers. Decode the complete authored URI before handing it to the OS.
		// A malformed escape sequence also fails closed.
		const decoded = decodeURIComponent(value);
		if (/[\u0000-\u001f\u007f]/.test(decoded)) return false;
		const parsed = new URL(value);
		// An empty recipient is not a useful navigation target.
		return parsed.protocol === 'mailto:' && parsed.pathname.length > 0;
	} catch {
		return false;
	}
}

function decodeFragment(value: string): string | undefined {
	try {
		const decoded = decodeURIComponent(value);
		return decoded.length > 1 && decoded.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(decoded) ? decoded : undefined;
	} catch {
		return undefined;
	}
}
