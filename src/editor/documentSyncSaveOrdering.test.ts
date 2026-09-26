import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BoundedSerialQueue } from '../shared/boundedSerialQueue';
import { RequestLimiter } from '../shared/requestLimiter';
import { TokenBucketRateLimiter } from '../shared/tokenBucketRateLimiter';
import type { Memento } from 'vscode';

const mocks = vi.hoisted(() => ({ apply: vi.fn(), open: vi.fn(), inside: vi.fn(), error: vi.fn(), diagnostic: vi.fn(), show: vi.fn(), warning: vi.fn() }));
vi.mock('vscode', () => ({
	workspace: { applyEdit: mocks.apply, openTextDocument: mocks.open },
	window: { showErrorMessage: mocks.error, showTextDocument: mocks.show, showWarningMessage: mocks.warning },
	l10n: { t: (message: string) => message },
	WorkspaceEdit: class {
		changes: { uri: unknown; range: { from: number; to: number }; text: string }[] = [];
		replace(uri: unknown, range: { from: number; to: number }, text: string) { this.changes.push({ uri, range, text }); }
	},
	Range: class { constructor(readonly from: number, readonly to: number) {} }, EndOfLine: { CRLF: 2 },
}));
vi.mock('./shikiHost', () => ({}));
vi.mock('../vault/VaultService', () => ({}));
vi.mock('../vault/CaseRenameCoordinator', () => ({}));
vi.mock('../diagnostics', () => ({ diagnosticEventRateLimited: mocks.diagnostic }));
vi.mock('./configuredDocumentOpen', () => ({}));
vi.mock('./canonicalContainment', () => ({ isCanonicalPathInside: mocks.inside }));
vi.mock('./workspaceVault', () => ({ localWorkspaceVaultRoot: () => ({ fsPath: '/vault', toString: () => 'file:///vault' }) }));
import { DocumentSyncSession } from './documentSync';
import { MarkdownDraftPreserver } from './markdownDraftPreserver';
import { MarkdownRecoveryStore } from './markdownRecoveryStore';

beforeEach(() => {
	mocks.apply.mockReset();
	mocks.open.mockReset();
	mocks.inside.mockReset().mockResolvedValue(true);
	mocks.error.mockReset().mockResolvedValue(undefined);
	mocks.diagnostic.mockReset();
	mocks.show.mockReset().mockResolvedValue(undefined);
	mocks.warning.mockReset().mockResolvedValue(undefined);
});

it('settles the previous save before editing and the new save before acknowledging', async () => {
	let text = 'Before';
	const document = { version: 1, uri: {}, eol: 1, getText: () => text, positionAt: (offset: number) => offset };
	let releaseBefore!: () => void, releaseAfter!: () => void;
	const before = new Promise<void>(resolve => { releaseBefore = resolve; });
	const after = new Promise<void>(resolve => { releaseAfter = resolve; });
	const settle = vi.fn().mockImplementationOnce(() => before).mockImplementationOnce(() => after);
	const post = vi.fn();
	mocks.apply.mockImplementation(async () => { text = 'Before After'; document.version++; return true; });
	// Exercise the real mutation method with controlled save promises. Constructor
	// watchers/webview plumbing are covered by the native desktop integration suite.
	const session = Object.assign(Object.create(DocumentSyncSession.prototype), {
		document, documentText: text, settleAutoSave: settle, disposed: false,
		post, scheduleRehighlight: vi.fn(),
	});
	const edit = session.applyEdit([{ from: 6, to: 6, insert: ' After' }], 1);
	expect(settle).toHaveBeenCalledOnce();
	expect(mocks.apply).not.toHaveBeenCalled();
	releaseBefore();
	await vi.waitFor(() => expect(settle).toHaveBeenCalledTimes(2));
	expect(text).toBe('Before After');
	expect(post).not.toHaveBeenCalled();
	releaseAfter();
	await edit;
	expect(post).toHaveBeenCalledWith({ type: 'ackEdit', version: 2 });
});

it('does not apply a delayed batch after its session closes or the document changes', async () => {
	for (const outcome of ['closed', 'changed']) {
		mocks.apply.mockClear();
		const document = { version: 1 };
		let release!: () => void;
		const saving = new Promise<void>(resolve => { release = resolve; });
		const sendInit = vi.fn();
		const session = Object.assign(Object.create(DocumentSyncSession.prototype), {
			document, settleAutoSave: () => saving, disposed: false, sendInit,
		});
		const edit = session.applyEdit([{ from: 0, to: 0, insert: 'new' }], 1);
		if (outcome === 'closed') session.disposed = true;
		else document.version++;
		release();
		await edit;
		expect(mocks.apply).not.toHaveBeenCalled();
		expect(sendInit).toHaveBeenCalledTimes(outcome === 'changed' ? 1 : 0);
	}
});

