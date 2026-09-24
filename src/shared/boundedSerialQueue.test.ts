import { describe, expect, it, vi } from 'vitest';
import { BoundedSerialQueue } from './boundedSerialQueue';

function deferred(): { promise: Promise<void>; resolve: () => void; reject: () => void } {
	let resolve!: () => void;
	let reject!: () => void;
	const promise = new Promise<void>((accept, fail) => {
		resolve = accept;
		reject = () => fail(new Error('expected task failure'));
	});
	return { promise, resolve, reject };
}

describe('BoundedSerialQueue', () => {
	it('serializes accepted work and rejects overflow without retaining it', async () => {
		const queue = new BoundedSerialQueue(2);
		const first = deferred();
		const order: string[] = [];
		expect(queue.tryEnqueue(async () => {
			order.push('first-start');
			await first.promise;
			order.push('first-end');
		})).toBe(true);
		expect(queue.tryEnqueue(() => { order.push('second'); })).toBe(true);
		expect(queue.tryEnqueue(() => { order.push('rejected'); })).toBe(false);
		expect(queue.pendingCount).toBe(2);

		await Promise.resolve();
		expect(order).toEqual(['first-start']);
		first.resolve();
		await queue.drain();
		expect(order).toEqual(['first-start', 'first-end', 'second']);
		expect(queue.pendingCount).toBe(0);
	});

	it('contains task failures and continues with later work', async () => {
		const queue = new BoundedSerialQueue(3);
		const failure = deferred();
		const onError = vi.fn();
		const next = vi.fn();
		expect(queue.tryEnqueue(() => failure.promise, onError)).toBe(true);
		expect(queue.tryEnqueue(next)).toBe(true);
		failure.reject();
		await queue.drain();
		expect(onError).toHaveBeenCalledOnce();
		expect(next).toHaveBeenCalledOnce();
		expect(queue.pendingCount).toBe(0);
	});
	it('keeps draining when a running task enqueues a deferred follow-up', async () => {
		const queue = new BoundedSerialQueue(3);
		const first = deferred();
		const followup = deferred();
		const order: string[] = [];
		queue.tryEnqueue(async () => {
			await first.promise;
			order.push('first');
			queue.tryEnqueue(async () => { await followup.promise; order.push('follow-up'); });
		});
		let finished = false;
		const draining = queue.drain().then(() => { finished = true; });
		first.resolve();
		await vi.waitFor(() => expect(order).toEqual(['first']));
		expect(finished).toBe(false);
		followup.resolve();
		await draining;
		expect(order).toEqual(['first', 'follow-up']);
		expect(queue.pendingCount).toBe(0);
	});
	it('waits for recovery work enqueued by a failure callback', async () => {
		const queue = new BoundedSerialQueue(2);
		const recovery = deferred();
		queue.tryEnqueue(async () => { throw new Error('expected'); }, () => {
			queue.tryEnqueue(() => recovery.promise);
		});
		let finished = false;
		const draining = queue.drain().then(() => { finished = true; });
		await vi.waitFor(() => expect(queue.pendingCount).toBe(1));
		expect(finished).toBe(false);
		recovery.resolve();
		await draining;
		expect(queue.pendingCount).toBe(0);
	});
	it('includes work accepted after drain starts but before its captured tail settles', async () => {
		const queue = new BoundedSerialQueue(1);
		const task = deferred();
		const draining = queue.drain();
		queue.tryEnqueue(() => task.promise);
		let finished = false;
		void draining.then(() => { finished = true; });
		await Promise.resolve();
		expect(finished).toBe(false);
		task.resolve();
		await draining;
		expect(queue.pendingCount).toBe(0);
	});

	it.each([0, -1, 1.5, Number.NaN])('rejects invalid limit %s', (limit) => {
		expect(() => new BoundedSerialQueue(limit)).toThrow(/positive integer/);
	});
});
