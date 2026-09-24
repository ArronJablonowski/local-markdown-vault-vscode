import { describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
vi.mock('vscode', () => ({ EventEmitter: class { event = () => ({ dispose() {} }); fire = vi.fn(); } }));
import { StyleStore } from './styleStore';

describe('CSS cache refresh ordering', () => {
	it('does not replace newly selected CSS with an older asynchronous read', async () => {
		let finishOld!: (css: string) => void;
		const old = new Promise<string>(resolve => { finishOld = resolve; });
		const store = new StyleStore({} as vscode.ExtensionContext);
		const internal = store as unknown as { computeCombinedCss(): Promise<string>; refresh(): Promise<void> };
		vi.spyOn(internal, 'computeCombinedCss').mockReturnValueOnce(old).mockResolvedValueOnce('new CSS');
		const first = internal.refresh(); await internal.refresh(); finishOld('old CSS'); await first;
		expect(store.getCombinedCssSync()).toBe('new CSS');
	});
});
