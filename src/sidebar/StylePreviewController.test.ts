import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { StyleStore } from './styleStore';

const mocks = vi.hoisted(() => ({
	trusted: true, openDocument: vi.fn(), showDocument: vi.fn(), createPanel: vi.fn(),
	warn: vi.fn(), diagnostic: vi.fn(),
}));
vi.mock('vscode', () => ({
	l10n: { t: (text: string, value?: string) => text.replace('{0}', value ?? '') },
	Uri: { joinPath: (_base: unknown, ...parts: string[]) => parts.join('/') },
	ViewColumn: { One: 1, Beside: -2 },
	ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
	workspace: {
		get isTrusted() { return mocks.trusted; },
		onDidChangeTextDocument: () => ({ dispose() {} }),
		openTextDocument: mocks.openDocument,
	},
	window: {
		activeColorTheme: { kind: 2 },
		onDidChangeActiveColorTheme: () => ({ dispose() {} }),
		onDidChangeTextEditorSelection: () => ({ dispose() {} }),
		showTextDocument: mocks.showDocument, createWebviewPanel: mocks.createPanel,
		showWarningMessage: mocks.warn,
	},
}));
vi.mock('../diagnostics', () => ({ diagnosticEventRateLimited: mocks.diagnostic }));
import { StylePreviewController } from './StylePreviewController';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}
function document(name: string, css = `${name} { color: red; }`) {
	return { uri: { toString: () => name }, isClosed: false, getText: () => css, offsetAt: () => 0 } as unknown as vscode.TextDocument;
}
function editor(doc: vscode.TextDocument) {
	return { document: doc, selection: { active: {} } } as vscode.TextEditor;
}
function panel() {
	let dispose = () => {};
	const postMessage = vi.fn(async (_message: unknown) => true);
	const value = {
		webview: { postMessage, asWebviewUri: (uri: unknown) => uri, cspSource: 'test:', onDidReceiveMessage: () => ({ dispose() {} }) },
		onDidDispose: (callback: () => void) => { dispose = callback; }, reveal: vi.fn(),
	};
	return { value: value as unknown as vscode.WebviewPanel, postMessage, dispose: () => dispose() };
}

