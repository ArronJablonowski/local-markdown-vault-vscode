import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('vscode', () => ({
	workspace: {
		isTrusted: false,
		getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback, inspect: () => undefined }),
		onDidChangeConfiguration: () => ({ dispose() {} }),
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

describe('host line navigation ordering', () => {
	let session: any;
	beforeEach(() => {
		mocks.post.mockReset();
		const document = {
			version: 1, isClosed: false, lineCount: 10,
			getText: () => Array.from({ length: 10 }, (_, index) => `Line ${index + 1}`).join('\n'),
			uri: { toString: () => 'file:///vault/Note.md' },
		};
		session = new DocumentSyncSession(document as any, {
			visible: true, webview: { html: '', postMessage: mocks.post, onDidReceiveMessage: () => ({ dispose() {} }) },
			onDidChangeViewState: () => ({ dispose() {} }),
		} as any, () => '', () => []);
		session.scheduleVaultNotesSync = vi.fn();
		session.scheduleRehighlight = vi.fn();
	});
	afterEach(async () => { await session.dispose(); });

	function lineJumps() {
		return mocks.post.mock.calls.map(([message]) => message).filter(message => message.type === 'jumpToLine');
	}

	async function finishReady() {
		session.handleMessage({ type: 'ready' });
		await session.mutationQueue.drain();
		await Promise.resolve();
	}

	it('holds the newest jump until init follows pending save work', async () => {
		let release!: () => void;
		const saving = new Promise<void>(resolve => { release = resolve; });
		session.mutationQueue.tryEnqueue(() => saving);
		session.jumpToLine(2);
		session.handleMessage({ type: 'ready' });
		session.jumpToLine(7);
		const beforeInitialization = lineJumps();
		release();
		await session.mutationQueue.drain();
		await Promise.resolve();
		expect(beforeInitialization).toEqual([]);
		expect(lineJumps()).toEqual([{ type: 'jumpToLine', line: 7 }]);
		const types = mocks.post.mock.calls.map(([message]) => message.type);
		expect(types.indexOf('init')).toBeLessThan(types.indexOf('jumpToLine'));
	});

	it('delivers initialized visible jumps immediately without replaying them later', async () => {
		await finishReady();
		mocks.post.mockClear();
		session.jumpToLine(8);
		expect(lineJumps()).toEqual([{ type: 'jumpToLine', line: 8 }]);
		session.setVisible(false);
		session.setVisible(true);
		expect(lineJumps()).toEqual([{ type: 'jumpToLine', line: 8 }]);
	});

	it('holds only the newest hidden-panel jump until the panel is visible', async () => {
		await finishReady();
		session.setVisible(false);
		mocks.post.mockClear();
		session.jumpToLine(3);
		session.jumpToLine(9);
		expect(lineJumps()).toEqual([]);
		session.setVisible(true);
		expect(lineJumps()).toEqual([{ type: 'jumpToLine', line: 9 }]);
	});

	it('does not reuse the old renderer initialization after a webview reload', async () => {
		await finishReady();
		session.reloadWebview('<!doctype html><title>Replacement</title>');
		mocks.post.mockClear();
		session.jumpToLine(4);
		await finishReady();
		expect(lineJumps()).toEqual([{ type: 'jumpToLine', line: 4 }]);
		const types = mocks.post.mock.calls.map(([message]) => message.type);
		expect(types.indexOf('init')).toBeLessThan(types.indexOf('jumpToLine'));
	});
});
