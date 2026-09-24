import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Disposable } from 'vscode';

const mocks = vi.hoisted(() => ({
	groups: [] as any[], documents: [] as any[], editors: [] as any[],
	tabChanged: undefined as undefined | (() => void), groupChanged: undefined as undefined | (() => void),
	inside: vi.fn(), root: vi.fn(), open: vi.fn(), command: vi.fn(), close: vi.fn(), warning: vi.fn(), error: vi.fn(),
}));
vi.mock('vscode', () => ({
	TabInputCustom: class { constructor(readonly uri: any, readonly viewType: string) {} },
	Disposable: class { constructor(private callback: () => void) {} dispose() { this.callback(); } },
	workspace: { get textDocuments() { return mocks.documents; }, openTextDocument: mocks.open },
	commands: { executeCommand: mocks.command }, l10n: { t: (text: string) => text },
	window: {
		get visibleTextEditors() { return mocks.editors; }, showWarningMessage: mocks.warning, showErrorMessage: mocks.error,
		tabGroups: {
			get all() { return mocks.groups; }, close: mocks.close,
			onDidChangeTabs: (callback: () => void) => { mocks.tabChanged = callback; return { dispose() {} }; },
			onDidChangeTabGroups: (callback: () => void) => { mocks.groupChanged = callback; return { dispose() {} }; },
		},
	},
}));
vi.mock('./canonicalContainment', () => ({ isCanonicalPathInside: mocks.inside }));
vi.mock('./workspaceVault', () => ({ localWorkspaceVaultRoot: mocks.root }));
import { TabInputCustom } from 'vscode';
import { hasUnsafeNativeMarkdownTab, registerNativeMarkdownCompatibility } from './nativeMarkdownCompatibility';

function uri(path = '/vault/Note.md', scheme = 'file') { return { scheme, fsPath: path, toString: () => `${scheme}://${path}` } as any; }
const root = uri('/vault');
function fixture(path = '/vault/Note.md', viewType = 'vscode.markdown.editor') {
	const resource = uri(path);
	const tab = { input: new TabInputCustom(resource, viewType), isActive: true, isPreview: false, isDirty: true } as any;
	const group = { tabs: [tab], isActive: true, viewColumn: mocks.groups.length + 1 } as any;
	const document = { uri: resource, languageId: 'markdown', isClosed: false, isDirty: true, lineCount: 1,
		lineAt: () => ({ rangeIncludingLineBreak: { end: {} } }), offsetAt: () => 24,
		getText: () => '# Unsaved exact text 🐱\n', save: vi.fn() };
	mocks.groups.push(group);
	mocks.documents.push(document);
	return { resource, tab, group, document };
}

