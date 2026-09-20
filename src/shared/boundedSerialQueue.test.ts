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

	it.each([0, -1, 1.5, Number.NaN])('rejects invalid limit %s', (limit) => {
		expect(() => new BoundedSerialQueue(limit)).toThrow(/positive integer/);
	});
});
