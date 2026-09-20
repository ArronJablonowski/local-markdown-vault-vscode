import type {
	HostToOutlineMessage,
	HostToPreviewMessage,
	HostToSidebarMessage,
	OutlineToHostMessage,
	PreviewToHostMessage,
	SidebarToHostMessage,
} from './messages';
import type { ValidationResult } from './messageValidation';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

const safeId = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f/\\]/.test(value);
const encodedBytesWithin = (value: string, maximum: number): number | undefined => {
	if (value.length > maximum) return undefined;
	const bytes = new TextEncoder().encode(value).byteLength;
	return bytes <= maximum ? bytes : undefined;
};

export function validateOutlineToHostMessage(value: unknown): ValidationResult<OutlineToHostMessage> {
	if (!isRecord(value)) return { ok: false, reason: 'Invalid outline message.' };
	if (value.type === 'ready' && exact(value, ['type'])) return { ok: true, value: { type: 'ready' } };
	if (value.type === 'jumpToHeading' && exact(value, ['type', 'line']) && Number.isSafeInteger(value.line) && (value.line as number) >= 1 && (value.line as number) <= 10_000_000) {
		return { ok: true, value: value as unknown as OutlineToHostMessage };
	}
	return { ok: false, reason: 'Invalid outline message.' };
}

export function validatePreviewToHostMessage(value: unknown): ValidationResult<PreviewToHostMessage> {
	return isRecord(value) && value.type === 'ready' && exact(value, ['type'])
		? { ok: true, value: { type: 'ready' } }
		: { ok: false, reason: 'Invalid preview message.' };
}

export function validateSidebarToHostMessage(value: unknown): ValidationResult<SidebarToHostMessage> {
	if (!isRecord(value) || typeof value.type !== 'string') return { ok: false, reason: 'Invalid sidebar message.' };
	if ((value.type === 'ready' || value.type === 'newStyle') && exact(value, ['type'])) {
		return { ok: true, value: value as unknown as SidebarToHostMessage };
	}
	if (value.type === 'toggle' && exact(value, ['type', 'id', 'enabled']) && safeId(value.id) && typeof value.enabled === 'boolean') {
		return { ok: true, value: value as unknown as SidebarToHostMessage };
	}
	if (['openStyle', 'duplicateStyle', 'renameStyle', 'deleteStyle'].includes(value.type) && exact(value, ['type', 'id']) && safeId(value.id)) {
		return { ok: true, value: value as unknown as SidebarToHostMessage };
	}
	if (
		value.type === 'setSetting' && exact(value, ['type', 'key', 'value']) &&
		((value.key === 'defaultEditor' && ['prompt', 'livePreview', 'default'].includes(String(value.value))) ||
			(value.key === 'codeTheme' && ['auto', 'dark-plus', 'light-plus', 'github-dark', 'github-light'].includes(String(value.value))))
	) {
		return { ok: true, value: value as unknown as SidebarToHostMessage };
	}
	return { ok: false, reason: 'Invalid sidebar message.' };
}

export function validateHostToOutlineMessage(value: unknown): ValidationResult<HostToOutlineMessage> {
	if (!isRecord(value) || typeof value.type !== 'string') return { ok: false, reason: 'Invalid outline update.' };
	if (value.type === 'noDocument' && exact(value, ['type'])) return { ok: true, value: { type: 'noDocument' } };
	if (value.type !== 'update' || !exact(value, ['type', 'headings']) || !Array.isArray(value.headings) || value.headings.length > 10_000) return { ok: false, reason: 'Invalid outline update.' };
	for (const heading of value.headings) {
		if (!isRecord(heading) || !exact(heading, ['level', 'text', 'line'])) return { ok: false, reason: 'Invalid heading.' };
		if (!Number.isInteger(heading.level) || (heading.level as number) < 1 || (heading.level as number) > 6 || typeof heading.text !== 'string' || heading.text.length > 4096 || !Number.isSafeInteger(heading.line) || (heading.line as number) < 1) return { ok: false, reason: 'Invalid heading.' };
	}
	return { ok: true, value: value as unknown as HostToOutlineMessage };
}

export function validateHostToPreviewMessage(value: unknown): ValidationResult<HostToPreviewMessage> {
	if (!isRecord(value) || typeof value.type !== 'string') return { ok: false, reason: 'Invalid preview update.' };
	if (value.type === 'highlight' && exact(value, ['type', 'selector']) && (value.selector === null || (typeof value.selector === 'string' && value.selector.length <= 4096))) return { ok: true, value: value as unknown as HostToPreviewMessage };
	if (value.type === 'update' && exact(value, ['type', 'css', 'themeKind', 'name']) && typeof value.css === 'string' && encodedBytesWithin(value.css, 1024 * 1024) !== undefined && ['vscode-light', 'vscode-dark', 'vscode-high-contrast'].includes(String(value.themeKind)) && typeof value.name === 'string' && value.name.length <= 256) return { ok: true, value: value as unknown as HostToPreviewMessage };
	return { ok: false, reason: 'Invalid preview update.' };
}

export function validateHostToSidebarMessage(value: unknown): ValidationResult<HostToSidebarMessage> {
	if (!isRecord(value) || value.type !== 'init' || !exact(value, ['type', 'styles', 'settings', 'themeKind', 'workspaceTrusted']) || !Array.isArray(value.styles) || value.styles.length > 1_000 || !isRecord(value.settings) || typeof value.workspaceTrusted !== 'boolean') return { ok: false, reason: 'Invalid sidebar update.' };
	let cssLength = 0;
	for (const style of value.styles) {
		if (!isRecord(style) || !exact(style, ['id', 'name', 'enabled', 'css']) || !safeId(style.id) || typeof style.name !== 'string' || style.name.length > 256 || typeof style.enabled !== 'boolean' || typeof style.css !== 'string') return { ok: false, reason: 'Invalid style entry.' };
		const bytes = encodedBytesWithin(style.css, 1024 * 1024 - cssLength);
		if (bytes === undefined) return { ok: false, reason: 'Sidebar CSS exceeds limit.' };
		cssLength += bytes;
	}
	if (
		!exact(value.settings, ['defaultEditor', 'codeTheme']) ||
		!['prompt', 'livePreview', 'default'].includes(String(value.settings.defaultEditor)) ||
		!['auto', 'dark-plus', 'light-plus', 'github-dark', 'github-light'].includes(String(value.settings.codeTheme))
	) return { ok: false, reason: 'Invalid sidebar settings.' };
	if (!['vscode-light', 'vscode-dark', 'vscode-high-contrast'].includes(String(value.themeKind))) return { ok: false, reason: 'Invalid sidebar theme.' };
	return { ok: true, value: value as unknown as HostToSidebarMessage };
}
