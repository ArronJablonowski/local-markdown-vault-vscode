import { describe, expect, it } from 'vitest';
import { TokenBucketRateLimiter } from './tokenBucketRateLimiter';

describe('TokenBucketRateLimiter', () => {
	it('allows a bounded burst and rejects overflow', () => {
		let now = 100;
		const limiter = new TokenBucketRateLimiter(3, 1_000, () => now);
		expect([limiter.tryTake(), limiter.tryTake(), limiter.tryTake()]).toEqual([true, true, true]);
		expect(limiter.tryTake()).toBe(false);
		now += 999;
		expect(limiter.tryTake()).toBe(false);
		now += 1;
		expect(limiter.tryTake()).toBe(true);
		expect(limiter.tryTake()).toBe(false);
	});

	it('caps refills at the original burst capacity', () => {
		let now = 0;
		const limiter = new TokenBucketRateLimiter(2, 100, () => now);
		expect(limiter.tryTake()).toBe(true);
		now = 10_000;
		expect([limiter.tryTake(), limiter.tryTake(), limiter.tryTake()]).toEqual([true, true, false]);
	});

	it('does not mint tokens when the monotonic clock moves backwards', () => {
		let now = 1_000;
		const limiter = new TokenBucketRateLimiter(1, 100, () => now);
		expect(limiter.tryTake()).toBe(true);
		now = 500;
		expect(limiter.tryTake()).toBe(false);
		now = 1_100;
		expect(limiter.tryTake()).toBe(true);
	});

	it.each([
		[0, 1_000], [-1, 1_000], [1.5, 1_000], [Number.NaN, 1_000],
		[1, 0], [1, -1], [1, Number.NaN],
	])('rejects invalid limits (%s, %s)', (capacity, interval) => {
		expect(() => new TokenBucketRateLimiter(capacity, interval)).toThrow(/positive/);
	});
});
