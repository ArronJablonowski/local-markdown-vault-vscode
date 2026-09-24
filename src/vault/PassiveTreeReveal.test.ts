import { afterEach, describe, expect, it, vi } from 'vitest';
import { PassiveTreeReveal } from './PassiveTreeReveal';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}

function setup(delay = 0) {
	const state = { visible: true, target: { key: 'file:///vault/one.md', scope: {} } as { key: string; scope: object } | undefined };
	const resolve = vi.fn(async (_target: unknown): Promise<string | undefined> => 'entry');
	const reveal = vi.fn(async (_entry: string, _isCurrent: () => boolean) => {});
	const controller = new PassiveTreeReveal({ isVisible: () => state.visible, getTarget: () => state.target, resolve, reveal }, delay);
	return { state, resolve, reveal, controller };
}

describe('passive vault tree auto-reveal', () => {
	afterEach(() => vi.useRealTimers());

	it('cancels a settling reveal immediately when the user hides the view', async () => {
		vi.useFakeTimers();
		const h = setup(100), first = h.controller.update();
		h.state.visible = false; await h.controller.update(); await first;
		await vi.advanceTimersByTimeAsync(200);
		expect(h.resolve).not.toHaveBeenCalled(); expect(h.reveal).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('settles once without restarting the timer for dirty/save changes', async () => {
		vi.useFakeTimers();
		const h = setup(100), first = h.controller.update();
		await vi.advanceTimersByTimeAsync(99); await h.controller.update();
		expect(h.resolve).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1); await first;
		expect(h.resolve).toHaveBeenCalledTimes(1); expect(h.reveal).toHaveBeenCalledTimes(1);
	});

	it('keeps only the newest settling request and disposes its timer', async () => {
		vi.useFakeTimers();
		const h = setup(100), first = h.controller.update();
		h.state.target = { ...h.state.target!, key: 'file:///vault/two.md' };
		const second = h.controller.update(); await first;
		expect(vi.getTimerCount()).toBe(1);
		h.controller.dispose(); await second;
		expect(vi.getTimerCount()).toBe(0); expect(h.reveal).not.toHaveBeenCalled();
	});

	it('does not resolve or reveal while hidden or collapsed', async () => {
		const h = setup(); h.state.visible = false;
		await h.controller.update(); await h.controller.update();
		expect(h.resolve).not.toHaveBeenCalled(); expect(h.reveal).not.toHaveBeenCalled();
	});

	it('ignores dirty/save tab events for the same file, including a pending reveal', async () => {
		const h = setup(), pending = deferred<string>();
		h.resolve.mockReturnValueOnce(pending.promise);
		const first = h.controller.update(); await h.controller.update();
		pending.resolve('entry'); await first; await h.controller.update();
		expect(h.resolve).toHaveBeenCalledTimes(1); expect(h.reveal).toHaveBeenCalledTimes(1);
	});

	it('does not reopen a view hidden during entry resolution', async () => {
		const h = setup(), pending = deferred<string>(); h.resolve.mockReturnValueOnce(pending.promise);
		const first = h.controller.update(); h.state.visible = false;
		pending.resolve('entry'); await first;
		expect(h.reveal).not.toHaveBeenCalled();
	});

	it('follows the latest file once the user explicitly shows the view again', async () => {
		const h = setup(); await h.controller.update();
		h.state.visible = false; await h.controller.update();
		h.state.target = { ...h.state.target!, key: 'file:///vault/two.md' }; await h.controller.update();
		expect(h.reveal).toHaveBeenCalledTimes(1);
		h.state.visible = true; await h.controller.update(); await h.controller.update();
		expect(h.resolve).toHaveBeenLastCalledWith(h.state.target); expect(h.reveal).toHaveBeenCalledTimes(2);
	});

	it('discards a stale file resolution after switching tabs', async () => {
		const h = setup(), pending = deferred<string>(); h.resolve.mockReturnValueOnce(pending.promise);
		const first = h.controller.update(); h.state.target = { ...h.state.target!, key: 'file:///vault/two.md' };
		h.resolve.mockResolvedValueOnce('new-entry'); await h.controller.update();
		pending.resolve('old-entry'); await first;
		expect(h.reveal.mock.calls.map(([entry]) => entry)).toEqual(['new-entry']);
	});

	it('invalidates a pending request when hidden then shown, even for the same URI', async () => {
		const h = setup(), pending = deferred<string>(); h.resolve.mockReturnValueOnce(pending.promise);
		const first = h.controller.update(); h.state.visible = false; await h.controller.update();
		h.state.visible = true; await h.controller.update(); pending.resolve('stale-entry'); await first;
		expect(h.reveal.mock.calls.map(([entry]) => entry)).toEqual(['entry']);
	});

	it('rechecks the active file and auto-reveal setting after asynchronous resolution', async () => {
		for (const target of [undefined, { key: 'file:///vault/two.md', scope: {} }]) {
			const h = setup(), pending = deferred<string>(); h.resolve.mockReturnValueOnce(pending.promise);
			const first = h.controller.update(); h.state.target = target; pending.resolve('entry'); await first;
			expect(h.reveal).not.toHaveBeenCalled();
		}
	});

	it('rechecks vault identity even when its active URI is unchanged', async () => {
		const h = setup(), pending = deferred<string>(); h.resolve.mockReturnValueOnce(pending.promise);
		const first = h.controller.update(); h.state.target = { ...h.state.target!, scope: {} };
		pending.resolve('old-entry'); await first; expect(h.reveal).not.toHaveBeenCalled();
		await h.controller.update(); expect(h.reveal).toHaveBeenCalledTimes(1);
	});

	it('contains read/reveal failures and allows retry', async () => {
		const h = setup(); h.resolve.mockRejectedValueOnce(new Error('Moved'));
		await h.controller.update(); h.reveal.mockRejectedValueOnce(new Error('Removed'));
		await h.controller.update(); await h.controller.update();
		expect(h.resolve).toHaveBeenCalledTimes(3); expect(h.reveal).toHaveBeenCalledTimes(2);
	});

	it('invalidates the host callback while an already-dispatched reveal is waiting', async () => {
		for (const invalidate of ['hide', 'switch', 'disable', 'dispose']) {
			const h = setup(), pending = deferred<void>();
			let current: (() => boolean) | undefined;
			h.reveal.mockImplementationOnce(async (_entry, isCurrent) => {
				current = isCurrent;
				await pending.promise;
			});
			const first = h.controller.update();
			await Promise.resolve();
			expect(h.reveal).toHaveBeenCalledTimes(1);
			expect(current?.()).toBe(true);
			if (invalidate === 'hide') h.state.visible = false;
			if (invalidate === 'switch') h.state.target = { ...h.state.target!, key: 'file:///vault/two.md' };
			if (invalidate === 'disable') h.state.target = undefined;
			if (invalidate === 'dispose') h.controller.dispose();
			expect(current?.()).toBe(false);
			pending.resolve(); await first;
		}
	});

	it('does nothing with auto-reveal disabled and stops pending work on disposal', async () => {
		const h = setup(); h.state.target = undefined; await h.controller.update();
		expect(h.resolve).not.toHaveBeenCalled();
		h.state.target = { key: 'file:///vault/one.md', scope: {} };
		const pending = deferred<string>(); h.resolve.mockReturnValueOnce(pending.promise);
		const first = h.controller.update(); h.controller.dispose(); pending.resolve('entry'); await first;
		await h.controller.update(); expect(h.reveal).not.toHaveBeenCalled(); expect(h.resolve).toHaveBeenCalledTimes(1);
	});
});
