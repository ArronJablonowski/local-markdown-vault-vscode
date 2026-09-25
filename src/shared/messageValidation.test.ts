import { describe, expect, it } from 'vitest';
import {
	MAX_EDIT_CHANGES,
	MAX_EDITOR_DOCUMENT_BYTES,
	MAX_EDITOR_MESSAGE_TEXT_BYTES,
	MAX_PASTED_IMAGE_BYTES,
	MAX_PASTED_IMAGE_COUNT,
	isEditorDocumentWithinLimit,
	validateEditorToHostMessage,
	validateHostToEditorMessage,
} from './messageValidation';

describe('validateEditorToHostMessage', () => {
	it('accepts only an exact host draw.io invalidation signal', () => {
		expect(validateHostToEditorMessage({ type: 'invalidateDrawioFiles' }, 0).ok).toBe(true);
		expect(validateHostToEditorMessage({ type: 'invalidateDrawioFiles', src: '../../secret' }, 0).ok).toBe(false);
		expect(validateEditorToHostMessage({ type: 'invalidateDrawioFiles' }, 0, 0).ok).toBe(false);
	});
	it('accepts only boolean, exact whitespace display updates', () => {
		for (const enabled of [true, false]) expect(validateHostToEditorMessage({ type: 'setWhitespace', enabled }, 0).ok).toBe(true);
		for (const enabled of ['true', 1, null, {}]) expect(validateHostToEditorMessage({ type: 'setWhitespace', enabled }, 0).ok).toBe(false);
		expect(validateHostToEditorMessage({ type: 'setWhitespace', enabled: true, command: 'unsafe' }, 0).ok).toBe(false);
	});
	it('accepts only exact boolean host-owned panel visibility updates', () => {
		for (const visible of [true, false]) {
			expect(validateHostToEditorMessage({ type: 'panelVisibility', visible }, 0)).toEqual({ ok: true, value: { type: 'panelVisibility', visible } });
			expect(validateEditorToHostMessage({ type: 'panelVisibility', visible }, 0).ok).toBe(false);
		}
		for (const visible of ['true', 'false', 0, 1, null, undefined, [], {}]) {
			expect(validateHostToEditorMessage({ type: 'panelVisibility', visible }, 0).ok).toBe(false);
		}
		expect(validateHostToEditorMessage({ type: 'panelVisibility' }, 0).ok).toBe(false);
		expect(validateHostToEditorMessage({ type: 'panelVisibility', visible: true, command: 'unsafe' }, 0).ok).toBe(false);
	});
	it('bounds clipboard requests and validates their acknowledgements', () => {
		const request = { type: 'copyCode', requestId: 1, text: 'print("hello")' };
		expect(validateEditorToHostMessage(request, 0).ok).toBe(true);
		for (const invalid of [
			{ ...request, requestId: -1 }, { ...request, requestId: 0.5 },
			{ ...request, text: 42 }, { ...request, command: 'run' },
			{ ...request, text: 'é'.repeat(MAX_EDITOR_MESSAGE_TEXT_BYTES) },
		]) expect(validateEditorToHostMessage(invalid, 0).ok).toBe(false);
		expect(validateHostToEditorMessage({ type: 'copyCodeResult', requestId: 1, ok: true }, 0).ok).toBe(true);
		expect(validateHostToEditorMessage({ type: 'copyCodeResult', requestId: 1, ok: 'true' }, 0).ok).toBe(false);
	});
	it.each(['ready', 'undo', 'redo', 'save', 'resync'] as const)('accepts %s with no extra fields', (type) => {
		expect(validateEditorToHostMessage({ type }, 10)).toEqual({ ok: true, value: { type } });
		expect(validateEditorToHostMessage({ type, extra: true }, 10).ok).toBe(false);
	});
	it('accepts bounded recovery payloads without trusting a renderer-supplied URI or storage path', () => {
		const preserve = { type: 'preserveDraft', requestId: 8, text: '# Unsaved draft\n- [x] Complete\n' };
		const checkpoint = { type: 'checkpoint', requestId: 9, text: 'new version', baselineText: 'old version' };
		expect(validateEditorToHostMessage(preserve, 0).ok).toBe(true);
		expect(validateEditorToHostMessage(checkpoint, 0).ok).toBe(true);
		for (const request of [preserve, checkpoint]) {
			for (const requestId of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
				expect(validateEditorToHostMessage({ ...request, requestId }, 0).ok).toBe(false);
			}
			for (const extra of [{ sourceUri: 'file:///etc/passwd' }, { path: '../secret' }, { command: 'execute' }, { force: true }]) {
				expect(validateEditorToHostMessage({ ...request, ...extra }, 0).ok).toBe(false);
			}
			for (const text of [null, 123, [], {}, false]) expect(validateEditorToHostMessage({ ...request, text }, 0).ok).toBe(false);
		}
		expect(validateEditorToHostMessage({ type: 'checkpoint', requestId: 0, text: '', baselineText: '' }, 0).ok).toBe(true);
		expect(validateEditorToHostMessage({ ...checkpoint, baselineText: null }, 0).ok).toBe(false);
		expect(validateEditorToHostMessage({ type: 'checkpoint', requestId: 1, text: 'missing baseline' }, 0).ok).toBe(false);
		expect(validateEditorToHostMessage({ ...preserve, baselineText: 'unexpected' }, 0).ok).toBe(false);
	});
	it('bounds both checkpoint snapshots and preserves whole-document recovery above the incremental edit limit', () => {
		const full = 'a'.repeat(MAX_EDITOR_DOCUMENT_BYTES);
		const oversized = full + 'a';
		const checkpoint = { type: 'checkpoint', requestId: 1, text: full, baselineText: '' };
		expect(validateEditorToHostMessage(checkpoint, 0).ok).toBe(true);
		expect(validateEditorToHostMessage({ type: 'preserveDraft', requestId: 2, text: full }, 0).ok).toBe(true);
		expect(validateEditorToHostMessage({ ...checkpoint, text: oversized }, 0).ok).toBe(false);
		expect(validateEditorToHostMessage({ ...checkpoint, text: '', baselineText: oversized }, 0).ok).toBe(false);
		expect(validateEditorToHostMessage({ type: 'preserveDraft', requestId: 2, text: oversized }, 0).ok).toBe(false);
		const unicodeOverflow = '😀'.repeat(Math.floor(MAX_EDITOR_DOCUMENT_BYTES / 4) + 1);
		expect(validateEditorToHostMessage({ ...checkpoint, text: unicodeOverflow }, 0).ok).toBe(false);
		expect(validateEditorToHostMessage({ ...checkpoint, text: '', baselineText: unicodeOverflow }, 0).ok).toBe(false);
		for (const requiresSeparatePreservation of [undefined, true]) {
			const snapshot = { type: 'draftSnapshot', text: full, baselineText: '', ...(requiresSeparatePreservation === true ? { requiresSeparatePreservation } : {}) };
			expect(validateEditorToHostMessage(snapshot, 0).ok).toBe(true);
			expect(validateEditorToHostMessage({ ...snapshot, text: oversized }, 0).ok).toBe(false);
			expect(validateEditorToHostMessage({ ...snapshot, text: '', baselineText: oversized }, 0).ok).toBe(false);
			expect(validateEditorToHostMessage({ ...snapshot, text: unicodeOverflow }, 0).ok).toBe(false);
		}
	});
	it('accepts only exact renderer snapshots with an optional true-only separate-preservation flag', () => {
		const snapshot = { type: 'draftSnapshot', text: 'unsaved draft', baselineText: 'original' };
		expect(validateEditorToHostMessage(snapshot, 0).ok).toBe(true);
		expect(validateEditorToHostMessage({ ...snapshot, requiresSeparatePreservation: true }, 0).ok).toBe(true);
		expect(validateEditorToHostMessage({ type: 'draftSnapshot', text: '', baselineText: '' }, 0).ok).toBe(true);
		for (const malformed of [
			{ ...snapshot, requiresSeparatePreservation: false }, { ...snapshot, requiresSeparatePreservation: 'true' },
			{ ...snapshot, requiresSeparatePreservation: 1 }, { ...snapshot, requiresSeparatePreservation: null },
			{ ...snapshot, requestId: 1 }, { ...snapshot, sourceUri: 'file:///etc/passwd' },
			{ ...snapshot, text: null }, { ...snapshot, baselineText: 1 }, { type: 'draftSnapshot', text: 'missing baseline' },
		]) expect(validateEditorToHostMessage(malformed, 0).ok).toBe(false);
		expect(validateHostToEditorMessage(snapshot, 0).ok).toBe(false);
	});

	it('accepts a sorted, bounded edit batch', () => {
		const message = {
			type: 'edit',
			baseVersion: 3,
			changes: [
				{ from: 0, to: 1, insert: 'a' },
				{ from: 4, to: 4, insert: 'b' },
			],
		};
		expect(validateEditorToHostMessage(message, 5, 3)).toEqual({ ok: true, value: message });
		expect(validateEditorToHostMessage(message, 5, 4).ok).toBe(false);
	});

	it.each([
		[[{ from: -1, to: 0, insert: '' }]],
		[[{ from: 2, to: 1, insert: '' }]],
		[[{ from: 0, to: 6, insert: '' }]],
		[[
			{ from: 3, to: 4, insert: '' },
			{ from: 2, to: 2, insert: '' },
		]],
	])('rejects invalid edit ranges', (changes) => {
		expect(validateEditorToHostMessage({ type: 'edit', baseVersion: 1, changes }, 5).ok).toBe(false);
	});

	it('rejects excessive edit counts and inserted text', () => {
		const many = Array.from({ length: MAX_EDIT_CHANGES + 1 }, () => ({ from: 0, to: 0, insert: '' }));
		expect(validateEditorToHostMessage({ type: 'edit', baseVersion: 1, changes: many }, 5).ok).toBe(false);
		const huge = 'x'.repeat(MAX_EDITOR_MESSAGE_TEXT_BYTES + 1);
		expect(
			validateEditorToHostMessage({ type: 'edit', baseVersion: 1, changes: [{ from: 0, to: 0, insert: huge }] }, 5).ok,
		).toBe(false);
	});

	it('accepts a small raster paste and rejects SVG, malformed base64, and oversized data', () => {
		const base = { type: 'pasteImage', atPos: 0, mimeType: 'image/png', needsOwnParagraph: false };
		expect(validateEditorToHostMessage({ ...base, dataBase64: 'YWJj' }, 5).ok).toBe(true);
		expect(validateEditorToHostMessage({ ...base, mimeType: 'image/svg+xml', dataBase64: 'YWJj' }, 5).ok).toBe(false);
		expect(validateEditorToHostMessage({ ...base, dataBase64: 'not base64!' }, 5).ok).toBe(false);
		expect(validateEditorToHostMessage({ ...base, dataBase64: '/x==' }, 5).ok).toBe(false);
		expect(validateEditorToHostMessage({ ...base, dataBase64: '//9=' }, 5).ok).toBe(false);
		const tooLarge = 'A'.repeat(Math.ceil(MAX_PASTED_IMAGE_BYTES / 3) * 4 + 4);
		expect(validateEditorToHostMessage({ ...base, dataBase64: tooLarge }, 5).ok).toBe(false);
	});

	it('accepts bounded image batches and rejects malformed, excessive, or oversized operations', () => {
		const base = { type: 'pasteImages', atPos: 2, needsOwnParagraph: false };
		const small = { mimeType: 'image/png', dataBase64: 'YWJj' };
		expect(validateEditorToHostMessage({ ...base, images: [small, { mimeType: 'image/jpeg', dataBase64: 'ZGVm' }] }, 5).ok).toBe(true);
		expect(validateEditorToHostMessage({ ...base, images: [] }, 5).ok).toBe(false);
		expect(validateEditorToHostMessage({ ...base, images: Array.from({ length: MAX_PASTED_IMAGE_COUNT + 1 }, () => small) }, 5).ok).toBe(false);
		expect(validateEditorToHostMessage({ ...base, images: [{ ...small, extra: true }] }, 5).ok).toBe(false);
		expect(validateEditorToHostMessage({ ...base, images: [{ mimeType: 'image/svg+xml', dataBase64: 'YWJj' }] }, 5).ok).toBe(false);

		// One allocation is shared by both entries: each image remains below the
		// 20 MiB per-file ceiling, while the two small tail entries take the batch
		// over its separate 40 MiB operation ceiling.
		const nearlyTwentyMiB = 'A'.repeat(Math.floor(MAX_PASTED_IMAGE_BYTES / 3) * 4);
		expect(validateEditorToHostMessage({
			...base,
			images: [
				{ mimeType: 'image/png', dataBase64: nearlyTwentyMiB },
				{ mimeType: 'image/png', dataBase64: nearlyTwentyMiB },
				small,
				small,
			],
		}, 5).ok).toBe(false);
	});

	it('rejects unknown messages and unexpected fields', () => {
		expect(validateEditorToHostMessage({ type: 'launchMissiles' }, 5).ok).toBe(false);
		expect(validateEditorToHostMessage({ type: 'openLink', href: 'https://example.com', extra: 1 }, 5).ok).toBe(false);
	});

	it('validates bounded wiki embed requests', () => {
		expect(validateEditorToHostMessage({ type: 'readWikiEmbed', requestId: 1, body: 'Note#Heading', contextPath: 'Current.md' }, 5).ok).toBe(true);
		expect(validateEditorToHostMessage({ type: 'readWikiEmbed', requestId: -1, body: 'Note', contextPath: '' }, 5).ok).toBe(false);
		expect(validateEditorToHostMessage({ type: 'readWikiEmbed', requestId: 1, body: '../'.repeat(2000), contextPath: '' }, 5).ok).toBe(false);
		for (const contextPath of ['', '../Current.md', '/Current.md', 'C:/Current.md', 'Folder//Current.md', 'Folder\\Current.md', 'Current.md\0outside']) {
			expect(validateEditorToHostMessage({ type: 'readWikiEmbed', requestId: 1, body: 'Note', contextPath }, 5).ok).toBe(false);
		}
		expect(validateEditorToHostMessage({ type: 'readWikiEmbed', requestId: 1, body: 'Note\nOther', contextPath: 'Current.md' }, 5).ok).toBe(false);
	});

	it('allows draw.io XML reads only for local supported diagram paths', () => {
		for (const src of ['diagram.drawio', 'sub/diagram.dio', 'diagram.drawio.xml', 'diagram.drawio?v=2#page1']) {
			expect(validateEditorToHostMessage({ type: 'readDrawioFile', requestId: 1, src }, 5).ok).toBe(true);
		}
		for (const src of ['Note.md', 'secret.txt', 'diagram.drawio.svg', 'https://example.invalid/diagram.drawio', '/tmp/diagram.drawio']) {
			expect(validateEditorToHostMessage({ type: 'readDrawioFile', requestId: 1, src }, 5).ok).toBe(false);
		}
	});

	it('validates bounded local image requests', () => {
		expect(validateEditorToHostMessage({ type: 'resolveLocalImage', requestId: 2, src: 'assets/p.png', contextPath: 'Current.md' }, 5).ok).toBe(true);
		expect(validateEditorToHostMessage({ type: 'resolveLocalImage', requestId: -1, src: 'a.png', contextPath: 'Current.md' }, 5).ok).toBe(false);
		expect(validateEditorToHostMessage({ type: 'resolveLocalImage', requestId: 2, src: 'a.png\0evil', contextPath: 'Current.md' }, 5).ok).toBe(false);
		expect(validateEditorToHostMessage({ type: 'resolveLocalImage', requestId: 2, src: 'a.png', contextPath: '../Current.md' }, 5).ok).toBe(false);
		expect(validateEditorToHostMessage({ type: 'resolveLocalImage', requestId: 2, src: 'a.png\nnext', contextPath: 'Current.md' }, 5).ok).toBe(false);
	});
});

