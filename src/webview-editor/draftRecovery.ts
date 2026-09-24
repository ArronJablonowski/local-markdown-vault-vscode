import { isEditorDocumentWithinLimit } from '../shared/messageValidation';
import { parsePersistedEditorState, type PersistedEditorState } from './persistedState';

/** One local snapshot, not an unbounded edit/history journal. */
export interface DraftRecovery {
	version: 1;
	baselineText: string;
	draftText: string;
	currentVaultPath: string;
	/** Invalid widget input is recovery content, never a replacement document. */
	requiresSeparatePreservation?: true;
}

export interface PersistedEditorDraftState extends PersistedEditorState {
	recovery: DraftRecovery;
}

export type DraftRecoveryClassification = 'matches-draft' | 'unchanged-baseline' | 'divergent';

const UI_KEYS = ['version', 'anchor', 'head', 'scrollTop'];
const RECOVERY_KEYS = ['version', 'baselineText', 'draftText', 'currentVaultPath'];
const MAX_PATH_BYTES = 4096;

/** Persisted state is untrusted data; never copy unknown fields or accessors. */
function hasExactDataKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;
	const actual = Reflect.ownKeys(value);
	return actual.length === keys.length && actual.every(key =>
		typeof key === 'string' && keys.includes(key) &&
		'value' in Object.getOwnPropertyDescriptor(value, key)!,
	);
}

function validVaultPath(value: unknown): value is string {
	if (typeof value !== 'string' || value.length > MAX_PATH_BYTES) return false;
	if (new TextEncoder().encode(value).byteLength > MAX_PATH_BYTES) return false;
	// Empty means the current editor is not backed by a selected local vault.
	// The path is only an identity check, never authority for a filesystem write.
	if (value === '') return true;
	if (value.startsWith('/') || /^[a-z]:/i.test(value) || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return false;
	return value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

/** Both document snapshots must fit the existing editor's UTF-8 byte limit. */
export function parseDraftRecovery(value: unknown): DraftRecovery | undefined {
	if (!hasExactDataKeys(value, RECOVERY_KEYS) && !hasExactDataKeys(value, [...RECOVERY_KEYS, 'requiresSeparatePreservation'])) return undefined;
	if (value.version !== 1 || 'requiresSeparatePreservation' in value && value.requiresSeparatePreservation !== true) return undefined;
	if (typeof value.baselineText !== 'string' || typeof value.draftText !== 'string' ||
		!isEditorDocumentWithinLimit(value.baselineText) || !isEditorDocumentWithinLimit(value.draftText) ||
		!validVaultPath(value.currentVaultPath)) return undefined;
	return {
		version: 1,
		baselineText: value.baselineText,
		draftText: value.draftText,
		currentVaultPath: value.currentVaultPath,
		...(value.requiresSeparatePreservation === true ? { requiresSeparatePreservation: true as const } : {}),
	};
}

/** No recovery snapshot is needed when the local text equals its host baseline. */
export function makeDraftRecovery(baselineText: string, draftText: string, currentVaultPath: string): DraftRecovery | undefined {
	if (baselineText === draftText) return undefined;
	return parseDraftRecovery({ version: 1, baselineText, draftText, currentVaultPath });
}

/** Return bounded UI hints without carrying note contents into the clean state. */
export function stripDraftRecovery(value: unknown, documentLength: number): PersistedEditorState | undefined {
	if (!Number.isSafeInteger(documentLength) || documentLength < 0) return undefined;
	if (!hasExactDataKeys(value, UI_KEYS) && !hasExactDataKeys(value, [...UI_KEYS, 'recovery'])) return undefined;
	return parsePersistedEditorState({
		version: value.version, anchor: value.anchor, head: value.head, scrollTop: value.scrollTop,
	}, documentLength);
}

/** Merge a validated snapshot with UI hints, replacing rather than accumulating history. */
export function mergeDraftRecovery(value: unknown, candidate: unknown): PersistedEditorDraftState | undefined {
	const recovery = parseDraftRecovery(candidate);
	if (!recovery) return undefined;
	const ui = stripDraftRecovery(value, recovery.draftText.length) ?? {
		version: 1 as const, anchor: 0, head: 0, scrollTop: 0,
	};
	return { ...ui, recovery };
}

/** Read only the exact envelope produced above, including valid caret/scroll bounds. */
export function readPersistedDraftRecovery(value: unknown): DraftRecovery | undefined {
	if (!hasExactDataKeys(value, [...UI_KEYS, 'recovery'])) return undefined;
	const recovery = parseDraftRecovery(value.recovery);
	if (!recovery || !stripDraftRecovery(value, recovery.draftText.length)) return undefined;
	return recovery;
}

/**
 * Only an unchanged host baseline is safe to replay automatically. A changed
 * path or divergent host content must preserve the local text separately and
 * ask the user to reconcile it; never infer a merge from offsets or versions.
 */
export function classifyDraftRecovery(
	candidate: unknown,
	hostText: unknown,
	currentVaultPath: unknown,
): DraftRecoveryClassification {
	const recovery = parseDraftRecovery(candidate);
	if (!recovery || typeof hostText !== 'string' || !isEditorDocumentWithinLimit(hostText) ||
		!validVaultPath(currentVaultPath) || currentVaultPath !== recovery.currentVaultPath) return 'divergent';
	if (hostText === recovery.draftText) return 'matches-draft';
	if (recovery.requiresSeparatePreservation) return 'divergent';
	if (hostText === recovery.baselineText) return 'unchanged-baseline';
	return 'divergent';
}