describe('native Markdown Editor compatibility handoff', () => {
	let registration: Disposable | undefined;
	beforeEach(() => {
		for (const value of Object.values(mocks)) if (vi.isMockFunction(value)) value.mockReset();
		mocks.groups = []; mocks.documents = []; mocks.editors = [];
		mocks.inside.mockResolvedValue(true); mocks.root.mockReturnValue(root);
		mocks.warning.mockResolvedValue(undefined); mocks.error.mockResolvedValue(undefined);
		mocks.command.mockImplementation(async (_command, resource, viewType, options) => {
			const group = mocks.groups.find(item => item.viewColumn === options.viewColumn);
			const tab = group.tabs.find((item: any) => item.input.uri.toString() === resource.toString());
			tab.input = new TabInputCustom(resource, viewType);
		});
		mocks.close.mockImplementation(async tab => {
			for (const group of mocks.groups) group.tabs = group.tabs.filter((item: any) => item !== tab);
			return true;
		});
	});
	afterEach(() => { registration?.dispose(); registration = undefined; });
	const start = () => { registration = registerNativeMarkdownCompatibility(); };
	const settled = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

	it('routes an existing dirty native tab to the same pinned group without saving or replacing its text', async () => {
		const { resource, document } = fixture();
		start(); await settled();
		expect(mocks.inside).toHaveBeenCalledTimes(2);
		expect(mocks.command).toHaveBeenCalledExactlyOnceWith('vscode.openWith', resource, 'mdLivePreview.editor', { viewColumn: 1, preserveFocus: false, preview: false });
		expect(document.getText()).toBe('# Unsaved exact text 🐱\n');
		expect(document.save).not.toHaveBeenCalled();
		expect(mocks.open).not.toHaveBeenCalled();
		expect(mocks.close).not.toHaveBeenCalled();
		expect(hasUnsafeNativeMarkdownTab(resource)).toBe(false);
		expect(mocks.warning).toHaveBeenCalledOnce();
	});

	it('handles newly opened hidden and split native tabs without stealing focus', async () => {
		start(); await settled();
		const first = fixture(); const second = fixture('/vault/Other.md');
		first.group.isActive = false; second.tab.isActive = false; second.tab.isPreview = true;
		mocks.tabChanged!(); await settled();
		expect(mocks.command).toHaveBeenCalledWith('vscode.openWith', first.resource, 'mdLivePreview.editor', { viewColumn: 1, preserveFocus: true, preview: false });
		expect(mocks.command).toHaveBeenCalledWith('vscode.openWith', second.resource, 'mdLivePreview.editor', { viewColumn: 2, preserveFocus: true, preview: false });
		expect(mocks.warning).toHaveBeenCalledOnce();
	});

	it('preserves a matching public text-editor selection when one is available', async () => {
		const { resource, document } = fixture();
		const selection = { start: 2, end: 7 };
		mocks.editors = [{ document, viewColumn: 1, selection }];
		start(); await settled();
		expect(mocks.command).toHaveBeenCalledWith('vscode.openWith', resource, 'mdLivePreview.editor', expect.objectContaining({ selection }));
	});

	it.each(['remote', 'outside', 'symlink', 'nonMarkdown', 'closed', 'oversize', 'source', 'preview'])('does not route a %s resource or viewing mode', async kind => {
		const { tab, document, resource } = fixture();
		if (kind === 'remote') resource.scheme = 'vscode-remote';
		if (kind === 'outside') mocks.root.mockReturnValue(undefined);
		if (kind === 'symlink') mocks.inside.mockResolvedValue(false);
		if (kind === 'nonMarkdown') document.languageId = 'plaintext';
		if (kind === 'closed') document.isClosed = true;
		if (kind === 'oversize') document.getText = () => 'x'.repeat(20 * 1024 * 1024 + 1);
		if (kind === 'source') tab.input = { uri: resource };
		if (kind === 'preview') tab.input = new TabInputCustom(resource, 'vscode.markdown.preview.editor');
		start(); await settled();
		expect(mocks.command).not.toHaveBeenCalled();
		expect(mocks.close).not.toHaveBeenCalled();
	});

	it.each(['closed', 'switched', 'workspace', 'symlink', 'disposed'])('rechecks a %s change during async authorization', async change => {
		const { tab, group, resource } = fixture();
		let release!: (value: boolean) => void;
		mocks.inside.mockImplementationOnce(() => new Promise<boolean>(resolve => { release = resolve; }));
		start(); await Promise.resolve();
		if (change === 'closed') group.tabs = [];
		if (change === 'switched') tab.input = { uri: resource };
		if (change === 'workspace') mocks.root.mockReturnValue(uri('/other'));
		if (change === 'symlink') mocks.inside.mockResolvedValue(false);
		if (change === 'disposed') registration!.dispose();
		release(true); await settled();
		expect(mocks.command).not.toHaveBeenCalled();
	});

	it('keeps a clean native tab even after the same URI is open in Live Preview', async () => {
		const { resource, tab, group, document } = fixture();
		tab.isDirty = false; document.isDirty = false;
		mocks.command.mockImplementation(async () => { group.tabs.push({ input: new TabInputCustom(resource, 'mdLivePreview.editor') }); });
		start(); await settled();
		expect(mocks.close).not.toHaveBeenCalled();
		expect(group.tabs).toContain(tab);
		expect(hasUnsafeNativeMarkdownTab(resource)).toBe(true);
		expect(document.save).not.toHaveBeenCalled();
		expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining('Automatic saving stays paused'));
	});

	it('does not close the native tab if the safe view was not actually opened', async () => {
		const { resource } = fixture();
		mocks.command.mockResolvedValue(undefined);
		start(); await settled();
		expect(mocks.close).not.toHaveBeenCalled();
		expect(hasUnsafeNativeMarkdownTab(resource)).toBe(true);
	});

	it('reports a failed handoff without retrying in a tight loop or discarding the original', async () => {
		const { resource } = fixture();
		mocks.command.mockRejectedValue(new Error('Canceled'));
		start(); await settled();
		mocks.tabChanged!(); await settled();
		expect(mocks.command).toHaveBeenCalledOnce();
		expect(mocks.close).not.toHaveBeenCalled();
		expect(mocks.error).toHaveBeenCalledOnce();
		expect(hasUnsafeNativeMarkdownTab(resource)).toBe(true);
	});

	it('bounds concurrent handoffs while still processing later tabs', async () => {
		for (let index = 0; index < 8; index++) fixture(`/vault/${index}.md`);
		let release!: (value: boolean) => void;
		const blocked = new Promise<boolean>(resolve => { release = resolve; });
		mocks.inside.mockReturnValue(blocked);
		start(); await settled();
		expect(mocks.inside).toHaveBeenCalledTimes(4);
		release(true);
		await vi.waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(8));
	});

	it('routes a reused tab object when its URI changes', async () => {
		const { tab } = fixture();
		start(); await settled();
		const changed = fixture('/vault/Reused.md');
		mocks.groups.pop();
		tab.input = new TabInputCustom(changed.resource, 'vscode.markdown.editor');
		mocks.tabChanged!(); await settled();
		expect(mocks.command).toHaveBeenCalledTimes(2);
		expect(mocks.command).toHaveBeenLastCalledWith('vscode.openWith', changed.resource, 'mdLivePreview.editor', expect.any(Object));
	});

	it('allows a reused tab to request the same native URI again after a safe transition', async () => {
		const { tab, resource } = fixture();
		start(); await settled();
		mocks.tabChanged!(); await settled(); // Observe its completed safe transition.
		tab.input = new TabInputCustom(resource, 'vscode.markdown.editor');
		mocks.tabChanged!(); await settled();
		expect(mocks.command).toHaveBeenCalledTimes(2);
	});

	it('rejects attacker-sized native documents before copying the full text', async () => {
		const { document } = fixture();
		document.offsetAt = () => 20 * 1024 * 1024 + 1;
		document.getText = vi.fn(() => { throw new Error('must not copy oversized text'); });
		start(); await settled();
		expect(document.getText).not.toHaveBeenCalled();
		expect(mocks.command).not.toHaveBeenCalled();
	});

	it('never closes a native tab whose working copy was dirty when the handoff began', async () => {
		const { resource, tab, group, document } = fixture();
		mocks.command.mockImplementation(async () => { group.tabs.push({ input: new TabInputCustom(resource, 'mdLivePreview.editor') }); });
		start(); await settled();
		expect(mocks.close).not.toHaveBeenCalled();
		expect(group.tabs).toContain(tab);
		expect(document.isDirty).toBe(true);
		expect(document.getText()).toContain('Unsaved exact text');
		expect(document.save).not.toHaveBeenCalled();
		expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining('Original native tabs are kept'));
	});

	it.each(['dirty', 'dirtyThenClean', 'contentBeforeDirty'])('never closes a native tab if it becomes %s during opening', async kind => {
		const { resource, tab, group, document } = fixture();
		tab.isDirty = false; document.isDirty = false;
		mocks.command.mockImplementation(async () => {
			group.tabs.push({ input: new TabInputCustom(resource, 'mdLivePreview.editor') });
			document.isDirty = kind !== 'contentBeforeDirty';
			if (kind === 'dirtyThenClean') document.isDirty = false;
		});
		start(); await settled();
		expect(mocks.close).not.toHaveBeenCalled();
		expect(group.tabs).toContain(tab);
		expect(document.save).not.toHaveBeenCalled();
	});

	it('never starts an asynchronous native close that could race the next keystroke', async () => {
		const { resource, tab, group, document } = fixture();
		tab.isDirty = false; document.isDirty = false;
		mocks.command.mockImplementation(async () => { group.tabs.push({ input: new TabInputCustom(resource, 'mdLivePreview.editor') }); });
		start(); await settled();
		expect(mocks.close).not.toHaveBeenCalled();
		expect(group.tabs).toContain(tab);
		expect(document.save).not.toHaveBeenCalled();
	});

	it('opens a pinned safe companion for a native preview tab without implicitly replacing it', async () => {
		const { resource, tab, group, document } = fixture();
		tab.isPreview = true; tab.isDirty = false; document.isDirty = false;
		mocks.command.mockImplementation(async (_command, opened, viewType, options) => {
			if (options.preview) group.tabs = [];
			group.tabs.push({ input: new TabInputCustom(opened, viewType), isPreview: options.preview });
		});
		start(); await settled();
		expect(mocks.command).toHaveBeenCalledWith('vscode.openWith', resource, 'mdLivePreview.editor', expect.objectContaining({ preview: false }));
		expect(group.tabs).toContain(tab);
		expect(group.tabs).toHaveLength(2);
		expect(mocks.close).not.toHaveBeenCalled();
	});
});