describe('CSS theme preview async lifecycle', () => {
	let controller: StylePreviewController;
	let preview: ReturnType<typeof panel>;
	let resolveUri: ReturnType<typeof vi.fn>;
	const push = () => (controller as unknown as { push(): Promise<void> }).push();
	const schedule = (doc: vscode.TextDocument) => (controller as unknown as { schedulePush(doc: vscode.TextDocument): void }).schedulePush(doc);
	beforeEach(() => {
		vi.clearAllMocks(); mocks.trusted = true;
		preview = panel(); mocks.createPanel.mockReturnValue(preview.value);
		mocks.openDocument.mockImplementation(async (uri: { toString(): string }) => document(uri.toString()));
		mocks.showDocument.mockImplementation(async (doc: vscode.TextDocument) => editor(doc));
		resolveUri = vi.fn(async (id: string) => ({ toString: () => id }));
		controller = new StylePreviewController({ subscriptions: [], extensionUri: 'extension:' } as unknown as vscode.ExtensionContext,
			{ resolveStyleUri: resolveUri } as unknown as StyleStore);
	});
	afterEach(() => vi.useRealTimers());
	it('ignores a pending read after the preview closes', async () => {
		await controller.open('first', 'First'); preview.postMessage.mockClear();
		const read = deferred<vscode.TextDocument>(); mocks.openDocument.mockReturnValueOnce(read.promise);
		const work = push(); preview.dispose(); read.resolve(document('first'));
		await expect(work).resolves.toBeUndefined();
		expect(preview.postMessage).not.toHaveBeenCalled();
	});
	it('never sends an earlier style read to the newly selected style', async () => {
		await controller.open('first', 'First');
		const read = deferred<vscode.TextDocument>(); mocks.openDocument.mockReturnValueOnce(read.promise);
		const work = push(); await controller.open('second', 'Second'); preview.postMessage.mockClear();
		read.resolve(document('first')); await work;
		expect(preview.postMessage).not.toHaveBeenCalled();
	});
	it('cancels an earlier style debounce when a different style opens', async () => {
		vi.useFakeTimers(); await controller.open('first', 'First');
		schedule(document('first', 'old pending edit'));
		await controller.open('second', 'Second'); preview.postMessage.mockClear();
		await vi.runAllTimersAsync();
		expect(preview.postMessage).not.toHaveBeenCalled();
	});
	it('honors the newest open request when an older URI resolves last', async () => {
		const uri = deferred<{ toString(): string }>(); resolveUri.mockReturnValueOnce(uri.promise);
		const first = controller.open('first', 'First'); await controller.open('second', 'Second');
		preview.postMessage.mockClear(); uri.resolve({ toString: () => 'first' }); await first;
		expect(mocks.showDocument).toHaveBeenCalledTimes(1);
		expect(preview.postMessage).not.toHaveBeenCalled();
	});
	it('does not let an older editor reveal change the active style preview', async () => {
		const show = deferred<vscode.TextEditor>(); mocks.showDocument.mockReturnValueOnce(show.promise);
		const first = controller.open('first', 'First'); await vi.waitFor(() => expect(mocks.showDocument).toHaveBeenCalledTimes(1));
		await controller.open('second', 'Second'); preview.postMessage.mockClear(); show.resolve(editor(document('first'))); await first;
		expect(preview.postMessage).not.toHaveBeenCalled();
	});
	it('does not allow an old read to overwrite a newer refresh of the same style', async () => {
		await controller.open('first', 'First');
		const read = deferred<vscode.TextDocument>(); mocks.openDocument.mockReturnValueOnce(read.promise);
		const first = push(); await push(); preview.postMessage.mockClear();
		read.resolve(document('first', 'stale CSS')); await first;
		expect(preview.postMessage).not.toHaveBeenCalled();
	});
	it('does not post an old panel read into a reopened preview of the same style', async () => {
		await controller.open('first', 'First');
		const read = deferred<vscode.TextDocument>(); mocks.openDocument.mockReturnValueOnce(read.promise);
		const work = push(); preview.dispose();
		const replacement = panel(); mocks.createPanel.mockReturnValueOnce(replacement.value);
		await controller.open('first', 'First'); replacement.postMessage.mockClear();
		read.resolve(document('first', 'old panel CSS')); await work;
		expect(replacement.postMessage).not.toHaveBeenCalled();
	});
	it('invalidates a pending read as soon as a newer edit is scheduled', async () => {
		vi.useFakeTimers(); await controller.open('first', 'First');
		const read = deferred<vscode.TextDocument>(); mocks.openDocument.mockReturnValueOnce(read.promise);
		const work = push(); schedule(document('first', 'latest edited CSS'));
		preview.postMessage.mockClear(); read.resolve(document('first', 'stale CSS')); await work;
		expect(preview.postMessage).not.toHaveBeenCalled();
		await vi.runAllTimersAsync();
		expect(preview.postMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ css: 'latest edited CSS', name: 'First' }));
	});
	it('cancels a pending debounce when the preview closes', async () => {
		vi.useFakeTimers(); await controller.open('first', 'First');
		schedule(document('first', 'pending CSS')); preview.postMessage.mockClear(); preview.dispose();
		await vi.runAllTimersAsync();
		expect(preview.postMessage).not.toHaveBeenCalled();
	});
	it('clears CSS when trust is revoked during a pending read', async () => {
		await controller.open('first', 'First'); preview.postMessage.mockClear();
		const read = deferred<vscode.TextDocument>(); mocks.openDocument.mockReturnValueOnce(read.promise);
		const work = push(); mocks.trusted = false; read.resolve(document('first', 'private CSS')); await work;
		expect(preview.postMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ css: '' }));
	});
	it('contains a rejected webview post without rejecting the background refresh', async () => {
		await controller.open('first', 'First');
		preview.postMessage.mockRejectedValueOnce(new Error('disposed webview'));
		await expect(push()).resolves.toBeUndefined();
		expect(mocks.diagnostic).toHaveBeenCalledWith('preview.postFailed');
	});
});
