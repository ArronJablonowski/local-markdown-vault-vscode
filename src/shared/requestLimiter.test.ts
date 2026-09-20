import { describe, expect, it } from 'vitest';
import { RequestLimiter } from './requestLimiter';

describe('RequestLimiter', () => {
	it('rejects work at the ceiling and permits it after release', () => {
		const limiter = new RequestLimiter(2);
		const first = limiter.tryAcquire();
		const second = limiter.tryAcquire();
		expect(first).toBeTypeOf('function');
		expect(second).toBeTypeOf('function');
		expect(limiter.activeCount).toBe(2);
		expect(limiter.tryAcquire()).toBeUndefined();
		first!();
		expect(limiter.activeCount).toBe(1);
		expect(limiter.tryAcquire()).toBeTypeOf('function');
	});

	it('makes release idempotent so a cleanup race cannot underflow the gate', () => {
		const limiter = new RequestLimiter(1);
		const release = limiter.tryAcquire()!;
		release();
		release();
		expect(limiter.activeCount).toBe(0);
	});

	it.each([0, -1, 1.5, Number.NaN])('rejects invalid limit %s', (limit) => {
		expect(() => new RequestLimiter(limit)).toThrow(/positive integer/);
	});
});
