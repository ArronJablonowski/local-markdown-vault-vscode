import { EDITOR_PROTOCOL_VERSION, type EditorToHostMessage, type HostToEditorMessage, type TextChange } from './messages';
import { isDrawioPath } from './drawioPath';
import { resolveLinkTarget } from './linkTarget';
import { isCanonicalVaultNoteIdentity, MAX_VAULT_NOTE_CHUNK_BYTES } from './vaultNoteSummary';
import { isSafeWikiAlias } from '../vault/LinkResolver';

export const MAX_EDITOR_MESSAGE_TEXT_BYTES = 1024 * 1024;
export const MAX_EDIT_CHANGES = 1000;
export const MAX_PASTED_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_PASTED_IMAGE_OPERATION_BYTES = 40 * 1024 * 1024;
export const MAX_PASTED_IMAGE_COUNT = 32;
const MAX_BASE64_LENGTH = Math.ceil(MAX_PASTED_IMAGE_BYTES / 3) * 4;
const MAX_LINK_LENGTH = 8192;
const MAX_PATH_LENGTH = 4096;
const RASTER_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']);
export const MAX_EDITOR_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MAX_CSS_BYTES = 1024 * 1024;
const MAX_DRAWIO_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_EMBED_TEXT_BYTES = 1024 * 1024;
const MAX_CODE_BLOCKS = 10_000;
const MAX_CODE_TOKENS = 200_000;
const MAX_VAULT_NOTES = 10_000;
const MAX_VAULT_NOTES_PER_CHUNK = 100;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withinByteLimit(value: string, maximum: number): boolean {
	// UTF-8 is never shorter than the number of UTF-16 code units for valid JS
	// strings. Reject this cheap lower bound first so validation never allocates
	// a second attacker-sized buffer merely to discover that it is oversized.
	return value.length <= maximum && new TextEncoder().encode(value).byteLength <= maximum;
}

