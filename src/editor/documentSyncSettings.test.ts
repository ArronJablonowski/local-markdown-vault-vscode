import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	settings: {} as Record<string, unknown>, post: vi.fn(), getConfiguration: vi.fn(),
	configuration: undefined as undefined | ((event: { affectsConfiguration(name: string, resource?: unknown): boolean }) => void),
}));
vi.mock('vscode', () => ({
	workspace: {
		isTrusted: false, getConfiguration: mocks.getConfiguration,
		onDidChangeConfiguration: (callback: NonNullable<typeof mocks.configuration>) => { mocks.configuration = callback; return { dispose() {} }; },
		onDidChangeTextDocument: () => ({ dispose() {} }),
	},
	window: { onDidChangeActiveColorTheme: () => ({ dispose() {} }) },
}));
vi.mock('./shikiHost', () => ({ pickCodeTheme: () => 'dark-plus' }));
vi.mock('../vault/VaultService', () => ({}));
vi.mock('../vault/CaseRenameCoordinator', () => ({}));
vi.mock('../diagnostics', () => ({ diagnosticEventRateLimited: vi.fn() }));
vi.mock('./configuredDocumentOpen', () => ({}));
vi.mock('./workspaceVault', () => ({ localWorkspaceVaultRoot: () => undefined }));
import { DocumentSyncSession } from './documentSync';

describe('live editor display settings', () => {
	let session: any;
	let document: any;
	beforeEach(() => {
		mocks.settings = {}; mocks.post.mockReset();
		mocks.getConfiguration.mockReset().mockImplementation(() => ({
			get: (key: string, fallback: unknown) => key in mocks.settings ? mocks.settings[key] : fallback,
			inspect: () => undefined,
		}));
		document = { version: 1, isClosed: false, getText: () => '# Note', uri: { toString: () => 'file:///vault/Note.md' } };
		session = new DocumentSyncSession(document, {
			visible: true, webview: { html: 'unchanged', postMessage: mocks.post, onDidReceiveMessage: () => ({ dispose() {} }) },
			onDidChangeViewState: () => ({ dispose() {} }),
		} as any, () => '', () => []);
		session.scheduleVaultNotesSync = vi.fn();
	});
	afterEach(async () => { await session.dispose(); });
	it('sends sticky headers off on initialization when no value is configured', () => {
		session.sendInit();
		expect(mocks.post).toHaveBeenCalledWith({ type: 'setStickyTableHeaders', enabled: false });
		expect(mocks.getConfiguration).toHaveBeenCalledWith('mdLivePreview', document.uri);
	});
	it.each([true, false])('sends configured sticky headers %s on initialization', enabled => {
		mocks.settings.stickyTableHeaders = enabled;
		session.sendInit();
		expect(mocks.post).toHaveBeenCalledWith({ type: 'setStickyTableHeaders', enabled });
	});
	it.each(['true', 'on', 1, null, undefined, []])('treats malformed sticky header value %j as off', value => {
		mocks.settings.stickyTableHeaders = value;
		session.sendStickyTableHeadersSetting();
		expect(mocks.post).toHaveBeenCalledExactlyOnceWith({ type: 'setStickyTableHeaders', enabled: false });
	});
	it('updates the current resource without reloading or changing its document', () => {
		session.readyReceived = true;
		mocks.settings.stickyTableHeaders = true;
		const affectsConfiguration = vi.fn((key: string) => key === 'mdLivePreview.stickyTableHeaders');
		mocks.configuration!({ affectsConfiguration });
		expect(affectsConfiguration).toHaveBeenCalledWith('mdLivePreview.stickyTableHeaders', document.uri);
		expect(mocks.post).toHaveBeenCalledExactlyOnceWith({ type: 'setStickyTableHeaders', enabled: true });
		expect(session.webviewPanel.webview.html).toBe('unchanged');
		expect(document.getText()).toBe('# Note');
		expect(document.version).toBe(1);
	});
	it('applies setting updates to ready retained panels, but waits for init before the handshake', () => {
		mocks.settings.stickyTableHeaders = true;
		const event = { affectsConfiguration: (key: string) => key === 'mdLivePreview.stickyTableHeaders' };
		mocks.configuration!(event);
		expect(mocks.post).not.toHaveBeenCalled();
		session.readyReceived = true;
		session.setVisible(false); mocks.post.mockClear();
		mocks.configuration!(event);
		expect(mocks.post).toHaveBeenCalledExactlyOnceWith({ type: 'setStickyTableHeaders', enabled: true });
	});
});
