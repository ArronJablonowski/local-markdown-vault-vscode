import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	change: undefined as undefined | ((event: any) => void),
	open: undefined as undefined | ((document: any) => void),
	close: undefined as undefined | ((document: any) => void),
	saved: undefined as undefined | ((document: any) => void),
	configuration: undefined as undefined | ((event: any) => void),
	tabs: undefined as undefined | (() => void),
	groups: [] as any[],
	inside: vi.fn(), warning: vi.fn(), enabled: true,
}));
vi.mock('vscode', () => ({
	Disposable: class { constructor(private callback: () => void) {} dispose() { this.callback(); } },
	TabInputCustom: class { constructor(readonly uri: any, readonly viewType: string) {} },
	workspace: {
		textDocuments: [],
		onDidChangeTextDocument: (callback: any) => { mocks.change = callback; return { dispose() {} }; },
		onDidOpenTextDocument: (callback: any) => { mocks.open = callback; return { dispose() {} }; },
		onDidCloseTextDocument: (callback: any) => { mocks.close = callback; return { dispose() {} }; },
		onDidSaveTextDocument: (callback: any) => { mocks.saved = callback; return { dispose() {} }; },
		onDidChangeConfiguration: (callback: any) => { mocks.configuration = callback; return { dispose() {} }; },
		getConfiguration: () => ({ get: () => mocks.enabled }),
	},
	window: { showWarningMessage: mocks.warning, tabGroups: {
		get all() { return mocks.groups; },
		onDidChangeTabs: (callback: () => void) => { mocks.tabs = callback; return { dispose() {} }; },
		onDidChangeTabGroups: () => ({ dispose() {} }),
	} },
}));
vi.mock('./canonicalContainment', () => ({ isCanonicalPathInside: mocks.inside }));
vi.mock('./workspaceVault', () => ({ localWorkspaceVaultRoot: () => ({ fsPath: '/vault', toString: () => 'file:///vault' }) }));
vi.mock('../diagnostics', () => ({ diagnosticEventRateLimited() {} }));
import { MarkdownAutoSaveController } from './markdownAutoSave';
import { TabInputCustom } from 'vscode';