function documentFor(text: string, version = 1) {
	return {
		text, version, isClosed: false, isDirty: false, eol: 1,
		uri: { scheme: 'file', fsPath: '/vault/Note.md', toString: () => 'file:///vault/Note.md' },
		getText() { return this.text; },
		positionAt(offset: number) { return offset; },
	};
}

function mutationHarness(text = 'Before') {
	const document = documentFor(text);
	const session = Object.assign(Object.create(DocumentSyncSession.prototype), {
		document, documentText: text, lastAppliedVersion: document.version,
		closing: false, disposed: false, disposables: [], vaultNotesGeneration: 0,
		visible: true, readyReceived: true, draftFlushQueued: false,
		webviewPanel: { active: true, webview: { html: '' } },
		mutationQueue: new BoundedSerialQueue(64), recoveryLimiter: new RequestLimiter(2),
		resyncRateLimiter: new TokenBucketRateLimiter(4, 1000),
		post: vi.fn(), sendInit: vi.fn(), scheduleRehighlight: vi.fn(), preserveDraft: vi.fn().mockResolvedValue(undefined),
	});
	const settle = vi.fn(async () => { session.document.isDirty = false; });
	session.settleAutoSave = settle;
	session.saveExplicitly = vi.fn(async () => { session.document.isDirty = false; });
	mocks.apply.mockImplementation(async (edit: { changes: { range: { from: number; to: number }; text: string }[] }) => {
		for (const change of [...edit.changes].sort((a, b) => b.range.from - a.range.from)) {
			session.document.text = session.document.text.slice(0, change.range.from) + change.text + session.document.text.slice(change.range.to);
		}
		session.document.version++;
		session.document.isDirty = true;
		return true;
	});
	return { session, document, settle };
}