/** Accepts only the canonical slash-separated relative paths emitted by the host. */
function validVaultRelativePath(value: unknown, allowEmpty = false): value is string {
	if (typeof value !== 'string' || value.length > MAX_PATH_LENGTH) return false;
	if (value === '') return allowEmpty;
	if (/[/\\]/.test(value[0]) || /^[a-z]:/i.test(value) || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return false;
	const segments = value.split('/');
	return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

export function isEditorDocumentWithinLimit(value: string): boolean {
	return withinByteLimit(value, MAX_EDITOR_DOCUMENT_BYTES);
}

function hasExactKeys(value: Record<string, unknown>, required: string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...required].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function withinSerializedByteLimit(value: unknown, maximum: number): boolean {
	try {
		return withinByteLimit(JSON.stringify(value), maximum);
	} catch {
		return false;
	}
}

function validCodeBlocks(value: unknown, documentLength: number): boolean {
	if (!Array.isArray(value) || value.length > MAX_CODE_BLOCKS) return false;
	let tokenCount = 0;
	for (const block of value) {
		if (!isRecord(block) || !hasExactKeys(block, ['from', 'to', 'tokens'])) return false;
		if (!isNonNegativeInteger(block.from) || !isNonNegativeInteger(block.to) || block.from > block.to || block.to > documentLength) return false;
		if (!Array.isArray(block.tokens)) return false;
		tokenCount += block.tokens.length;
		if (tokenCount > MAX_CODE_TOKENS) return false;
		let previousEnd = block.from as number;
		for (const token of block.tokens) {
			if (!isRecord(token) || !hasExactKeys(token, ['from', 'to', 'style'])) return false;
			if (!isNonNegativeInteger(token.from) || !isNonNegativeInteger(token.to) ||
				token.from < previousEnd || token.from > token.to || token.from < block.from || token.to > block.to) return false;
			if (typeof token.style !== 'string' || !validCodeTokenStyle(token.style)) return false;
			previousEnd = token.to;
		}
	}
	return true;
}

function validCodeTokenStyle(style: string): boolean {
	if (style.length === 0 || style.length > 128) return false;
	const seen = new Set<string>();
	for (const rawDeclaration of style.split(';')) {
		const declaration = rawDeclaration.trim();
		const separator = declaration.indexOf(':');
		if (separator <= 0) return false;
		const property = declaration.slice(0, separator).trim().toLowerCase();
		const value = declaration.slice(separator + 1).trim().toLowerCase();
		if (seen.has(property)) return false;
		seen.add(property);
		if (property === 'color' && /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(value)) continue;
		if (property === 'font-style' && value === 'italic') continue;
		if (property === 'font-weight' && value === 'bold') continue;
		if (property === 'text-decoration' && value === 'underline') continue;
		return false;
	}
	return seen.has('color');
}

function validVaultNotes(value: unknown): boolean {
	if (!Array.isArray(value) || value.length > MAX_VAULT_NOTES) return false;
	let totalEntries = 0;
	let totalCharacters = 0;
	return value.every((note) => {
		if (!isRecord(note) || !hasExactKeys(note, ['path', 'basename', 'aliases', 'headings', 'blockIds'])) return false;
		if (!validVaultRelativePath(note.path) || typeof note.basename !== 'string' || !isCanonicalVaultNoteIdentity(note.path, note.basename)) return false;
		if (!Array.isArray(note.aliases) || note.aliases.length > 100 || note.aliases.some((item) => typeof item !== 'string' || !isSafeWikiAlias(item))) return false;
		if (!Array.isArray(note.blockIds) || note.blockIds.length > 10_000 || note.blockIds.some((item) => typeof item !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(item))) return false;
		if (!Array.isArray(note.headings) || note.headings.length > 10_000) return false;
		totalEntries += note.aliases.length + note.blockIds.length + note.headings.length;
		totalCharacters += note.path.length + note.basename.length +
			note.aliases.reduce((sum, item) => sum + (item as string).length, 0) +
			note.blockIds.reduce((sum, item) => sum + (item as string).length, 0);
		if (totalEntries > 100_000 || totalCharacters > 500_000) return false;
		return note.headings.every((heading) => {
			if (!isRecord(heading) || !hasExactKeys(heading, ['text', 'line']) ||
				typeof heading.text !== 'string' || heading.text.length === 0 || heading.text.length > 4096 ||
				/[\u0000-\u0008\u000a-\u001f\u007f]/.test(heading.text) || !isNonNegativeInteger(heading.line) || heading.line < 1) return false;
			totalCharacters += heading.text.length;
			return totalCharacters <= 500_000;
		});
	});
}

/** Runtime validation for messages entering the webview from the host/event bus. */
export function validateHostToEditorMessage(
	value: unknown,
	documentLength: number,
): ValidationResult<HostToEditorMessage> {
	if (!isRecord(value) || typeof value.type !== 'string') return { ok: false, reason: 'Message is not an object.' };
	switch (value.type) {
		case 'draftPreserved':
			return hasExactKeys(value, ['type', 'requestId', 'ok']) && isNonNegativeInteger(value.requestId) && typeof value.ok === 'boolean'
				? { ok: true, value: value as unknown as HostToEditorMessage }
				: { ok: false, reason: 'Invalid recovery result.' };
		case 'copyCodeResult':
			return hasExactKeys(value, ['type', 'requestId', 'ok']) && isNonNegativeInteger(value.requestId) && typeof value.ok === 'boolean'
				? { ok: true, value: value as unknown as HostToEditorMessage }
				: { ok: false, reason: 'Invalid clipboard result.' };
		case 'init': {
			const keys = [
				'type',
				'protocolVersion',
				'text',
				'version',
				'css',
				'codeTheme',
				'remoteMedia',
				'workspaceTrusted',
				'diagramRenderingAllowed',
				'editingMode',
				'vaultNotes',
				'currentVaultPath',
			];
			if (!hasExactKeys(value, keys)) return { ok: false, reason: 'Unexpected init fields.' };
			if (
				value.protocolVersion !== EDITOR_PROTOCOL_VERSION ||
				typeof value.text !== 'string' || !isEditorDocumentWithinLimit(value.text) ||
				!isNonNegativeInteger(value.version) ||
				typeof value.css !== 'string' || !withinByteLimit(value.css, MAX_CSS_BYTES) ||
				typeof value.codeTheme !== 'string' || value.codeTheme.length > 128 ||
				(value.remoteMedia !== 'block' && value.remoteMedia !== 'https') ||
				typeof value.workspaceTrusted !== 'boolean' ||
				typeof value.diagramRenderingAllowed !== 'boolean' ||
				(value.editingMode !== 'editing' && value.editingMode !== 'locked') ||
				!validVaultRelativePath(value.currentVaultPath, true) ||
				!validVaultNotes(value.vaultNotes) ||
				!withinSerializedByteLimit(value.vaultNotes, MAX_VAULT_NOTE_CHUNK_BYTES)
			) return { ok: false, reason: 'Invalid init message.' };
			return { ok: true, value: value as unknown as HostToEditorMessage };
		}
		case 'externalUpdate':
			if (!hasExactKeys(value, ['type', 'changes', 'version']) || !isNonNegativeInteger(value.version) || !validChanges(value.changes, documentLength)) {
				return { ok: false, reason: 'Invalid external update.' };
			}
			return { ok: true, value: value as unknown as HostToEditorMessage };
		case 'ackEdit':
			if (!hasExactKeys(value, ['type', 'version']) || !isNonNegativeInteger(value.version)) return { ok: false, reason: 'Invalid edit acknowledgement.' };
			return { ok: true, value: value as unknown as HostToEditorMessage };
		case 'codeTokens':
			if (!hasExactKeys(value, ['type', 'blocks']) || !validCodeBlocks(value.blocks, documentLength)) return { ok: false, reason: 'Invalid code tokens.' };
			return { ok: true, value: value as unknown as HostToEditorMessage };
		case 'setWhitespace':
			return hasExactKeys(value, ['type', 'enabled']) && typeof value.enabled === 'boolean'
				? { ok: true, value: value as unknown as HostToEditorMessage }
				: { ok: false, reason: 'Invalid whitespace setting.' };
		case 'panelVisibility':
			return hasExactKeys(value, ['type', 'visible']) && typeof value.visible === 'boolean'
				? { ok: true, value: value as unknown as HostToEditorMessage }
				: { ok: false, reason: 'Invalid panel visibility.' };
		case 'applyCss':
			if (!hasExactKeys(value, ['type', 'css']) || typeof value.css !== 'string' || !withinByteLimit(value.css, MAX_CSS_BYTES)) return { ok: false, reason: 'Invalid CSS message.' };
			return { ok: true, value: value as unknown as HostToEditorMessage };
		case 'jumpToLine':
			if (!hasExactKeys(value, ['type', 'line']) || !isNonNegativeInteger(value.line) || value.line > 10_000_000) return { ok: false, reason: 'Invalid line request.' };
			return { ok: true, value: value as unknown as HostToEditorMessage };
		case 'setCursor':
			if (!hasExactKeys(value, ['type', 'pos']) || !isNonNegativeInteger(value.pos) || value.pos > documentLength) return { ok: false, reason: 'Invalid cursor request.' };
			return { ok: true, value: value as unknown as HostToEditorMessage };
		case 'vaultNotes':
			return hasExactKeys(value, ['type', 'notes']) && validVaultNotes(value.notes) &&
				withinSerializedByteLimit(value, MAX_VAULT_NOTE_CHUNK_BYTES)
				? { ok: true, value: value as unknown as HostToEditorMessage }
				: { ok: false, reason: 'Invalid vault note metadata.' };
		case 'vaultNotesChunk':
			return hasExactKeys(value, ['type', 'generation', 'offset', 'total', 'notes']) &&
				isNonNegativeInteger(value.generation) && isNonNegativeInteger(value.offset) &&
				isNonNegativeInteger(value.total) && value.total <= MAX_VAULT_NOTES &&
				Array.isArray(value.notes) && value.notes.length <= MAX_VAULT_NOTES_PER_CHUNK &&
				value.offset <= value.total && value.offset + value.notes.length <= value.total &&
				validVaultNotes(value.notes) && withinSerializedByteLimit(value, MAX_VAULT_NOTE_CHUNK_BYTES)
				? { ok: true, value: value as unknown as HostToEditorMessage }
				: { ok: false, reason: 'Invalid vault note metadata chunk.' };
		case 'invalidateDrawioFiles':
			return hasExactKeys(value, ['type'])
				? { ok: true, value: { type: 'invalidateDrawioFiles' } }
				: { ok: false, reason: 'Invalid draw.io invalidation.' };
		case 'drawioFile': {
			if (!isNonNegativeInteger(value.requestId)) return { ok: false, reason: 'Invalid draw.io reply.' };
			const textReply = hasExactKeys(value, ['type', 'requestId', 'text']) && typeof value.text === 'string' && withinByteLimit(value.text, MAX_DRAWIO_TEXT_BYTES);
			const errorReply = hasExactKeys(value, ['type', 'requestId', 'error']) && typeof value.error === 'string' && value.error.length <= 2048;
			return textReply || errorReply
				? { ok: true, value: value as unknown as HostToEditorMessage }
				: { ok: false, reason: 'Invalid draw.io reply.' };
		}
		case 'wikiEmbed': {
			if (!isNonNegativeInteger(value.requestId)) return { ok: false, reason: 'Invalid wiki embed reply.' };
			const contentReply = hasExactKeys(value, ['type', 'requestId', 'sourcePath', 'text']) &&
				validVaultRelativePath(value.sourcePath) &&
				typeof value.text === 'string' && withinByteLimit(value.text, MAX_EMBED_TEXT_BYTES);
			const errorReply = hasExactKeys(value, ['type', 'requestId', 'error']) &&
				typeof value.error === 'string' && value.error.length <= 2048;
			return contentReply || errorReply
				? { ok: true, value: value as unknown as HostToEditorMessage }
				: { ok: false, reason: 'Invalid wiki embed reply.' };
		}
		case 'localImage': {
			if (!isNonNegativeInteger(value.requestId)) return { ok: false, reason: 'Invalid local image reply.' };
			const contentReply = hasExactKeys(value, ['type', 'requestId', 'mimeType', 'dataBase64']) &&
				typeof value.mimeType === 'string' && RASTER_IMAGE_MIMES.has(value.mimeType.toLowerCase()) &&
				typeof value.dataBase64 === 'string' && validBase64(value.dataBase64);
			const errorReply = hasExactKeys(value, ['type', 'requestId', 'error']) &&
				typeof value.error === 'string' && value.error.length <= 2048;
			return contentReply || errorReply
				? { ok: true, value: value as unknown as HostToEditorMessage }
				: { ok: false, reason: 'Invalid local image reply.' };
		}
		default:
			return { ok: false, reason: 'Unknown message type.' };
	}
}

function isNonNegativeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validChanges(value: unknown, documentLength: number): value is TextChange[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EDIT_CHANGES) return false;
	let previousTo = -1;
	let insertedBytes = 0;
	for (const item of value) {
		if (!isRecord(item) || !hasExactKeys(item, ['from', 'to', 'insert'])) return false;
		if (!isNonNegativeInteger(item.from) || !isNonNegativeInteger(item.to)) return false;
		if (item.from > item.to || item.to > documentLength || item.from < previousTo) return false;
		if (typeof item.insert !== 'string') return false;
		const remainingBytes = MAX_EDITOR_MESSAGE_TEXT_BYTES - insertedBytes;
		if (item.insert.length > remainingBytes) return false;
		insertedBytes += new TextEncoder().encode(item.insert).byteLength;
		if (insertedBytes > MAX_EDITOR_MESSAGE_TEXT_BYTES) return false;
		previousTo = item.to;
	}
	return true;
}

function decodedBase64Length(value: unknown): number | undefined {
	if (typeof value !== 'string' || value.length === 0 || value.length > MAX_BASE64_LENGTH) return undefined;
	if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return undefined;
	const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
	// Reject non-zero unused bits in the final quantum. Node and browsers often
	// decode these non-canonical spellings permissively, so a round-trip textual
	// check would otherwise be needed (and would allocate another payload-sized
	// buffer). The alphabet index exposes those unused bits directly.
	if (padding > 0) {
		const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
		const finalIndex = alphabet.indexOf(value[value.length - padding - 1]);
		if (finalIndex < 0 || (padding === 2 ? (finalIndex & 0x0f) !== 0 : (finalIndex & 0x03) !== 0)) return undefined;
	}
	const decodedLength = (value.length / 4) * 3 - padding;
	return decodedLength <= MAX_PASTED_IMAGE_BYTES ? decodedLength : undefined;
}

function validBase64(value: unknown): value is string {
	return decodedBase64Length(value) !== undefined;
}

/**
 * Runtime validation for the privileged webview-to-extension boundary.
 * TypeScript types disappear at runtime, and a compromised webview can forge
 * any object, so callers must parse `unknown` before dispatching a message.
 */
export function validateEditorToHostMessage(
	value: unknown,
	documentLength: number,
	currentDocumentVersion?: number,
): ValidationResult<EditorToHostMessage> {
	if (!isRecord(value) || typeof value.type !== 'string') return { ok: false, reason: 'Message is not an object.' };

	switch (value.type) {
		case 'copyCode':
			return hasExactKeys(value, ['type', 'requestId', 'text']) && isNonNegativeInteger(value.requestId)
				&& typeof value.text === 'string' && withinByteLimit(value.text, MAX_EDITOR_MESSAGE_TEXT_BYTES)
				? { ok: true, value: value as unknown as EditorToHostMessage }
				: { ok: false, reason: 'Invalid clipboard request.' };
		case 'draftSnapshot':
			return (hasExactKeys(value, ['type', 'text', 'baselineText']) ||
				(hasExactKeys(value, ['type', 'text', 'baselineText', 'requiresSeparatePreservation']) && value.requiresSeparatePreservation === true))
				&& typeof value.text === 'string' && isEditorDocumentWithinLimit(value.text)
				&& typeof value.baselineText === 'string' && isEditorDocumentWithinLimit(value.baselineText)
				? { ok: true, value: value as unknown as EditorToHostMessage }
				: { ok: false, reason: 'Invalid pending draft snapshot.' };
		case 'checkpoint':
			return hasExactKeys(value, ['type', 'requestId', 'text', 'baselineText']) && isNonNegativeInteger(value.requestId)
				&& typeof value.text === 'string' && isEditorDocumentWithinLimit(value.text)
				&& typeof value.baselineText === 'string' && isEditorDocumentWithinLimit(value.baselineText)
				? { ok: true, value: value as unknown as EditorToHostMessage }
				: { ok: false, reason: 'Invalid save checkpoint.' };
		case 'preserveDraft':
			return hasExactKeys(value, ['type', 'requestId', 'text']) && isNonNegativeInteger(value.requestId)
				&& typeof value.text === 'string' && isEditorDocumentWithinLimit(value.text)
				? { ok: true, value: value as unknown as EditorToHostMessage }
				: { ok: false, reason: 'Invalid recovery snapshot.' };
		case 'resync':
		case 'save':
		case 'ready':
		case 'undo':
		case 'redo':
			return hasExactKeys(value, ['type'])
				? { ok: true, value: value as unknown as EditorToHostMessage }
				: { ok: false, reason: 'Unexpected message fields.' };
		case 'edit':
			if (!hasExactKeys(value, ['type', 'baseVersion', 'changes'])) return { ok: false, reason: 'Unexpected edit fields.' };
			if (!isNonNegativeInteger(value.baseVersion) ||
				(currentDocumentVersion !== undefined && value.baseVersion !== currentDocumentVersion) ||
				!validChanges(value.changes, documentLength)) {
				return { ok: false, reason: 'Invalid edit batch.' };
			}
			return { ok: true, value: value as unknown as EditorToHostMessage };
		case 'openLink':
			if (!hasExactKeys(value, ['type', 'href']) || typeof value.href !== 'string' || value.href.length > MAX_LINK_LENGTH) {
				return { ok: false, reason: 'Invalid link request.' };
			}
			return { ok: true, value: value as unknown as EditorToHostMessage };
		case 'pasteImage':
			if (!hasExactKeys(value, ['type', 'atPos', 'mimeType', 'dataBase64', 'needsOwnParagraph'])) {
				return { ok: false, reason: 'Unexpected paste fields.' };
			}
			if (
				!isNonNegativeInteger(value.atPos) ||
				value.atPos > documentLength ||
				typeof value.mimeType !== 'string' ||
				!RASTER_IMAGE_MIMES.has(value.mimeType.toLowerCase()) ||
				!validBase64(value.dataBase64) ||
				typeof value.needsOwnParagraph !== 'boolean'
			) {
				return { ok: false, reason: 'Invalid pasted image.' };
			}
			return { ok: true, value: value as unknown as EditorToHostMessage };
		case 'pasteImages': {
			if (!hasExactKeys(value, ['type', 'atPos', 'images', 'needsOwnParagraph'])) {
				return { ok: false, reason: 'Unexpected paste fields.' };
			}
			if (
				!isNonNegativeInteger(value.atPos) || value.atPos > documentLength ||
				typeof value.needsOwnParagraph !== 'boolean' ||
				!Array.isArray(value.images) || value.images.length === 0 || value.images.length > MAX_PASTED_IMAGE_COUNT
			) return { ok: false, reason: 'Invalid pasted images.' };
			let totalBytes = 0;
			for (const image of value.images) {
				if (!isRecord(image) || !hasExactKeys(image, ['mimeType', 'dataBase64']) ||
					typeof image.mimeType !== 'string' || !RASTER_IMAGE_MIMES.has(image.mimeType.toLowerCase())) {
					return { ok: false, reason: 'Invalid pasted image.' };
				}
				const byteLength = decodedBase64Length(image.dataBase64);
				if (byteLength === undefined || totalBytes > MAX_PASTED_IMAGE_OPERATION_BYTES - byteLength) {
					return { ok: false, reason: 'Pasted image operation is too large.' };
				}
				totalBytes += byteLength;
			}
			return { ok: true, value: value as unknown as EditorToHostMessage };
		}
		case 'readDrawioFile': {
			const target = typeof value.src === 'string' ? resolveLinkTarget(value.src) : undefined;
			if (
				!hasExactKeys(value, ['type', 'requestId', 'src']) ||
				!isNonNegativeInteger(value.requestId) ||
				typeof value.src !== 'string' ||
				value.src.length === 0 ||
				value.src.length > MAX_PATH_LENGTH ||
				target?.kind !== 'relative' ||
				!isDrawioPath(target.path)
			) {
				return { ok: false, reason: 'Invalid draw.io request.' };
			}
			return { ok: true, value: value as unknown as EditorToHostMessage };
		}
		case 'readWikiEmbed':
			if (
				!hasExactKeys(value, ['type', 'requestId', 'body', 'contextPath']) ||
				!isNonNegativeInteger(value.requestId) ||
				typeof value.body !== 'string' || value.body.length === 0 || value.body.length > MAX_PATH_LENGTH ||
				/[\u0000-\u001f\u007f]/.test(value.body) ||
				!validVaultRelativePath(value.contextPath)
			) return { ok: false, reason: 'Invalid wiki embed request.' };
			return { ok: true, value: value as unknown as EditorToHostMessage };
		case 'resolveLocalImage':
			if (
				!hasExactKeys(value, ['type', 'requestId', 'src', 'contextPath']) ||
				!isNonNegativeInteger(value.requestId) ||
				typeof value.src !== 'string' || value.src.length === 0 || value.src.length > MAX_PATH_LENGTH ||
				!validVaultRelativePath(value.contextPath) ||
				/[\u0000-\u001f\u007f]/.test(value.src)
			) return { ok: false, reason: 'Invalid local image request.' };
			return { ok: true, value: value as unknown as EditorToHostMessage };
		default:
			return { ok: false, reason: 'Unknown message type.' };
	}
}
