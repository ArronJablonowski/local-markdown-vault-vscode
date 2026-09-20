/** A small synchronous token bucket for bounding sustained privileged actions. */
export class TokenBucketRateLimiter {
	private tokens: number;
	private lastRefillMs: number;

	constructor(
		readonly capacity: number,
		readonly refillIntervalMs: number,
		private readonly now: () => number = Date.now,
	) {
		if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Token capacity must be a positive integer.');
		if (!Number.isFinite(refillIntervalMs) || refillIntervalMs <= 0) throw new Error('Refill interval must be positive.');
		this.tokens = capacity;
		this.lastRefillMs = this.safeNow();
	}

	tryTake(): boolean {
		const current = this.safeNow();
		const elapsed = Math.max(0, current - this.lastRefillMs);
		if (elapsed > 0) {
			this.tokens = Math.min(this.capacity, this.tokens + elapsed / this.refillIntervalMs);
			this.lastRefillMs = current;
		}
		if (this.tokens < 1) return false;
		this.tokens--;
		return true;
	}

	private safeNow(): number {
		const value = this.now();
		return Number.isFinite(value) ? value : 0;
	}
}