describe('accepted edits across close and reopen', () => {
	it('replays the final accepted edit if native close discarded it while its save was settling', async () => {
		const { session, document, settle } = mutationHarness();
		const reopened = documentFor('Before', 7);
		session.closing = true;
		settle.mockImplementationOnce(async () => {}).mockImplementationOnce(async () => {
			document.isClosed = true;
			document.isDirty = false; // The closed mirror still contains the full accepted edit.
		});
		mocks.open.mockResolvedValue(reopened);
		await session.applyEdit([{ from: 6, to: 6, insert: ' after' }], 1);
		expect(document.text).toBe('Before after');
		expect(reopened.text).toBe('Before after');
		expect(reopened.isDirty).toBe(false);
		expect(mocks.apply).toHaveBeenCalledTimes(2);
		expect(session.post).toHaveBeenCalledWith({ type: 'ackEdit', version: 8 });
		expect(session.preserveDraft).not.toHaveBeenCalled();
	});
	it('preserves rather than overwrites an external edit encountered after a native close during save', async () => {
		const { session, document, settle } = mutationHarness();
		const reopened = documentFor('External writer', 7);
		session.closing = true;
		settle.mockImplementationOnce(async () => {}).mockImplementationOnce(async () => {
			document.isClosed = true; document.isDirty = false;
		});
		mocks.open.mockResolvedValue(reopened);
		await session.applyEdit([{ from: 6, to: 6, insert: ' after' }], 1);
		expect(reopened.text).toBe('External writer');
		expect(mocks.apply).toHaveBeenCalledOnce();
		expect(session.post).not.toHaveBeenCalled();
		expect(session.preserveDraft).toHaveBeenCalledWith('Before after');
	});
	it('bounds close-during-save replay and preserves the exact draft if the native model closes again', async () => {
		const { session, document, settle } = mutationHarness();
		const reopened = documentFor('Before', 7);
		const secondReopen = documentFor('Before', 11);
		session.closing = true;
		settle.mockImplementation(async () => {
			if (session.document.isDirty) { session.document.isClosed = true; session.document.isDirty = false; }
		});
		mocks.open.mockResolvedValueOnce(reopened).mockResolvedValueOnce(secondReopen);
		await session.applyEdit([{ from: 6, to: 6, insert: ' after' }], 1);
		expect(document.text).toBe('Before after');
		expect(mocks.apply).toHaveBeenCalledTimes(2);
		expect(session.post).not.toHaveBeenCalled();
		expect(session.preserveDraft).toHaveBeenCalledWith('Before after');
	});
	it('does not acknowledge a snapshot merely because its discarded closed mirror is clean', async () => {
		const { session, document, settle } = mutationHarness('Before after');
		const reopened = documentFor('Before', 7);
		settle.mockImplementationOnce(async () => {}).mockImplementationOnce(async () => {
			document.isClosed = true; document.isDirty = false;
		});
		mocks.open.mockResolvedValue(reopened);
		expect(await session.trySaveSnapshot({ baselineText: 'Before', text: 'Before after' })).toBe(false);
		expect(mocks.open).toHaveBeenCalledOnce();
	});
	it('drains an already accepted edit after panel disposal and saves it before final disposal', async () => {
		const { session, document, settle } = mutationHarness();
		let release!: () => void;
		settle.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
		session.handleMessage({ type: 'edit', baseVersion: 1, changes: [{ from: 6, to: 6, insert: ' after' }] });
		await Promise.resolve();
		session.dispose();
		expect(session.closing).toBe(true);
		expect(session.disposed).toBe(false);
		release();
		await session.mutationQueue.drain();
		expect(document.text).toBe('Before after');
		expect(document.isDirty).toBe(false);
		await vi.waitFor(() => expect(session.disposed).toBe(true));
	});
	it('reopens the same unchanged file for its final accepted edit without reusing the old native version', async () => {
		const { session, document } = mutationHarness();
		const reopened = documentFor('Before', 7);
		document.isClosed = true;
		mocks.open.mockResolvedValue(reopened);
		session.handleMessage({ type: 'edit', baseVersion: 1, changes: [{ from: 6, to: 6, insert: ' after' }] });
		session.dispose();
		await session.mutationQueue.drain();
		expect(mocks.open).toHaveBeenCalledWith(document.uri);
		expect(mocks.inside).toHaveBeenCalledWith('/vault', '/vault/Note.md');
		expect(reopened.text).toBe('Before after');
		expect(reopened.version).toBe(8);
		expect(reopened.isDirty).toBe(false);
		expect(session.getDocument()).toBe(reopened);
	});
	it('does not overwrite externally changed text when reopening a closed document', async () => {
		const { session, document } = mutationHarness();
		const reopened = documentFor('External writer', 3);
		document.isClosed = true;
		mocks.open.mockResolvedValue(reopened);
		await session.applyEdit([{ from: 6, to: 6, insert: ' after' }], 1);
		expect(mocks.apply).not.toHaveBeenCalled();
		expect(reopened.text).toBe('External writer');
		expect(session.sendInit).toHaveBeenCalledOnce();
	});
	it('does not let a concurrent event replace the baseline used to authorize a reopened edit', async () => {
		const { session, document } = mutationHarness();
		const reopened = documentFor('External writer', 3);
		document.isClosed = true;
		mocks.open.mockImplementation(async () => {
			// A document-change event can arrive during openTextDocument. The
			// protocol snapshot must not become the authority for an older batch.
			session.documentText = reopened.text;
			return reopened;
		});
		await session.applyEdit([{ from: 6, to: 6, insert: ' after' }], 1);
		expect(mocks.apply).not.toHaveBeenCalled();
		expect(reopened.text).toBe('External writer');
		expect(session.sendInit).toHaveBeenCalledOnce();
	});
	it('rejects a closed file whose canonical path is no longer inside the vault', async () => {
		const { session, document } = mutationHarness();
		document.isClosed = true;
		mocks.inside.mockResolvedValue(false);
		await expect(session.applyEdit([{ from: 0, to: 0, insert: 'blocked' }], 1)).rejects.toThrow('no longer inside the vault');
		expect(mocks.open).not.toHaveBeenCalled();
		expect(mocks.apply).not.toHaveBeenCalled();
	});
	it('preserves an accepted conflicting edit after close using its original immutable text', async () => {
		const { session, document, settle } = mutationHarness();
		let release!: () => void;
		settle.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
		session.handleMessage({ type: 'edit', baseVersion: 1, changes: [{ from: 6, to: 6, insert: ' after' }] });
		await Promise.resolve();
		session.dispose();
		document.version = 3;
		document.text = 'External writer';
		session.documentText = document.text;
		release();
		await session.mutationQueue.drain();
		expect(document.text).toBe('External writer');
		expect(mocks.apply).not.toHaveBeenCalled();
		expect(session.preserveDraft).toHaveBeenCalledWith('Before after');
		expect(session.sendInit).not.toHaveBeenCalled();
	});
	it.each(['apply', 'reopen'])('preserves an accepted edit after close if the %s operation throws', async failure => {
		const { session, document } = mutationHarness();
		if (failure === 'apply') mocks.apply.mockRejectedValueOnce(new Error('provider failed'));
		else { document.isClosed = true; mocks.open.mockRejectedValueOnce(new Error('file disappeared')); }
		session.handleMessage({ type: 'edit', baseVersion: 1, changes: [{ from: 6, to: 6, insert: ' after' }] });
		session.dispose();
		await session.mutationQueue.drain();
		expect(session.preserveDraft).toHaveBeenCalledWith('Before after');
	});
	it('preserves the accepted draft if a save participant changes its content after close', async () => {
		const { session, document, settle } = mutationHarness();
		settle.mockImplementationOnce(async () => {}).mockImplementationOnce(async () => {
			document.text = 'Save participant replacement';
			document.version++;
			document.isDirty = false;
		});
		session.handleMessage({ type: 'edit', baseVersion: 1, changes: [{ from: 6, to: 6, insert: ' after' }] });
		session.dispose();
		await session.mutationQueue.drain();
		expect(document.text).toBe('Save participant replacement');
		expect(session.preserveDraft).toHaveBeenCalledWith('Before after');
		expect(session.post).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ackEdit' }));
	});
	it('preserves an accepted edit if its native document remains dirty when closing', async () => {
		const { session, document, settle } = mutationHarness();
		settle.mockImplementation(async () => {});
		session.handleMessage({ type: 'edit', baseVersion: 1, changes: [{ from: 6, to: 6, insert: ' after' }] });
		session.dispose();
		await session.mutationQueue.drain();
		expect(document.text).toBe('Before after');
		expect(document.isDirty).toBe(true);
		expect(session.preserveDraft).toHaveBeenCalledWith('Before after');
	});
});