describe('validateHostToEditorMessage', () => {
	const init = {
		type: 'init',
		protocolVersion: 1,
		text: '# Note',
		version: 1,
		css: '',
		codeTheme: 'dark-plus',
		remoteMedia: 'block',
		workspaceTrusted: true,
		diagramRenderingAllowed: true,
		editingMode: 'editing',
		vaultNotes: [],
		currentVaultPath: 'Note.md',
	};
	it('accepts exact recovery acknowledgements and rejects forged fields and invalid identities', () => {
		for (const ok of [true, false]) expect(validateHostToEditorMessage({ type: 'draftPreserved', requestId: 2, ok }, 0).ok).toBe(true);
		for (const malformed of [
			{ type: 'draftPreserved', requestId: -1, ok: true },
			{ type: 'draftPreserved', requestId: Number.MAX_SAFE_INTEGER + 1, ok: true },
			{ type: 'draftPreserved', requestId: 2, ok: 'true' },
			{ type: 'draftPreserved', requestId: 2, ok: true, sourceUri: 'file:///other' },
			{ type: 'draftPreserved', requestId: 2 },
		]) expect(validateHostToEditorMessage(malformed, 0).ok).toBe(false);
		expect(validateEditorToHostMessage({ type: 'draftPreserved', requestId: 2, ok: true }, 0).ok).toBe(false);
	});

	it('accepts a complete initialization and rejects unexpected privilege fields', () => {
		expect(validateHostToEditorMessage(init, 0).ok).toBe(true);
		expect(validateHostToEditorMessage({ ...init, protocolVersion: 2 }, 0).ok).toBe(false);
		expect(validateHostToEditorMessage({ ...init, execute: true }, 0).ok).toBe(false);
		expect(validateHostToEditorMessage({ ...init, baseUri: 'https://file.example/' }, 0).ok).toBe(false);
		expect(validateHostToEditorMessage({ ...init, editingMode: 'arbitrary' }, 0).ok).toBe(false);
		for (const currentVaultPath of ['../Note.md', '/Note.md', 'C:/Note.md', 'Folder//Note.md', 'Folder\\Note.md', 'Note.md\nOther']) {
			expect(validateHostToEditorMessage({ ...init, currentVaultPath }, 0).ok).toBe(false);
		}
		expect(validateHostToEditorMessage({ ...init, currentVaultPath: '' }, 0).ok).toBe(true);
	});

	it('validates external changes against the current document', () => {
		expect(validateHostToEditorMessage({ type: 'externalUpdate', version: 2, changes: [{ from: 0, to: 1, insert: 'x' }] }, 5).ok).toBe(true);
		expect(validateHostToEditorMessage({ type: 'externalUpdate', version: 2, changes: [{ from: 0, to: 6, insert: 'x' }] }, 5).ok).toBe(false);
	});

	it('accepts only bounded, contiguous-capable vault metadata chunks', () => {
		const note = { path: 'Note.md', basename: 'Note', aliases: [], headings: [], blockIds: [] };
		expect(validateHostToEditorMessage({
			type: 'vaultNotesChunk', generation: 1, offset: 0, total: 1, notes: [note],
		}, 0).ok).toBe(true);
		expect(validateHostToEditorMessage({
			type: 'vaultNotesChunk', generation: 1, offset: 1, total: 1, notes: [note],
		}, 0).ok).toBe(false);
		expect(validateHostToEditorMessage({
			type: 'vaultNotesChunk', generation: 1, offset: 0, total: 10_001, notes: [],
		}, 0).ok).toBe(false);
		expect(validateHostToEditorMessage({
			type: 'vaultNotesChunk', generation: 1, offset: 0, total: 101, notes: Array.from({ length: 101 }, () => note),
		}, 0).ok).toBe(false);
		for (const path of ['../Note.md', '/Note.md', 'C:/Note.md', 'Folder//Note.md', 'Folder\\Note.md', 'Note.md\0Other']) {
			expect(validateHostToEditorMessage({
				type: 'vaultNotesChunk', generation: 1, offset: 0, total: 1, notes: [{ ...note, path }],
			}, 0).ok).toBe(false);
		}
		for (const malformed of [
			{ ...note, basename: 'Other' },
			{ ...note, aliases: ['bad|alias'] },
			{ ...note, blockIds: ['bad/id'] },
			{ ...note, headings: [{ text: 'bad\nheading', line: 1 }] },
			{ ...note, headings: [{ text: 'Heading', line: 0 }] },
		]) {
			expect(validateHostToEditorMessage({
				type: 'vaultNotesChunk', generation: 1, offset: 0, total: 1, notes: [malformed],
			}, 0).ok).toBe(false);
		}
		const expansionHeavy = {
			...note,
			headings: Array.from({ length: 100 }, (_, line) => ({ text: '\\'.repeat(4_096), line })),
		};
		expect(validateHostToEditorMessage({
			type: 'vaultNotesChunk', generation: 1, offset: 0, total: 1, notes: [expansionHeavy],
		}, 0).ok).toBe(false);
	});

	it('rejects unsafe token styles and ambiguous draw.io replies', () => {
		expect(validateHostToEditorMessage({ type: 'codeTokens', blocks: [{ from: 0, to: 5, tokens: [{ from: 0, to: 1, style: 'color:#d4d4d4;font-style:italic;font-weight:bold;text-decoration:underline' }] }] }, 5).ok).toBe(true);
		expect(validateHostToEditorMessage({ type: 'codeTokens', blocks: [{ from: 0, to: 1, tokens: [{ from: 0, to: 1, style: 'background:url(https://tracker.invalid)' }] }] }, 5).ok).toBe(false);
		expect(validateHostToEditorMessage({ type: 'codeTokens', blocks: [{ from: 0, to: 5, tokens: [{ from: 0, to: 1, style: 'position:fixed;color:#fff' }] }] }, 5).ok).toBe(false);
		expect(validateHostToEditorMessage({ type: 'codeTokens', blocks: [{ from: 1, to: 4, tokens: [{ from: 0, to: 1, style: 'color:#fff' }] }] }, 5).ok).toBe(false);
		expect(validateHostToEditorMessage({ type: 'drawioFile', requestId: 1, text: '<xml/>', error: 'also an error' }, 5).ok).toBe(false);
	});

	it('validates wiki embed replies with exactly one result shape', () => {
		expect(validateHostToEditorMessage({ type: 'wikiEmbed', requestId: 1, sourcePath: 'Note.md', text: '# Note' }, 0).ok).toBe(true);
		expect(validateHostToEditorMessage({ type: 'wikiEmbed', requestId: 1, error: 'Missing note' }, 0).ok).toBe(true);
		expect(validateHostToEditorMessage({ type: 'wikiEmbed', requestId: 1, sourcePath: 'Note.md', text: '# Note', error: 'x' }, 0).ok).toBe(false);
		expect(validateHostToEditorMessage({ type: 'wikiEmbed', requestId: 1, sourcePath: '../Note.md', text: '# Note' }, 0).ok).toBe(false);
	});

	it('validates bounded raster-byte replies and rejects URI or malformed payloads', () => {
		expect(validateHostToEditorMessage({
			type: 'localImage', requestId: 1, mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=',
		}, 0).ok).toBe(true);
		expect(validateHostToEditorMessage({ type: 'localImage', requestId: 1, error: 'Blocked' }, 0).ok).toBe(true);
		expect(validateHostToEditorMessage({ type: 'localImage', requestId: 1, uri: 'file:///etc/passwd' }, 0).ok).toBe(false);
		expect(validateHostToEditorMessage({ type: 'localImage', requestId: 1, uri: 'javascript:alert(1)' }, 0).ok).toBe(false);
		expect(validateHostToEditorMessage({ type: 'localImage', requestId: 1, mimeType: 'image/svg+xml', dataBase64: 'PHN2Zz4=' }, 0).ok).toBe(false);
		expect(validateHostToEditorMessage({ type: 'localImage', requestId: 1, mimeType: 'image/png', dataBase64: 'not base64!' }, 0).ok).toBe(false);
		expect(validateHostToEditorMessage({ type: 'localImage', requestId: 1, mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=', error: 'x' }, 0).ok).toBe(false);
	});

	it('rejects unknown messages', () => {
		expect(validateHostToEditorMessage({ type: 'runCommand', command: 'x' }, 0).ok).toBe(false);
	});
});

describe('editor document byte limit', () => {
	it('uses UTF-8 bytes and accepts the exact boundary', () => {
		expect(isEditorDocumentWithinLimit('x'.repeat(MAX_EDITOR_DOCUMENT_BYTES))).toBe(true);
		expect(isEditorDocumentWithinLimit('x'.repeat(MAX_EDITOR_DOCUMENT_BYTES + 1))).toBe(false);
		expect(isEditorDocumentWithinLimit('é'.repeat(Math.floor(MAX_EDITOR_DOCUMENT_BYTES / 2) + 1))).toBe(false);
	});
});
