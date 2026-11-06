import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ change: undefined as ((e: any) => void) | undefined, command: vi.fn(), subscription: vi.fn() }));
vi.mock('vscode', () => ({ Uri: { joinPath: (_root: unknown, ...parts: string[]) => ({ toString: () => parts.join('/') }) },
	workspace: { onDidChangeTextDocument: (handler: any) => { state.change = handler; return { dispose: state.subscription }; } }, commands: { executeCommand: state.command } }));
import { CsvTableProvider } from './CsvTableProvider';

function setup(text = 'A,B\n1,2', scheme = 'file') {
	let receive: (message: unknown) => void = () => {};
	let dispose: () => void = () => {};
	const postMessage = vi.fn();
	const webview: any = { postMessage, asWebviewUri: (uri: unknown) => uri, cspSource: 'vscode-webview:', onDidReceiveMessage: (handler: any) => { receive = handler; return { dispose: vi.fn() }; } };
	const document: any = { uri: { scheme }, getText: vi.fn(() => text), positionAt: (offset: number) => Math.min(offset, text.length), offsetAt: (position: number) => position };
	new CsvTableProvider({ extensionUri: {} } as any).resolveCustomTextEditor(document, { webview, viewColumn: 2, onDidDispose: (handler: any) => { dispose = handler; } } as any);
	return { webview, postMessage, document, receive: (m: unknown) => receive(m), dispose: () => dispose() };
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
describe('CSV host boundary', () => {
	it('ships only a strict local script/style shell without embedding CSV', () => {
		const fixture = setup('</script><img src=x>');
		expect(fixture.webview.html).not.toContain('</script><img');
		expect(fixture.webview.html).toContain("default-src 'none'");
		expect(fixture.webview.html).not.toContain('unsafe-inline');
		expect(fixture.webview.options.localResourceRoots).toHaveLength(2);
		fixture.receive({ type: 'ready' }); expect(fixture.postMessage).toHaveBeenCalledWith({ type: 'csv', text: '</script><img src=x>' });
	});
	it('accepts no arbitrary commands, paths, or mutation messages', () => {
		const fixture = setup();
		for (const message of [null, [], 'ready', { type: 'ready', path: '/outside' }, { type: 'edit' }, { type: 'command', command: 'evil' }]) fixture.receive(message);
		expect(fixture.postMessage).not.toHaveBeenCalled(); expect(state.command).not.toHaveBeenCalled();
		fixture.receive({ type: 'openSource' }); expect(state.command).toHaveBeenCalledWith('vscode.openWith', fixture.document.uri, 'default', { viewColumn: 2 });
	});
	it('coalesces source edits and disposes pending work', () => {
		vi.useFakeTimers(); const fixture = setup(); fixture.receive({ type: 'ready' }); fixture.receive({ type: 'ready' });
		expect(fixture.postMessage).toHaveBeenCalledTimes(1);
		state.change!({ document: fixture.document }); state.change!({ document: fixture.document }); vi.advanceTimersByTime(100);
		expect(fixture.postMessage).toHaveBeenCalledTimes(2);
		state.change!({ document: fixture.document }); fixture.dispose(); vi.advanceTimersByTime(100);
		expect(fixture.postMessage).toHaveBeenCalledTimes(2); expect(state.subscription).toHaveBeenCalled();
	});
	it('replays the current buffer when a hidden webview is recreated', () => {
		vi.useFakeTimers(); const fixture = setup(); fixture.receive({ type: 'ready' });
		fixture.receive({ type: 'ready' }); vi.advanceTimersByTime(100);
		expect(fixture.postMessage).toHaveBeenCalledTimes(2);
		expect(fixture.postMessage.mock.calls[1][0]).toEqual({ type: 'csv', text: 'A,B\n1,2' });
	});
	it.each([['remote', 'small'], ['file', 'x'.repeat(5 * 1024 * 1024 + 1)]])('does not publish unsupported input: %s', (scheme, text) => {
		const fixture = setup(text, scheme); fixture.receive({ type: 'ready' }); expect(fixture.postMessage.mock.calls[0][0].type).toBe('error');
		expect(fixture.document.getText).not.toHaveBeenCalled();
	});
});