describe('save and recovery protocol ordering', () => {
	it('queues explicit save behind an accepted edit rather than persisting its older snapshot', async () => {
		const { session, document, settle } = mutationHarness();
		let release!: () => void;
		settle.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
		session.handleMessage({ type: 'edit', baseVersion: 1, changes: [{ from: 6, to: 6, insert: ' after' }] });
		session.handleMessage({ type: 'save' });
		await Promise.resolve();
		expect(settle).toHaveBeenCalledOnce();
		release();
		await session.mutationQueue.drain();
		expect(document.text).toBe('Before after');
		expect(document.isDirty).toBe(false);
		expect(settle).toHaveBeenCalledTimes(2);
		expect(session.saveExplicitly).toHaveBeenCalledOnce();
	});
	it('replays a checkpoint only against its exact baseline and acknowledges durable content separately from edits', async () => {
		const { session, document } = mutationHarness();
		session.handleMessage({ type: 'checkpoint', requestId: 4, baselineText: 'Before', text: 'Recovered draft' });
		await session.mutationQueue.drain();
		expect(document.text).toBe('Recovered draft');
		expect(document.isDirty).toBe(false);
		expect(session.preserveDraft).not.toHaveBeenCalled();
		expect(session.post.mock.calls.map((call: any[]) => call[0])).toEqual([{ type: 'draftPreserved', requestId: 4, ok: true }]);
	});
	it('does not overwrite a conflicting host document and keeps the incoming checkpoint as a recovery copy', async () => {
		const { session, document } = mutationHarness('External writer');
		session.handleMessage({ type: 'checkpoint', requestId: 5, baselineText: 'Before', text: 'My unsaved draft' });
		await session.mutationQueue.drain();
		expect(mocks.apply).not.toHaveBeenCalled();
		expect(document.text).toBe('External writer');
		expect(session.preserveDraft).toHaveBeenCalledWith('My unsaved draft');
		expect(session.post).toHaveBeenCalledWith({ type: 'draftPreserved', requestId: 5, ok: true });
	});
	it('preserves the checkpoint separately if native saving leaves its document dirty', async () => {
		const { session, document, settle } = mutationHarness();
		settle.mockImplementation(async () => {});
		session.handleMessage({ type: 'checkpoint', requestId: 6, baselineText: 'Before', text: 'Still dirty' });
		await session.mutationQueue.drain();
		expect(document.text).toBe('Still dirty');
		expect(document.isDirty).toBe(true);
		expect(session.preserveDraft).toHaveBeenCalledWith('Still dirty');
		expect(session.post).toHaveBeenCalledWith({ type: 'draftPreserved', requestId: 6, ok: true });
	});
	it('does not acknowledge successful preservation until the recovery store finishes', async () => {
		const { session } = mutationHarness();
		let finish!: () => void;
		session.preserveDraft.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
		session.handleMessage({ type: 'preserveDraft', requestId: 7, text: 'Keep every byte' });
		await Promise.resolve();
		expect(session.post).not.toHaveBeenCalled();
		finish();
		await session.mutationQueue.drain();
		expect(session.post).toHaveBeenCalledWith({ type: 'draftPreserved', requestId: 7, ok: true });
	});
	it('reports failed recovery and releases its bounded permit for the next request', async () => {
		const { session } = mutationHarness();
		session.preserveDraft.mockRejectedValueOnce(new Error('Storage is full'));
		session.handleMessage({ type: 'preserveDraft', requestId: 8, text: 'Unsaved' });
		await session.mutationQueue.drain();
		expect(session.post).toHaveBeenCalledWith({ type: 'draftPreserved', requestId: 8, ok: false });
		expect(mocks.error).toHaveBeenCalledOnce();
		session.handleMessage({ type: 'preserveDraft', requestId: 9, text: 'Try again' });
		await session.mutationQueue.drain();
		expect(session.post).toHaveBeenCalledWith({ type: 'draftPreserved', requestId: 9, ok: true });
	});
	it('limits simultaneous recovery requests without silently accepting the rejected draft', async () => {
		const { session } = mutationHarness();
		let finish!: () => void;
		session.preserveDraft.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
		for (let requestId = 1; requestId <= 3; requestId++) session.handleMessage({ type: 'preserveDraft', requestId, text: `draft ${requestId}` });
		expect(session.post).toHaveBeenCalledWith({ type: 'draftPreserved', requestId: 3, ok: false });
		await Promise.resolve();
		finish();
		await session.mutationQueue.drain();
		expect(session.preserveDraft.mock.calls.map((call: any[]) => call[0])).toEqual(['draft 1', 'draft 2']);
	});
	it('serializes and rate-limits renderer resynchronization requests', async () => {
		const { session } = mutationHarness();
		for (let index = 0; index < 10; index++) session.handleMessage({ type: 'resync' });
		expect(session.sendInit).not.toHaveBeenCalled();
		await session.mutationQueue.drain();
		expect(session.sendInit).toHaveBeenCalledTimes(4);
	});
});

