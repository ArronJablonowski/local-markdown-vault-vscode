import { describe, expect, it } from 'vitest';
import { MAX_EDITOR_DOCUMENT_BYTES } from '../shared/messageValidation';
import {
	classifyDraftRecovery,
	makeDraftRecovery,
	mergeDraftRecovery,
	parseDraftRecovery,
	readPersistedDraftRecovery,
	stripDraftRecovery,
} from './draftRecovery';

const ui = { version: 1 as const, anchor: 3, head: 5, scrollTop: 80.5 };
const snapshot = { version: 1 as const, baselineText: 'Before', draftText: 'Before\nDraft 🙂', currentVaultPath: 'Notes/Meeting.md' };

describe('bounded local draft recovery', () => {
	it('round-trips one snapshot with the existing caret/scroll hints', () => {
		const state = mergeDraftRecovery(ui, snapshot);
		expect(state).toEqual({ ...ui, recovery: snapshot });
		expect(readPersistedDraftRecovery(state)).toEqual(snapshot);
		expect(stripDraftRecovery(state, snapshot.draftText.length)).toEqual(ui);
		expect(state?.recovery).not.toBe(snapshot);
	});

	it('retains only the newest snapshot without accumulating prior contents', () => {
		const previous = mergeDraftRecovery(ui, snapshot);
		const latest = { ...snapshot, draftText: 'Newest note' };
		const state = mergeDraftRecovery(previous, latest);
		expect(state).toEqual({ ...ui, recovery: latest });
		expect(JSON.stringify(state)).not.toContain('Before\\nDraft');
	});

	it('uses safe UI defaults when there are no valid hints, without losing a valid draft', () => {
		for (const value of [undefined, null, { ...ui, head: 99 }, { ...ui, dangerous: 'extra' }]) {
			expect(mergeDraftRecovery(value, snapshot)).toEqual({ version: 1, anchor: 0, head: 0, scrollTop: 0, recovery: snapshot });
		}
	});

	it('removes all recovery text from clean persisted state without mutating the journal', () => {
		const state = mergeDraftRecovery(ui, snapshot);
		const stripped = stripDraftRecovery(state, snapshot.draftText.length);
		expect(Object.keys(stripped!)).toEqual(['version', 'anchor', 'head', 'scrollTop']);
		expect(readPersistedDraftRecovery(stripped)).toBeUndefined();
		expect(readPersistedDraftRecovery(state)).toEqual(snapshot);
		expect(stripDraftRecovery(ui, snapshot.draftText.length)).toEqual(ui);
	});

	it('does not manufacture a recovery record for unchanged text', () => {
		expect(makeDraftRecovery('Same', 'Same', 'Note.md')).toBeUndefined();
		expect(makeDraftRecovery('', 'First keystroke', '')).toEqual({
			version: 1, baselineText: '', draftText: 'First keystroke', currentVaultPath: '',
		});
	});

	it.each([
		['Before\nDraft 🙂', 'Notes/Meeting.md', 'matches-draft'],
		['Before', 'Notes/Meeting.md', 'unchanged-baseline'],
		['External text', 'Notes/Meeting.md', 'divergent'],
		['Before', 'Other.md', 'divergent'],
		['Before\nDraft 🙂', 'Other.md', 'divergent'],
		['Before', '', 'divergent'],
		['before', 'Notes/Meeting.md', 'divergent'],
	])('classifies host text %j at %j as %s', (text, path, expected) => {
		expect(classifyDraftRecovery(snapshot, text, path)).toBe(expected);
	});

	it('fails closed on malformed host snapshots and identities', () => {
		expect(classifyDraftRecovery(snapshot, null, 'Notes/Meeting.md')).toBe('divergent');
		expect(classifyDraftRecovery(snapshot, 'Before', {})).toBe('divergent');
		expect(classifyDraftRecovery({ ...snapshot, version: 2 }, 'Before', 'Notes/Meeting.md')).toBe('divergent');
	});

	it('never replays invalid widget input into an unchanged source document', () => {
		const residual = { ...snapshot, requiresSeparatePreservation: true as const };
		expect(parseDraftRecovery(residual)).toEqual(residual);
		expect(readPersistedDraftRecovery(mergeDraftRecovery(ui, residual))).toEqual(residual);
		expect(classifyDraftRecovery(residual, snapshot.baselineText, snapshot.currentVaultPath)).toBe('divergent');
		expect(parseDraftRecovery({ ...residual, requiresSeparatePreservation: false })).toBeUndefined();
	});

	it.each([
		null, undefined, [], {},
		{ ...snapshot, version: 2 },
		{ ...snapshot, baselineText: 0 },
		{ ...snapshot, draftText: null },
		{ ...snapshot, currentVaultPath: [] },
		{ ...snapshot, unexpected: true },
		{ baselineText: 'Before', draftText: 'Draft', currentVaultPath: 'Note.md' },
	])('rejects an invalid recovery shape %#', value => {
		expect(parseDraftRecovery(value)).toBeUndefined();
		expect(mergeDraftRecovery(ui, value)).toBeUndefined();
	});

	it.each(['/outside.md', '../Note.md', 'Notes/../Note.md', 'Notes/./Note.md', 'Notes//Note.md', 'Notes/', 'C:/Note.md', 'Notes\\Note.md', 'Notes/\u0000Note.md', 'Notes/\nNote.md'])('rejects a noncanonical path %j', path => {
		expect(makeDraftRecovery('Before', 'Draft', path)).toBeUndefined();
	});

	it('bounds path bytes, while accepting ordinary Unicode vault names', () => {
		expect(makeDraftRecovery('Before', 'Draft', '\u65e5\u672c\u8a9e/Meeting 🙂.md')).toBeDefined();
		expect(makeDraftRecovery('Before', 'Draft', 'a'.repeat(4097))).toBeUndefined();
		expect(makeDraftRecovery('Before', 'Draft', '🙂'.repeat(1025))).toBeUndefined();
	});

	it('bounds both original and draft text by UTF-8 bytes, not character count', () => {
		const oversized = 'a'.repeat(MAX_EDITOR_DOCUMENT_BYTES + 1);
		expect(parseDraftRecovery({ ...snapshot, baselineText: oversized })).toBeUndefined();
		expect(parseDraftRecovery({ ...snapshot, draftText: oversized })).toBeUndefined();
		const multibyte = '🙂'.repeat(Math.floor(MAX_EDITOR_DOCUMENT_BYTES / 4) + 1);
		expect(multibyte.length).toBeLessThan(MAX_EDITOR_DOCUMENT_BYTES);
		expect(parseDraftRecovery({ ...snapshot, draftText: multibyte })).toBeUndefined();
		expect(classifyDraftRecovery(snapshot, oversized, snapshot.currentVaultPath)).toBe('divergent');
	});

	it('accepts the byte boundary without modifying Markdown or line endings', () => {
		const draftText = 'a'.repeat(MAX_EDITOR_DOCUMENT_BYTES);
		expect(parseDraftRecovery({ ...snapshot, draftText })?.draftText).toBe(draftText);
		const markdown = '---\r\ntitle: Draft\r\n---\r\n\r\n- [x] 🙂\r\n';
		expect(makeDraftRecovery('', markdown, 'Note.md')?.draftText).toBe(markdown);
	});

	it('rejects envelopes with extra fields, missing fields, or invalid UI bounds', () => {
		const valid = mergeDraftRecovery(ui, snapshot)!;
		for (const value of [
			{ ...valid, extra: true }, { recovery: snapshot }, { ...valid, version: 2 },
			{ ...valid, head: snapshot.draftText.length + 1 }, { ...valid, anchor: -1 },
			{ ...valid, scrollTop: Number.NaN }, { ...valid, scrollTop: 1_000_000_001 },
			{ ...valid, recovery: { ...snapshot, extra: true } },
		]) expect(readPersistedDraftRecovery(value)).toBeUndefined();
		expect(stripDraftRecovery(valid, Number.POSITIVE_INFINITY)).toBeUndefined();
		expect(stripDraftRecovery(valid, -1)).toBeUndefined();
	});

	it('does not evaluate accessors or copy hidden/symbol fields from untrusted state', () => {
		let accessed = false;
		const accessor = { ...snapshot };
		Object.defineProperty(accessor, 'draftText', { get: () => { accessed = true; return 'Unexpected'; } });
		expect(parseDraftRecovery(accessor)).toBeUndefined();
		expect(accessed).toBe(false);
		expect(parseDraftRecovery({ ...snapshot, [Symbol('extra')]: true })).toBeUndefined();
		const inherited = Object.create(snapshot);
		expect(parseDraftRecovery(inherited)).toBeUndefined();
	});
});
