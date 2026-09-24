import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	change: undefined as undefined | ((event: any) => void),
	inside: vi.fn(), warning: vi.fn(), enabled: true,
}));
vi.mock('vscode', () => ({
	Disposable: class { constructor(private callback: () => void) {} dispose() { this.callback(); } },
	workspace: {
		textDocuments: [],
		onDidChangeTextDocument: (callback: any) => { mocks.change = callback; return { dispose() {} }; },
		onDidOpenTextDocument: () => ({ dispose() {} }),
		onDidCloseTextDocument: () => ({ dispose() {} }),
		onDidChangeConfiguration: () => ({ dispose() {} }),
		getConfiguration: () => ({ get: () => mocks.enabled }),
	},
	window: { showWarningMessage: mocks.warning },
}));
vi.mock('./canonicalContainment', () => ({ isCanonicalPathInside: mocks.inside }));
vi.mock('./workspaceVault', () => ({ localWorkspaceVaultRoot: () => ({ fsPath: '/vault', toString: () => 'file:///vault' }) }));
vi.mock('../diagnostics', () => ({ diagnosticEventRateLimited() {} }));
import { MarkdownAutoSaveController } from './markdownAutoSave';

describe('immediate Markdown autosave', () => {
	let controller: MarkdownAutoSaveController;
	let document: any;
	beforeEach(() => {
		vi.useFakeTimers();
		mocks.enabled = true;
		mocks.inside.mockReset().mockResolvedValue(true);
		mocks.warning.mockReset();
		document = {
			uri: { scheme: 'file', fsPath: '/vault/note.md', toString: () => 'file:///vault/note.md' },
			languageId: 'markdown', isDirty: true, lineCount: 1,
			lineAt: () => ({ rangeIncludingLineBreak: { end: {} } }),
			offsetAt: () => 4, getText: () => 'note',
			save: vi.fn(async () => { document.isDirty = false; return true; }),
		};
		controller = new MarkdownAutoSaveController();
	});
	afterEach(() => { controller.dispose(); vi.useRealTimers(); });
	const edit = () => { document.isDirty = true; mocks.change!({ document, contentChanges: [{}] }); };
	it('saves an already-dirty document when tracking begins', async () => {
		controller.track(document);
		await vi.advanceTimersByTimeAsync(1);
		expect(document.save).toHaveBeenCalledOnce();
	});
	it('flush waits for a running save and persists a newer dirty edit before history continues', async () => {
		let finish!: (saved: boolean) => void;
		document.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		edit();
		await vi.advanceTimersByTimeAsync(1);
		let settled = false;
		const flush = controller.flush(document).then(() => { settled = true; });
		await Promise.resolve();
		expect(settled).toBe(false);
		edit();
		finish(true);
		await flush;
		expect(document.save).toHaveBeenCalledTimes(2);
		expect(document.isDirty).toBe(false);
		await vi.advanceTimersByTimeAsync(5);
		expect(document.save).toHaveBeenCalledTimes(2);
	});
	it('starts saving on the next event turn without waiting for an idle typing gap', async () => {
		for (let index = 0; index < 10; index++) {
			edit();
			await vi.advanceTimersByTimeAsync(1);
			expect(document.save).toHaveBeenCalledTimes(index + 1);
		}
	});
	it('handles content changes emitted before the dirty flag flips', async () => {
		document.isDirty = false;
		mocks.change!({ document, contentChanges: [{}] });
		await vi.advanceTimersByTimeAsync(1);
		expect(document.save).not.toHaveBeenCalled();
		document.isDirty = true;
		mocks.change!({ document, contentChanges: [] });
		await vi.advanceTimersByTimeAsync(1);
		expect(document.save).toHaveBeenCalledOnce();
	});
	it('serializes authorization and retains edits arriving while it is pending', async () => {
		let authorize!: (value: boolean) => void;
		mocks.inside.mockImplementationOnce(() => new Promise(resolve => { authorize = resolve; }));
		edit();
		await vi.advanceTimersByTimeAsync(1);
		edit();
		await vi.advanceTimersByTimeAsync(1);
		expect(mocks.inside).toHaveBeenCalledOnce();
		authorize(true);
		await vi.advanceTimersByTimeAsync(1);
		expect(document.save).toHaveBeenCalledOnce();
	});
	it('saves changes arriving during a slow save without overlapping writes', async () => {
		let finish!: (value: boolean) => void;
		document.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		edit();
		await vi.advanceTimersByTimeAsync(1);
		edit();
		await vi.advanceTimersByTimeAsync(1);
		expect(document.save).toHaveBeenCalledOnce();
		finish(true);
		await vi.advanceTimersByTimeAsync(2);
		expect(document.save).toHaveBeenCalledTimes(2);
		expect(document.isDirty).toBe(false);
	});
	it.each(['false', 'throw'])('warns once on %s save failure without a retry loop', async (failure) => {
		if (failure === 'throw') document.save.mockRejectedValue(new Error('disk unavailable'));
		else document.save.mockResolvedValue(false);
		edit();
		await vi.advanceTimersByTimeAsync(1000);
		expect(document.save).toHaveBeenCalledOnce();
		expect(document.isDirty).toBe(true);
		edit();
		await vi.advanceTimersByTimeAsync(1);
		expect(mocks.warning).toHaveBeenCalledOnce();
	});
	it('does not retry a failed save just because it emits a dirty-state notification', async () => {
		document.save.mockImplementation(async () => {
			mocks.change!({ document, contentChanges: [] });
			return false;
		});
		edit();
		await vi.advanceTimersByTimeAsync(1000);
		expect(document.save).toHaveBeenCalledOnce();
	});
	it('still rejects symlink escapes and disabled autosave', async () => {
		mocks.inside.mockResolvedValue(false);
		edit();
		await vi.advanceTimersByTimeAsync(1);
		expect(document.save).not.toHaveBeenCalled();
		mocks.enabled = false;
		mocks.inside.mockResolvedValue(true);
		edit();
		await vi.advanceTimersByTimeAsync(1);
		expect(document.save).not.toHaveBeenCalled();
	});
});
