import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apply: vi.fn() }));
vi.mock('vscode', () => ({
	workspace: { applyEdit: mocks.apply },
	WorkspaceEdit: class { replace() {} },
	Range: class {}, EndOfLine: { CRLF: 2 },
}));
vi.mock('./shikiHost', () => ({}));
vi.mock('../vault/VaultService', () => ({}));
vi.mock('../vault/CaseRenameCoordinator', () => ({}));
vi.mock('../diagnostics', () => ({}));
vi.mock('./configuredDocumentOpen', () => ({}));
import { DocumentSyncSession } from './documentSync';

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
