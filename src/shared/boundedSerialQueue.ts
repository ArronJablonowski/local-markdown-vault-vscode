/**
 * A fail-closed FIFO for privileged work that must not overlap.
 *
 * `pendingCount` includes the currently running task. Rejected tasks are never
 * retained, so a forged message flood cannot build an unbounded promise chain.
 * Task failures are contained and cannot poison later work.
 */
export class BoundedSerialQueue {
	private tail: Promise<void> = Promise.resolve();
	private pending = 0;

	constructor(readonly limit: number) {
		if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Queue limit must be a positive integer.');
	}

	tryEnqueue(task: () => void | Promise<void>, onError?: () => void): boolean {
		if (this.pending >= this.limit) return false;
		this.pending++;
		const run = this.tail.then(task, task);
		this.tail = run.then(
			() => { this.pending--; },
			() => {
				this.pending--;
				onError?.();
			},
		);
		return true;
	}

	get pendingCount(): number {
		return this.pending;
	}

	/** Test and shutdown hook: resolves when every accepted task has settled. */
	drain(): Promise<void> {
		return this.tail;
	}
}
