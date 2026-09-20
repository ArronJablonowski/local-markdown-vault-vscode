export interface PersistedEditorState {
	version: 1;
	anchor: number;
	head: number;
	scrollTop: number;
}

const MAX_SCROLL_TOP = 1_000_000_000;

/**
 * Treat VS Code's webview state as untrusted persisted input. The state is only
 * a small UI hint; document text remains authoritative in the extension host.
 */
export function parsePersistedEditorState(value: unknown, documentLength: number): PersistedEditorState | undefined {
	if (!isRecord(value)) return undefined;
	if (Object.keys(value).some((key) => !['version', 'anchor', 'head', 'scrollTop'].includes(key))) return undefined;
	if (value.version !== 1) return undefined;
	if (!isBoundedInteger(value.anchor, 0, documentLength)) return undefined;
	if (!isBoundedInteger(value.head, 0, documentLength)) return undefined;
	if (!isBoundedFinite(value.scrollTop, 0, MAX_SCROLL_TOP)) return undefined;
	return { version: 1, anchor: value.anchor, head: value.head, scrollTop: value.scrollTop };
}

export function makePersistedEditorState(anchor: number, head: number, scrollTop: number): PersistedEditorState | undefined {
	const candidate = { version: 1 as const, anchor, head, scrollTop };
	return parsePersistedEditorState(candidate, Math.max(anchor, head));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
	return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

function isBoundedFinite(value: unknown, min: number, max: number): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
