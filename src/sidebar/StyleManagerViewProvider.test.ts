import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { StyleStore } from './styleStore';

const mocks = vi.hoisted(() => ({ trusted: true, error: vi.fn(), update: vi.fn(),
	settings: {} as Record<string, unknown>, overrides: {} as Record<string, unknown>,
	configuration: undefined as undefined | ((event: { affectsConfiguration(name: string): boolean }) => void),
}));
vi.mock('vscode', () => ({
	l10n: { t: (text: string) => text },
	Uri: { joinPath: (_base: unknown, ...parts: string[]) => parts.join('/') },
	ConfigurationTarget: { Global: 1, Workspace: 2 },
	ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
	workspace: {
		get isTrusted() { return mocks.trusted; },
		onDidChangeConfiguration: (callback: NonNullable<typeof mocks.configuration>) => { mocks.configuration = callback; return { dispose() {} }; },
		getConfiguration: () => ({ get: (key: string, fallback: unknown) => key in mocks.settings ? mocks.settings[key] : fallback,
			inspect: (key: string) => ({ workspaceValue: mocks.overrides[key] }), update: mocks.update }),
	},
	window: { activeColorTheme: { kind: 2 }, onDidChangeActiveColorTheme: () => ({ dispose() {} }), showErrorMessage: mocks.error },
}));
vi.mock('./StylePreviewController', () => ({ StylePreviewController: class {} }));
vi.mock('../diagnostics', () => ({ diagnosticEventRateLimited: vi.fn() }));
import { StyleManagerViewProvider } from './StyleManagerViewProvider';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}
function makeView() {
	let dispose!: () => void;
	let receive!: (message: unknown) => void;
	const postMessage = vi.fn(async (_message: unknown) => true);
	const view = {
		webview: { postMessage, asWebviewUri: (uri: unknown) => uri, cspSource: 'test:', onDidReceiveMessage: (callback: typeof receive) => { receive = callback; } },
		onDidDispose: (callback: typeof dispose) => { dispose = callback; },
	};
	return { view: view as unknown as vscode.WebviewView, postMessage, dispose: () => dispose(), receive: (message: unknown) => receive(message) };
}
describe('CSS Themes async lifecycle', () => {
	let list: ReturnType<typeof vi.fn>;
	let provider: StyleManagerViewProvider;
	const entry = (name: string) => ({ id: name, name, enabled: true, css: 'h1 { color: red; }' });
	const push = () => (provider as unknown as { pushStyles(): Promise<void> }).pushStyles();
	beforeEach(() => {
		vi.clearAllMocks(); mocks.trusted = true; mocks.error.mockResolvedValue(undefined); mocks.update.mockResolvedValue(undefined);
		mocks.settings = {}; mocks.overrides = {};
		list = vi.fn(async () => [entry('current.css')]);
		provider = new StyleManagerViewProvider({ subscriptions: [], extensionUri: 'extension:' } as unknown as vscode.ExtensionContext,
			{ listEntries: list, onDidChange: () => ({ dispose() {} }) } as unknown as StyleStore);
	});
	it('does not post or throw when the sidebar closes during a theme read', async () => {
		const pending = deferred<any[]>(); list.mockReturnValueOnce(pending.promise);
		const view = makeView(); provider.resolveWebviewView(view.view);
		const work = push(); view.dispose(); pending.resolve([entry('old.css')]);
		await expect(work).resolves.toBeUndefined(); expect(view.postMessage).not.toHaveBeenCalled();
	});
	it('never sends an old view read into a replacement sidebar', async () => {
		const pending = deferred<any[]>(); list.mockReturnValueOnce(pending.promise);
		const old = makeView(); provider.resolveWebviewView(old.view);
		const work = push(); old.dispose(); const current = makeView(); provider.resolveWebviewView(current.view);
		pending.resolve([entry('old.css')]); await work;
		expect(current.postMessage).not.toHaveBeenCalled();
	});
	it('ignores older refreshes that finish after the newest theme read', async () => {
		const old = deferred<any[]>(); list.mockReturnValueOnce(old.promise);
		const view = makeView(); provider.resolveWebviewView(view.view);
		const first = push(); await push(); old.resolve([entry('old.css')]); await first;
		expect(view.postMessage).toHaveBeenCalledTimes(1);
		expect(view.postMessage.mock.calls[0][0]).toMatchObject({ styles: [entry('current.css')] });
	});
	it('rechecks trust before posting asynchronously read CSS', async () => {
		const pending = deferred<any[]>(); list.mockReturnValueOnce(pending.promise);
		const view = makeView(); provider.resolveWebviewView(view.view);
		const work = push(); mocks.trusted = false; pending.resolve([entry('private.css')]); await work;
		expect(view.postMessage).toHaveBeenCalledWith(expect.objectContaining({ styles: [], workspaceTrusted: false }));
	});
	it('reports read failures without rejecting a background refresh', async () => {
		list.mockRejectedValueOnce(new Error('storage unavailable'));
		const view = makeView(); provider.resolveWebviewView(view.view);
		await expect(push()).resolves.toBeUndefined(); expect(mocks.error).toHaveBeenCalledTimes(1);
	});
	it('reports failed setting writes and restores the authoritative control values', async () => {
		mocks.update.mockRejectedValueOnce(new Error('settings read-only'));
		const view = makeView(); provider.resolveWebviewView(view.view);
		view.receive({ type: 'setSetting', key: 'showWhitespace', value: 'on' });
		await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
		await vi.waitFor(() => expect(view.postMessage).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ showWhitespace: 'off' }) })));
	});
	it('defaults sticky table headers to false and refreshes its boolean value after a settings change', async () => {
		const view = makeView(); provider.resolveWebviewView(view.view);
		await push();
		expect(view.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ settings: expect.objectContaining({ stickyTableHeaders: false }) }));
		mocks.settings.stickyTableHeaders = true;
		mocks.configuration!({ affectsConfiguration: key => key === 'mdLivePreview.stickyTableHeaders' });
		await vi.waitFor(() => expect(view.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ settings: expect.objectContaining({ stickyTableHeaders: true }) })));
	});
	it.each([undefined, false, 'true', 'on', 1])('does not coerce malformed sticky table header configuration %j to enabled', async value => {
		mocks.settings.stickyTableHeaders = value;
		const view = makeView(); provider.resolveWebviewView(view.view);
		await push();
		expect(view.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ settings: expect.objectContaining({ stickyTableHeaders: false }) }));
	});
	it.each([true, false])('writes sticky table headers %s as a boolean, not a select string', async value => {
		const view = makeView(); provider.resolveWebviewView(view.view);
		view.receive({ type: 'setSetting', key: 'stickyTableHeaders', value });
		await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledWith('stickyTableHeaders', value, 1));
	});
	it('updates the workspace sticky header override and rejects coerced values', async () => {
		mocks.overrides.stickyTableHeaders = false;
		const view = makeView(); provider.resolveWebviewView(view.view);
		view.receive({ type: 'setSetting', key: 'stickyTableHeaders', value: true });
		await vi.waitFor(() => expect(mocks.update).toHaveBeenCalledWith('stickyTableHeaders', true, 2));
		mocks.update.mockClear();
		view.receive({ type: 'setSetting', key: 'stickyTableHeaders', value: 'true' });
		expect(mocks.update).not.toHaveBeenCalled();
	});
});