describe('immediate Markdown autosave', () => {
	let controller: MarkdownAutoSaveController;
	let document: any;
	beforeEach(() => {
		vi.useFakeTimers();
		mocks.enabled = true;
		mocks.groups = [];
		mocks.inside.mockReset().mockResolvedValue(true);
		mocks.warning.mockReset();
		document = {
			uri: { scheme: 'file', fsPath: '/vault/note.md', toString: () => 'file:///vault/note.md' },
			languageId: 'markdown', isDirty: true, isClosed: false, lineCount: 1,
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
	it('suspends background and flush saves while any hidden native Markdown Editor tab is open', async () => {
		mocks.groups = [{ tabs: [{ input: new TabInputCustom(document.uri, 'vscode.markdown.editor'), isActive: false }] }];
		edit();
		await vi.advanceTimersByTimeAsync(5);
		await controller.flush(document);
		expect(document.save).not.toHaveBeenCalled();
		expect(document.isDirty).toBe(true);
		expect(mocks.warning).toHaveBeenCalledOnce();
		expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining('saving is paused'));
		mocks.groups = [];
		mocks.tabs!();
		await vi.advanceTimersByTimeAsync(5);
		expect(document.save).toHaveBeenCalledOnce();
	});
	it('warns instead of silently abandoning native-editor edits even when automatic path authorization cannot succeed', async () => {
		mocks.inside.mockResolvedValue(false);
		mocks.groups = [{ tabs: [{ input: new TabInputCustom(document.uri, 'vscode.markdown.editor') }] }];
		edit(); edit();
		await vi.advanceTimersByTimeAsync(5);
		expect(document.save).not.toHaveBeenCalled();
		expect(mocks.warning).toHaveBeenCalledOnce();
		expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining('Use Markdown Live Preview or Text Editor'));
	});
	it('waits for the last native split to close before saving retained content revisions', async () => {
		const unsafe = { input: new TabInputCustom(document.uri, 'vscode.markdown.editor') };
		mocks.groups = [{ tabs: [unsafe] }, { tabs: [unsafe] }];
		edit(); document.isDirty = false;
		mocks.groups.pop(); mocks.tabs!();
		await vi.advanceTimersByTimeAsync(5);
		expect(document.save).not.toHaveBeenCalled();
		mocks.groups = []; mocks.tabs!();
		await vi.advanceTimersByTimeAsync(5);
		expect(document.save).toHaveBeenCalledOnce();
	});
	it('rechecks native-tab safety after asynchronous path authorization', async () => {
		let authorize!: (value: boolean) => void;
		mocks.inside.mockImplementationOnce(() => new Promise<boolean>(resolve => { authorize = resolve; }));
		edit();
		await vi.advanceTimersByTimeAsync(1);
		mocks.groups = [{ tabs: [{ input: new TabInputCustom(document.uri, 'vscode.markdown.editor') }] }];
		mocks.tabs!();
		authorize(true);
		await vi.advanceTimersByTimeAsync(5);
		expect(document.save).not.toHaveBeenCalled();
		mocks.groups = []; mocks.tabs!();
		await vi.advanceTimersByTimeAsync(5);
		expect(document.save).toHaveBeenCalledOnce();
	});
	it('does not block unrelated native files, Markdown Preview, or our Live Preview', async () => {
		mocks.groups = [{ tabs: [
			{ input: new TabInputCustom({ toString: () => 'file:///vault/Other.md' } as any, 'vscode.markdown.editor') },
			{ input: new TabInputCustom(document.uri, 'vscode.markdown.preview.editor') },
			{ input: new TabInputCustom(document.uri, 'mdLivePreview.editor') },
		] }];
		edit();
		await vi.advanceTimersByTimeAsync(5);
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
		// A content event is independent evidence that saving is needed. A stale
		// native save notification may leave the extension-host dirty mirror false.
		expect(document.save).toHaveBeenCalledOnce();
		document.isDirty = true;
		mocks.change!({ document, contentChanges: [] });
		await vi.advanceTimersByTimeAsync(1);
		expect(document.save).toHaveBeenCalledTimes(2);
	});
	it.each(['timer', 'flush'])('saves a newer content revision through %s even if an older save falsely marks it clean', async followup => {
		let text = 'note';
		let disk = '';
		let finish!: () => void;
		document.getText = () => text;
		document.offsetAt = () => text.length;
		document.save.mockImplementation(async () => { disk = text; document.isDirty = false; return true; });
		document.save.mockImplementationOnce(() => {
			const oldSnapshot = text;
			return new Promise<boolean>(resolve => {
				finish = () => {
					disk = oldSnapshot;
					// Reproduce VS Code's unversioned $acceptModelSaved notification:
					// the host mirror looks clean although the final period is newer.
					document.isDirty = false;
					mocks.change!({ document, contentChanges: [] });
					resolve(true);
				};
			});
		});
		edit();
		await vi.advanceTimersByTimeAsync(1);
		text += '.';
		edit();
		finish();
		if (followup === 'flush') await controller.flush(document);
		else await vi.advanceTimersByTimeAsync(5);
		expect(document.save).toHaveBeenCalledTimes(2);
		expect(disk).toBe('note.');
		expect(document.isDirty).toBe(false);
		await vi.advanceTimersByTimeAsync(1000);
		expect(document.save).toHaveBeenCalledTimes(2);
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
	it('rechecks dirty state after a successful save and persists an unreported newer change', async () => {
		document.save.mockResolvedValueOnce(true);
		edit();
		await vi.advanceTimersByTimeAsync(5);
		expect(document.save).toHaveBeenCalledTimes(2);
		expect(document.isDirty).toBe(false);
		expect(mocks.warning).not.toHaveBeenCalled();
	});
	it('bounds successful-but-still-dirty retries and warns instead of silently claiming persistence', async () => {
		document.save.mockResolvedValue(true);
		edit();
		await vi.advanceTimersByTimeAsync(1000);
		expect(document.save).toHaveBeenCalledTimes(2);
		expect(document.isDirty).toBe(true);
		expect(mocks.warning).toHaveBeenCalledOnce();
		document.save.mockImplementation(async () => { document.isDirty = false; return true; });
		edit();
		await vi.advanceTimersByTimeAsync(5);
		expect(document.save).toHaveBeenCalledTimes(3);
		expect(document.isDirty).toBe(false);
	});
	it('bounds retries when a failing save participant emits its own content change without saving', async () => {
		document.save.mockImplementation(async () => { edit(); return false; });
		edit();
		await vi.advanceTimersByTimeAsync(1000);
		expect(document.save).toHaveBeenCalledTimes(2);
		expect(document.isDirty).toBe(true);
		expect(mocks.warning).toHaveBeenCalledOnce();
	});
	it('keeps saving new revisions when native writes make progress but return false due to newer typing', async () => {
		let text = 'note';
		let disk = '';
		document.getText = () => text;
		document.offsetAt = () => text.length;
		let writes = 0;
		document.save.mockImplementation(async () => {
			disk = text;
			if (++writes <= 4) {
				text += '.';
				edit();
				document.isDirty = false;
				mocks.change!({ document, contentChanges: [] });
				mocks.saved!(document);
				// The main-thread model still has newer text to write, even though
				// the unversioned extension-host didSave mirror now says clean.
				return false;
			}
			document.isDirty = false;
			mocks.saved!(document);
			return true;
		});
		edit();
		await vi.advanceTimersByTimeAsync(20);
		expect(document.save).toHaveBeenCalledTimes(5);
		expect(disk).toBe('note....');
		expect(mocks.warning).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1000);
		expect(document.save).toHaveBeenCalledTimes(5);
	});
	it('does not finish an explicit flush until a newer revision arriving during its save is persisted', async () => {
		let text = 'note';
		let disk = '';
		document.getText = () => text;
		document.offsetAt = () => text.length;
		document.save.mockImplementation(async () => { disk = text; document.isDirty = false; return true; });
		document.save.mockImplementationOnce(async () => {
			disk = text;
			text += '.';
			edit();
			document.isDirty = false;
			mocks.saved!(document);
			return false;
		});
		controller.track(document);
		await controller.flush(document);
		expect(disk).toBe('note.');
		expect(document.save).toHaveBeenCalledTimes(2);
		expect(document.isDirty).toBe(false);
	});
	it('tracks a reopened URI even while an old custom editor registration remains alive', async () => {
		const oldDocument = document;
		const oldRegistration = controller.track(oldDocument);
		mocks.open!(oldDocument);
		oldDocument.isClosed = true;
		mocks.close!(oldDocument);
		document = { ...oldDocument, isClosed: false, save: vi.fn(async () => { document.isDirty = false; return true; }) };
		mocks.open!(document);
		oldRegistration.dispose();
		await vi.advanceTimersByTimeAsync(5);
		expect(document.save).toHaveBeenCalledOnce();
		expect(oldDocument.save).not.toHaveBeenCalled();
	});
	it('late releases and close events for an old document cannot detach a new document at the same URI', async () => {
		const oldDocument = document;
		const oldRegistration = controller.track(oldDocument);
		mocks.open!(oldDocument);
		document = { ...oldDocument, save: vi.fn(async () => { document.isDirty = false; return true; }) };
		mocks.open!(document);
		oldRegistration.dispose();
		mocks.close!(oldDocument);
		await vi.advanceTimersByTimeAsync(5);
		expect(document.save).toHaveBeenCalledOnce();
		expect(oldDocument.save).not.toHaveBeenCalled();
		edit();
		await vi.advanceTimersByTimeAsync(5);
		expect(document.save).toHaveBeenCalledTimes(2);
	});
	it('never saves a document that closes while canonical-path authorization is pending', async () => {
		let authorize!: (value: boolean) => void;
		mocks.inside.mockImplementationOnce(() => new Promise(resolve => { authorize = resolve; }));
		edit();
		await vi.advanceTimersByTimeAsync(1);
		document.isClosed = true;
		mocks.close!(document);
		authorize(true);
		await vi.advanceTimersByTimeAsync(5);
		expect(document.save).not.toHaveBeenCalled();
	});
	it('waits for an older document save before saving its replacement at the same URI', async () => {
		let finish!: (value: boolean) => void;
		const oldDocument = document;
		oldDocument.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		edit();
		await vi.advanceTimersByTimeAsync(1);
		document = { ...oldDocument, save: vi.fn(async () => { document.isDirty = false; return true; }) };
		mocks.open!(document);
		await vi.advanceTimersByTimeAsync(5);
		expect(document.save).not.toHaveBeenCalled();
		oldDocument.isDirty = false;
		finish(true);
		await vi.advanceTimersByTimeAsync(5);
		expect(document.save).toHaveBeenCalledOnce();
		expect(document.isDirty).toBe(false);
	});
	it('retains serialization across close and reopen while an older native save is still running', async () => {
		let finish!: (value: boolean) => void;
		const oldDocument = document;
		oldDocument.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		edit();
		await vi.advanceTimersByTimeAsync(1);
		oldDocument.isClosed = true;
		mocks.close!(oldDocument);
		document = { ...oldDocument, isClosed: false, save: vi.fn(async () => { document.isDirty = false; return true; }) };
		mocks.open!(document);
		await vi.advanceTimersByTimeAsync(5);
		for (let index = 0; index < 20; index++) { edit(); await vi.advanceTimersByTimeAsync(1); }
		expect(document.save).not.toHaveBeenCalled();
		oldDocument.isDirty = false;
		finish(true);
		await vi.advanceTimersByTimeAsync(5);
		expect(document.save).toHaveBeenCalledOnce();
		expect(document.isDirty).toBe(false);
	});
	it('recovers from an unexpected document-read error without poisoning future saves', async () => {
		document.getText = vi.fn().mockImplementationOnce(() => { throw new Error('temporarily unavailable'); }).mockReturnValue('note');
		edit();
		await vi.advanceTimersByTimeAsync(5);
		expect(mocks.warning).toHaveBeenCalledOnce();
		expect(document.save).not.toHaveBeenCalled();
		edit();
		await vi.advanceTimersByTimeAsync(5);
		expect(document.save).toHaveBeenCalledOnce();
	});
	it('serializes simultaneous flush calls through slow authorization and a slow native save', async () => {
		let authorize!: (value: boolean) => void;
		let finish!: (value: boolean) => void;
		mocks.inside.mockImplementationOnce(() => new Promise(resolve => { authorize = resolve; }));
		document.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		edit();
		const flushes = Promise.all([controller.flush(document), controller.flush(document), controller.flush(document)]);
		await vi.advanceTimersByTimeAsync(1);
		expect(mocks.inside).toHaveBeenCalledOnce();
		authorize(true);
		await vi.advanceTimersByTimeAsync(1);
		expect(document.save).toHaveBeenCalledOnce();
		document.isDirty = false;
		finish(true);
		await flushes;
		expect(document.save).toHaveBeenCalledOnce();
	});
	it('rechecks autosave permission after slow authorization', async () => {
		let authorize!: (value: boolean) => void;
		mocks.inside.mockImplementationOnce(() => new Promise(resolve => { authorize = resolve; }));
		edit();
		await vi.advanceTimersByTimeAsync(1);
		mocks.enabled = false;
		mocks.configuration!({ affectsConfiguration: () => true });
		authorize(true);
		await vi.advanceTimersByTimeAsync(5);
		expect(document.save).not.toHaveBeenCalled();
		mocks.enabled = true;
		mocks.configuration!({ affectsConfiguration: () => true });
		await vi.advanceTimersByTimeAsync(5);
		expect(document.save).toHaveBeenCalledOnce();
	});
	it('does not save a document whose language changes during authorization', async () => {
		let authorize!: (value: boolean) => void;
		mocks.inside.mockImplementationOnce(() => new Promise(resolve => { authorize = resolve; }));
		edit();
		await vi.advanceTimersByTimeAsync(1);
		document.languageId = 'plaintext';
		authorize(true);
		await vi.advanceTimersByTimeAsync(5);
		expect(document.save).not.toHaveBeenCalled();
	});
	it('does not register or save documents after controller disposal', async () => {
		controller.dispose();
		controller.track(document);
		mocks.open!(document);
		edit();
		await controller.flush(document);
		await vi.advanceTimersByTimeAsync(5);
		expect(document.save).not.toHaveBeenCalled();
	});
});
