/** Small synchronous gate for bounding asynchronous host work. */
export class RequestLimiter {
	private active = 0;

	constructor(readonly limit: number) {
		if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Request limit must be a positive integer.');
	}

	/** Returns an idempotent release callback, or `undefined` when saturated. */
	tryAcquire(): (() => void) | undefined {
		if (this.active >= this.limit) return undefined;
		this.active++;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.active--;
		};
	}

	get activeCount(): number {
		return this.active;
	}
}
