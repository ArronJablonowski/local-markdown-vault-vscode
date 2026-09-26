const REDACTED = '[redacted]';
const MAX_FIELDS = 16;
const MAX_KEY_LENGTH = 40;
const MAX_VALUE_LENGTH = 200;

export type DiagnosticFields = Readonly<Record<string, unknown>>;

/** Bound both repeated events and distinct event keys so diagnostics cannot grow without limit. */
export class DiagnosticRateLimiter {
	private readonly lastAccepted = new Map<string, number>();

	constructor(private readonly intervalMs = 1_000, private readonly maxKeys = 128) {
		if (!Number.isFinite(intervalMs) || intervalMs <= 0 || !Number.isInteger(maxKeys) || maxKeys <= 0) {
			throw new Error('Diagnostic rate limits must be positive.');
		}
	}

	accept(key: string, now = Date.now()): boolean {
		if (!Number.isFinite(now)) return false;
		const previous = this.lastAccepted.get(key);
		if (previous !== undefined && now - previous < this.intervalMs) return false;
		if (previous === undefined && this.lastAccepted.size >= this.maxKeys) {
			const oldest = this.lastAccepted.keys().next().value as string | undefined;
			if (oldest !== undefined) this.lastAccepted.delete(oldest);
		}
		this.lastAccepted.delete(key);
		this.lastAccepted.set(key, now);
		return true;
	}

	clear(): void { this.lastAccepted.clear(); }
}

/** Keeps recent, already-sanitized lines; this storage bound does not redact their contents. */
export class BoundedDiagnosticBuffer {
	private readonly entries: string[] = [];
	private characters = 0;

	constructor(private readonly maxEntries: number, private readonly maxCharacters: number) {
		if (!Number.isInteger(maxEntries) || maxEntries <= 0 || !Number.isInteger(maxCharacters) || maxCharacters <= 0) {
			throw new Error('Diagnostic buffer limits must be positive integers.');
		}
	}

	push(line: string): void {
		const bounded = line.slice(0, this.maxCharacters);
		this.entries.push(bounded);
		this.characters += bounded.length + 1;
		while (this.entries.length > this.maxEntries || this.characters > this.maxCharacters) {
			this.characters -= (this.entries.shift()?.length ?? 0) + 1;
		}
	}

	clear(): void {
		this.entries.length = 0;
		this.characters = 0;
	}

	snapshot(): readonly string[] { return [...this.entries]; }
	get size(): number { return this.entries.length; }
	get characterCount(): number { return this.characters; }
}

/**
 * Converts structured diagnostics into a small, single-line, privacy-safe
 * object. Sensitive field names are never inspected and Error messages are
 * never retained because both can contain Markdown or absolute paths.
 */
export function sanitizeDiagnosticFields(fields: DiagnosticFields): Record<string, string | number | boolean> {
	const sanitized: Record<string, string | number | boolean> = {};
	for (const [index, [rawKey, value]] of Object.entries(fields).slice(0, MAX_FIELDS).entries()) {
		const key = safeFieldKey(rawKey, index, sanitized);
		if (isSensitiveKey(rawKey)) {
			sanitized[key] = REDACTED;
			continue;
		}
		if (value instanceof Error) {
			sanitized[key] = '[error]';
			continue;
		}
		if (typeof value === 'boolean') sanitized[key] = value;
		else if (typeof value === 'number') sanitized[key] = Number.isFinite(value) ? value : REDACTED;
		else if (typeof value === 'string') sanitized[key] = sanitizeString(value);
		else if (Array.isArray(value)) sanitized[key] = `[array:${Math.min(value.length, 10_000)}]`;
		else if (value === null || value === undefined) sanitized[key] = String(value);
		else sanitized[key] = '[object]';
	}
	return sanitized;
}

export function sanitizeDiagnosticEventName(event: string): string {
	return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(event) ? event : 'diagnostic.event';
}

function safeFieldKey(
	rawKey: string,
	index: number,
	existing: Readonly<Record<string, unknown>>,
): string {
	const safe = new RegExp(`^[A-Za-z][A-Za-z0-9_.-]{0,${MAX_KEY_LENGTH - 1}}$`).test(rawKey)
		&& !['__proto__', 'constructor', 'prototype'].includes(rawKey);
	const base = safe ? rawKey : `field_${index}`;
	if (!Object.prototype.hasOwnProperty.call(existing, base)) return base;
	let suffix = 1;
	while (true) {
		const suffixText = `_${suffix}`;
		const candidate = `${base.slice(0, MAX_KEY_LENGTH - suffixText.length)}${suffixText}`;
		if (!Object.prototype.hasOwnProperty.call(existing, candidate)) return candidate;
		suffix += 1;
	}
}

function isSensitiveKey(key: string): boolean {
	return /(?:body|content|source|markdown|clipboard|text|url|uri|href|absolute|password|secret|token|authorization|cookie)/i.test(key);
}

function sanitizeString(value: string): string {
	let result = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
	// Redact the complete value when it contains a credential, URL, or absolute
	// path. Whole-value redaction prevents a path containing spaces from leaking
	// its suffix and still preserves ordinary vault-relative paths.
	if (/(?:\b(?:authorization|cookie|password|secret|token)\b\s*[:=]|\b(?:bearer|basic)\s+\S+)/i.test(result)) return REDACTED;
	if (/(?:^|[^A-Za-z0-9_.\\\/-])(?:~\/|\/(?![/*])|[A-Za-z]:[\\/]|\\\\|%2f|%5c%5c)/i.test(result)) return '[absolute-path]';
	if (/(?:^|[\s"'(<\[=,;])[A-Za-z][A-Za-z0-9+.-]{1,20}:(?:\/\/)?\S/i.test(result)) return '[url]';
	if (result.length > MAX_VALUE_LENGTH) result = `${result.slice(0, MAX_VALUE_LENGTH - 1)}…`;
	return result;
}
