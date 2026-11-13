import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

const init = { type: 'init', protocolVersion: 1, text: '# Retained', version: 1, css: '', codeTheme: 'dark-plus', remoteMedia: 'block', workspaceTrusted: true, diagramRenderingAllowed: false, editingMode: 'editing', vaultNotes: [], currentVaultPath: 'Note.md' };
let receive: ((event: MessageEvent<unknown>) => void) | undefined;
const postMessage = vi.fn();
beforeEach(() => {
	vi.useFakeTimers(); vi.resetModules(); postMessage.mockReset(); receive = undefined;
	vi.stubGlobal('crypto', webcrypto);
	vi.stubGlobal('window', { addEventListener: (_name: string, handler: typeof receive) => { receive = handler; } });
	vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage, getState: () => undefined, setState() {} }));
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('bounds startup retries and keeps one identity for one JavaScript context', async () => {
	const api = await import('./vscodeApi'); api.announceReady();
	await vi.advanceTimersByTimeAsync(20000);
	expect(postMessage).toHaveBeenCalledTimes(4);
	const first = postMessage.mock.calls[0][0]; expect(first).toEqual({ type: 'ready', instanceId: expect.stringMatching(/^[a-f0-9]{32}$/) });
	for (const [message] of postMessage.mock.calls) expect(message).toEqual(first);
	expect(vi.getTimerCount()).toBe(0);
});
it('stops retrying once a validated initialization arrives', async () => {
	const api = await import('./vscodeApi'); const handler = vi.fn(); api.onHostMessage(handler); api.announceReady();
	receive!({ data: init } as MessageEvent); await vi.advanceTimersByTimeAsync(20000);
	expect(postMessage).toHaveBeenCalledOnce(); expect(handler).toHaveBeenCalledWith(init); expect(vi.getTimerCount()).toBe(0);
});
it('does not stop recovery retries for an invalid initialization message', async () => {
	const api = await import('./vscodeApi'); api.onHostMessage(vi.fn()); api.announceReady();
	receive!({ data: { type: 'init', text: 'Invalid' } } as MessageEvent);
	await vi.advanceTimersByTimeAsync(2100); expect(postMessage).toHaveBeenCalledTimes(2);
});
it('uses a fresh identity when the renderer module starts in a replacement context', async () => {
	(await import('./vscodeApi')).announceReady(); const first = postMessage.mock.calls[0][0].instanceId;
	vi.clearAllTimers(); vi.resetModules(); (await import('./vscodeApi')).announceReady();
	expect(postMessage.mock.calls[1][0].instanceId).not.toBe(first);
});
it('clears retries even when a test host initializes synchronously', async () => {
	const api = await import('./vscodeApi'); api.onHostMessage(vi.fn());
	postMessage.mockImplementation(() => { receive!({ data: init } as MessageEvent); });
	api.announceReady(); expect(vi.getTimerCount()).toBe(0);
});