describe('cached renderer drafts across hide and close', () => {
	it('notifies a retained renderer only when its host-owned visibility actually changes', () => {
		const { session } = mutationHarness();
		session.flushPendingJump = vi.fn();
		session.setVisible(false);
		session.setVisible(false);
		session.setVisible(true);
		session.setVisible(true);
		expect(session.post.mock.calls).toEqual([
			[{ type: 'panelVisibility', visible: false }],
			[{ type: 'panelVisibility', visible: true }],
		]);
	});
	it.each([true, false])('announces initial visibility %s before initializing a ready renderer', async visible => {
		const { session } = mutationHarness();
		session.readyReceived = false;
		session.visible = visible;
		session.flushPendingJump = vi.fn();
		session.sendInit.mockImplementation(() => {
			expect(session.post).toHaveBeenCalledWith({ type: 'panelVisibility', visible });
		});
		session.handleMessage({ type: 'ready' });
		expect(session.post).toHaveBeenCalledExactlyOnceWith({ type: 'panelVisibility', visible });
		await session.mutationQueue.drain();
		await Promise.resolve();
		expect(session.sendInit).toHaveBeenCalledTimes(visible ? 1 : 0);
	});
	it('sends current visibility to a replacement renderer after a hidden policy reload', async () => {
		const { session } = mutationHarness();
		session.flushPendingJump = vi.fn();
		session.setVisible(false);
		session.reloadWebview('<!doctype html><title>New policy</title>');
		session.post.mockClear();
		session.setVisible(true);
		expect(session.post).not.toHaveBeenCalled();
		session.handleMessage({ type: 'ready' });
		expect(session.post).toHaveBeenCalledExactlyOnceWith({ type: 'panelVisibility', visible: true });
		await session.mutationQueue.drain();
		await Promise.resolve();
		expect(session.sendInit).toHaveBeenCalledOnce();
	});
	it('keeps a retained renderer ready and accepts its edit after the tab becomes hidden', async () => {
		const { session, document } = mutationHarness();
		session.setVisible(false);
		expect(session.readyReceived).toBe(true);
		session.handleMessage({ type: 'edit', baseVersion: 1, changes: [{ from: 6, to: 6, insert: ' pasted before switching' }] });
		await session.mutationQueue.drain();
		expect(document.text).toBe('Before pasted before switching');
		expect(document.isDirty).toBe(false);
		expect(session.post).toHaveBeenCalledWith({ type: 'ackEdit', version: 2 });
	});
	it('refreshes a retained renderer on reveal without requiring a second ready handshake', () => {
		const { session, document } = mutationHarness();
		session.flushPendingJump = vi.fn();
		session.setVisible(false);
		document.text = 'Changed while hidden';
		document.version++;
		session.handleDocumentChanged({ document, contentChanges: [{ rangeOffset: 0, rangeLength: 6, text: document.text }] });
		expect(session.sendInit).not.toHaveBeenCalled();
		session.setVisible(true);
		expect(session.sendInit).toHaveBeenCalledOnce();
		expect(session.scheduleRehighlight).toHaveBeenCalledWith(true);
		expect(session.readyReceived).toBe(true);
	});
	it('keeps duplicate ready messages rejected after hiding a retained renderer', async () => {
		const { session } = mutationHarness();
		session.setVisible(false);
		session.handleMessage({ type: 'ready' });
		await session.mutationQueue.drain();
		expect(mocks.diagnostic).toHaveBeenCalledWith('protocol.duplicateReadyRejected');
		expect(session.sendInit).not.toHaveBeenCalled();
	});
	it('refreshes the retained source and version after a hidden snapshot-only widget draft saves', async () => {
		const { session, document } = mutationHarness();
		session.flushPendingJump = vi.fn();
		session.handleMessage({ type: 'draftSnapshot', baselineText: 'Before', text: 'Typed into a property' });
		session.setVisible(false);
		await session.mutationQueue.drain();
		expect(document.text).toBe('Typed into a property');
		expect(session.sendInit).not.toHaveBeenCalled();
		expect(session.needsFullSync).toBe(true);
		session.setVisible(true);
		expect(session.sendInit).toHaveBeenCalledOnce();
		expect(session.needsFullSync).toBe(false);
	});
	it('refreshes a snapshot-only draft when its renderer is revealed during the native save', async () => {
		const { session, document, settle } = mutationHarness();
		session.flushPendingJump = vi.fn();
		let release!: () => void;
		settle.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
		session.handleMessage({ type: 'draftSnapshot', baselineText: 'Before', text: 'Typed into a table' });
		session.setVisible(false);
		await vi.waitFor(() => expect(settle).toHaveBeenCalled());
		session.setVisible(true);
		expect(session.sendInit).not.toHaveBeenCalled();
		release();
		await session.mutationQueue.drain();
		expect(document.text).toBe('Typed into a table');
		expect(document.isDirty).toBe(false);
		expect(session.sendInit).toHaveBeenCalledOnce();
		expect(session.needsFullSync).toBe(false);
	});
	it('still replaces a hidden retained renderer immediately when its security policy changes', async () => {
		const { session, document } = mutationHarness();
		session.setVisible(false);
		session.handleMessage({ type: 'draftSnapshot', baselineText: 'Before', text: 'Last received draft' });
		session.reloadWebview('<!doctype html><title>Restricted policy</title>');
		expect(session.readyReceived).toBe(false);
		expect(session.webviewPanel.webview.html).toContain('Restricted policy');
		await session.mutationQueue.drain();
		expect(document.text).toBe('Last received draft');
		expect(document.isDirty).toBe(false);
	});
	it('flushes the cached draft when an HTML or security-policy reload replaces the iframe', async () => {
		const { session, document } = mutationHarness();
		session.handleMessage({ type: 'draftSnapshot', baselineText: 'Before', text: 'Typing immediately before reload' });
		session.reloadWebview('<!doctype html><title>Replacement</title>');
		expect(session.readyReceived).toBe(false);
		expect(session.webviewPanel.webview.html).toContain('Replacement');
		await session.mutationQueue.drain();
		expect(document.text).toBe('Typing immediately before reload');
		expect(document.isDirty).toBe(false);
		expect(session.pendingDraft).toBeUndefined();
	});
	it('saves a typing tail when hidden without relying on an iframe pagehide message', async () => {
		const { session, document } = mutationHarness();
		session.handleMessage({ type: 'draftSnapshot', baselineText: 'Before', text: 'Before with a typing tail' });
		expect(mocks.apply).not.toHaveBeenCalled();
		session.setVisible(false);
		await session.mutationQueue.drain();
		expect(document.text).toBe('Before with a typing tail');
		expect(document.isDirty).toBe(false);
		expect(session.pendingDraft).toBeUndefined();
		expect(session.post).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ackEdit' }));
	});
	it('saves a snapshot-only table or property edit when its editor closes before dispatching a normal batch', async () => {
		const { session, document } = mutationHarness('| Name | Value |\n| --- | --- |\n| Item | Old |');
		const edited = '| Name | Value |\n| --- | --- |\n| Item | Typed into cell |';
		session.handleMessage({ type: 'draftSnapshot', baselineText: document.text, text: edited });
		session.dispose();
		await session.mutationQueue.drain();
		expect(document.text).toBe(edited);
		expect(document.isDirty).toBe(false);
		expect(session.pendingDraft).toBeUndefined();
	});
	it('keeps an independent local copy when object editing explicitly requires separate preservation', async () => {
		const { session, document } = mutationHarness();
		session.handleMessage({ type: 'draftSnapshot', baselineText: 'Before', text: 'Object editor content', requiresSeparatePreservation: true });
		session.dispose();
		await session.mutationQueue.drain();
		expect(mocks.apply).not.toHaveBeenCalled();
		expect(document.text).toBe('Before');
		expect(session.preserveDraft).toHaveBeenCalledWith('Object editor content');
		expect(session.pendingDraft).toBeUndefined();
	});
	it('coalesces many visible snapshots into one newest snapshot instead of queueing full-document copies', async () => {
		const { session, document } = mutationHarness();
		for (let index = 0; index < 1000; index++) session.handleMessage({ type: 'draftSnapshot', baselineText: 'Before', text: `Draft ${index}` });
		expect(session.mutationQueue.pendingCount).toBe(0);
		expect(session.pendingDraft.text).toBe('Draft 999');
		session.setVisible(false);
		await session.mutationQueue.drain();
		expect(document.text).toBe('Draft 999');
		expect(mocks.apply).toHaveBeenCalledOnce();
	});
	it('flushes a newer hidden snapshot that arrives while the preceding snapshot is being saved', async () => {
		const { session, document, settle } = mutationHarness();
		let release!: () => void;
		settle.mockImplementation(async () => {
			if (document.isDirty && !release) await new Promise<void>(resolve => {
				release = () => { document.isDirty = false; resolve(); };
			});
			document.isDirty = false;
		});
		session.handleMessage({ type: 'draftSnapshot', baselineText: 'Before', text: 'First typing tail' });
		session.setVisible(false);
		await vi.waitFor(() => expect(document.text).toBe('First typing tail'));
		session.handleMessage({ type: 'draftSnapshot', baselineText: 'Before', text: 'Second typing tail' });
		release();
		await vi.waitFor(() => expect(session.preserveDraft).toHaveBeenCalledWith('Second typing tail'));
		expect(session.pendingDraft).toBeUndefined();
	});
	it('flushes its cached snapshot after a full mutation queue drains during close', async () => {
		const { session, document } = mutationHarness();
		session.mutationQueue = new BoundedSerialQueue(1);
		let release!: () => void;
		session.enqueueMutation(() => new Promise<void>(resolve => { release = resolve; }));
		await Promise.resolve();
		session.handleMessage({ type: 'draftSnapshot', baselineText: 'Before', text: 'Do not lose the last tail' });
		session.dispose();
		release();
		await vi.waitFor(() => expect(session.disposed).toBe(true));
		expect(document.text).toBe('Do not lose the last tail');
		expect(document.isDirty).toBe(false);
		expect(session.pendingDraft).toBeUndefined();
	});
	it('shutdown flush saves a cached draft even if its initial enqueue attempt found a full queue', async () => {
		const { session, document } = mutationHarness();
		session.mutationQueue = new BoundedSerialQueue(1);
		let release!: () => void;
		session.enqueueMutation(() => new Promise<void>(resolve => { release = resolve; }));
		await Promise.resolve();
		session.handleMessage({ type: 'draftSnapshot', baselineText: 'Before', text: 'Shutdown typing tail' });
		const shutdown = session.flushPendingSaves();
		release();
		await shutdown;
		expect(document.text).toBe('Shutdown typing tail');
		expect(document.isDirty).toBe(false);
		expect(session.pendingDraft).toBeUndefined();
	});
	it('preserves native CRLF line endings when applying a normalized full-draft checkpoint', async () => {
		const { session, document } = mutationHarness('# Heading\r\nBefore');
		document.eol = 2;
		session.handleMessage({ type: 'draftSnapshot', baselineText: '# Heading\nBefore', text: '# Heading\nBefore\nAfter' });
		session.setVisible(false);
		await session.mutationQueue.drain();
		expect(document.text).toBe('# Heading\r\nBefore\r\nAfter');
		expect(document.isDirty).toBe(false);
	});
	it.each(['reopen', 'apply', 'settle'])('preserves a cached snapshot when its native %s path throws', async failure => {
		const { session, document, settle } = mutationHarness();
		if (failure === 'reopen') { document.isClosed = true; mocks.inside.mockResolvedValue(false); }
		else if (failure === 'apply') mocks.apply.mockRejectedValueOnce(new Error('WorkspaceEdit failed'));
		else settle.mockRejectedValueOnce(new Error('AutoSave failed'));
		session.handleMessage({ type: 'draftSnapshot', baselineText: 'Before', text: 'Still recover this draft' });
		session.setVisible(false);
		await session.mutationQueue.drain();
		expect(session.preserveDraft).toHaveBeenCalledWith('Still recover this draft');
		expect(session.pendingDraft).toBeUndefined();
	});
	it('retains a failed recovery snapshot and warns without an automatic retry loop', async () => {
		const { session } = mutationHarness();
		session.preserveDraft.mockRejectedValue(new Error('Quota full'));
		const snapshot = { type: 'draftSnapshot', baselineText: 'Before', text: 'Keep me', requiresSeparatePreservation: true };
		session.handleMessage(snapshot);
		session.setVisible(false);
		await session.mutationQueue.drain();
		expect(session.pendingDraft).toBe(snapshot);
		expect(session.preserveDraft).toHaveBeenCalledOnce();
		expect(mocks.error).toHaveBeenCalledOnce();
	});
	it('closes a quota-full object draft only after an exact pinned native copy exists', async () => {
		const durable = new MarkdownRecoveryStore({ get: () => undefined, update: vi.fn().mockResolvedValue(undefined) } as unknown as Memento);
		for (let index = 0; index < 20; index++) await durable.preserve('file:///vault/Old.md', `Prior draft ${index}`);
		const preserver = new MarkdownDraftPreserver(durable);
		const { session, document } = mutationHarness('---\ncount: 1\n---\nOriginal');
		const text = '---\ncount: invalid numeric property 🐱\n---\nOriginal';
		session.preserveDraft = (draft: string) => preserver.preserve(document.uri.toString(), draft);
		mocks.open.mockImplementation(async ({ content }) => ({ isClosed: false, getText: () => content, uri: { scheme: 'untitled' } }));
		session.handleMessage({ type: 'draftSnapshot', baselineText: document.text, text, requiresSeparatePreservation: true });
		await session.dispose();
		expect(session.disposed).toBe(true);
		expect(session.pendingDraft).toBeUndefined();
		expect(document.text).toBe('---\ncount: 1\n---\nOriginal');
		expect(mocks.apply).not.toHaveBeenCalled();
		expect(mocks.open).toHaveBeenCalledExactlyOnceWith({ language: 'markdown', content: text });
		expect(mocks.show).toHaveBeenCalledWith(expect.objectContaining({ uri: { scheme: 'untitled' } }), { preview: false });
		expect(durable.list()).toHaveLength(20);
	});
	it('retains a failed native recovery independently of a disposed session and allows later retry', async () => {
		const preserver = new MarkdownDraftPreserver();
		const { session, document } = mutationHarness();
		session.preserveDraft = (text: string) => preserver.preserve(document.uri.toString(), text);
		mocks.open.mockRejectedValue(new Error('native editor unavailable'));
		session.handleMessage({ type: 'draftSnapshot', baselineText: 'Before', text: 'Only remaining draft', requiresSeparatePreservation: true });
		await session.dispose();
		expect(session.disposed).toBe(true);
		expect(session.pendingDraft.text).toBe('Only remaining draft');
		expect(preserver.list()).toHaveLength(1);
		mocks.open.mockImplementation(async ({ content }) => ({ isClosed: false, getText: () => content }));
		await preserver.open(preserver.list()[0].id);
		expect(mocks.open).toHaveBeenLastCalledWith({ language: 'markdown', content: 'Only remaining draft' });
		expect(preserver.list()).toEqual([]);
		expect(document.text).toBe('Before');
	});
});
