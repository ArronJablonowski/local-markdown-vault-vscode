import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	tokenize: vi.fn(), diagnostic: vi.fn(),
	configuration: undefined as undefined | ((event: any) => void),
	post: vi.fn(),
}));
vi.mock('vscode', () => ({
	workspace: {
		onDidChangeConfiguration: (callback: any) => { mocks.configuration = callback; return { dispose() {} }; },
		onDidChangeTextDocument: () => ({ dispose() {} }),
	},
	window: { onDidChangeActiveColorTheme: () => ({ dispose() {} }) },
}));
vi.mock('./shikiHost', () => ({ tokenizeDocument: mocks.tokenize, pickCodeTheme: () => 'dark-plus' }));
vi.mock('../vault/VaultService', () => ({}));
vi.mock('../vault/CaseRenameCoordinator', () => ({}));
vi.mock('../diagnostics', () => ({ diagnosticEventRateLimited: mocks.diagnostic }));
vi.mock('./configuredDocumentOpen', () => ({}));
vi.mock('./workspaceVault', () => ({ localWorkspaceVaultRoot: () => undefined }));
import { DocumentSyncSession } from './documentSync';

describe('host code highlighting lifecycle', () => {
	let session: any;
	let document: any;
	beforeEach(() => {
		vi.useFakeTimers();
		mocks.tokenize.mockReset().mockResolvedValue([]);
		mocks.post.mockReset(); mocks.diagnostic.mockReset();
		document = { version: 1, isClosed: false, getText: () => '```js\nconst a = 1;\n```', uri: { toString: () => 'file:///vault/Note.md' } };
		session = new DocumentSyncSession(document, {
			visible: true,
			webview: { postMessage: mocks.post, onDidReceiveMessage: () => ({ dispose() {} }) },
			onDidChangeViewState: () => ({ dispose() {} }),
		} as any, () => '', () => []);
		session.readyReceived = true;
	});
	afterEach(async () => { await session.dispose(); vi.useRealTimers(); });
	const settle = async () => { for (let index = 0; index < 5; index++) await Promise.resolve(); };
	const block = (color: string) => [{ from: 0, to: 22, tokens: [{ from: 6, to: 11, style: `color:${color}` }] }];

	it('updates existing code colors immediately when the code-palette setting changes', async () => {
		mocks.configuration!({ affectsConfiguration: (name: string) => name === 'mdLivePreview.codeTheme' });
		await settle();
		expect(mocks.tokenize).toHaveBeenCalledOnce();
		expect(mocks.post).toHaveBeenCalledWith({ type: 'codeTokens', blocks: [] });
	});

	it('does not let an older theme request replace newer colors at the same document version', async () => {
		let oldResult!: (blocks: any[]) => void;
		mocks.tokenize.mockImplementationOnce(() => new Promise(resolve => { oldResult = resolve; }));
		session.scheduleRehighlight(true);
		mocks.tokenize.mockResolvedValueOnce(block('#ffffff'));
		session.scheduleRehighlight(true);
		await settle();
		oldResult(block('#000000')); await settle();
		expect(mocks.post).toHaveBeenCalledTimes(1);
		expect(mocks.post).toHaveBeenLastCalledWith({ type: 'codeTokens', blocks: block('#ffffff') });
	});

	it('does not post late tokenizer output after its session closes', async () => {
		let finish!: (blocks: any[]) => void;
		mocks.tokenize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		session.scheduleRehighlight(true);
		await session.dispose();
		finish([]); await settle();
		expect(mocks.post).not.toHaveBeenCalled();
	});

	it('does not reschedule a changed document after its session closes', async () => {
		let finish!: (blocks: any[]) => void;
		mocks.tokenize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		session.scheduleRehighlight(true);
		await session.dispose(); document.version++;
		finish([]); await settle();
		await vi.advanceTimersByTimeAsync(200);
		expect(mocks.tokenize).toHaveBeenCalledOnce();
	});

	it('contains tokenizer failures and remains available for the next refresh', async () => {
		mocks.tokenize.mockRejectedValueOnce(new Error('grammar initialization failed'));
		session.scheduleRehighlight(true);
		await settle();
		expect(mocks.diagnostic).toHaveBeenCalledWith('editor.codeHighlightFailed');
		mocks.tokenize.mockResolvedValueOnce([]);
		session.scheduleRehighlight(true);
		await settle();
		expect(mocks.post).toHaveBeenLastCalledWith({ type: 'codeTokens', blocks: [] });
	});

	it('contains a synchronous closed-document failure without throwing from a theme event', async () => {
		document.getText = () => { throw new Error('document unavailable'); };
		expect(() => session.scheduleRehighlight(true)).not.toThrow();
		await settle();
		expect(mocks.tokenize).not.toHaveBeenCalled();
		expect(mocks.diagnostic).toHaveBeenCalledWith('editor.codeHighlightFailed');
	});

	it('ignores a stale tokenizer result after its webview security policy reloads', async () => {
		let finish!: (blocks: any[]) => void;
		mocks.tokenize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		session.scheduleRehighlight(true);
		session.reloadWebview('<!doctype html><title>New policy</title>');
		finish([]); await settle();
		expect(mocks.post).not.toHaveBeenCalled();
	});

	it('does not parse a hidden document after an in-flight job observes newer contents', async () => {
		let finish!: (blocks: any[]) => void;
		mocks.tokenize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		session.scheduleRehighlight(true);
		session.setVisible(false); document.version++;
		finish([]); await settle();
		await vi.advanceTimersByTimeAsync(200);
		expect(mocks.tokenize).toHaveBeenCalledOnce();
		expect(mocks.post).not.toHaveBeenCalled();
	});

	it('does not retokenize for unrelated configuration changes', async () => {
		mocks.configuration!({ affectsConfiguration: () => false });
		await settle();
		expect(mocks.tokenize).not.toHaveBeenCalled();
	});
});
