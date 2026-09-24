interface RevealTarget {
	key: string;
	scope: unknown;
}

interface RevealOptions<T> {
	isVisible(): boolean;
	getTarget(): RevealTarget | undefined;
	resolve(target: RevealTarget): Promise<T | undefined>;
	reveal(entry: T, isCurrent: () => boolean): PromiseLike<unknown>;
}

/** Follow active files without opening a view the user hid or collapsed. */
export class PassiveTreeReveal<T> {
	private generation = 0;
	private requested: RevealTarget | undefined;
	private disposed = false;
	private pendingSettle: { timer: ReturnType<typeof setTimeout>; resolve: () => void } | undefined;

	constructor(private readonly options: RevealOptions<T>, private readonly settleDelayMs = 100) {}

	invalidate(): void {
		this.generation++;
		this.requested = undefined;
		if (this.pendingSettle) {
			clearTimeout(this.pendingSettle.timer);
			this.pendingSettle.resolve();
			this.pendingSettle = undefined;
		}
	}

	async update(): Promise<void> {
		if (this.disposed) return;
		const target = this.options.getTarget();
		if (!this.options.isVisible() || !target) {
			this.invalidate();
			return;
		}
		// Tab events also report dirty/save changes. These must not expand
		// folders, move selection, or start another asynchronous reveal.
		if (sameTarget(this.requested, target)) return;
		this.invalidate();
		const generation = this.generation;
		this.requested = target;
		try {
			// Let workbench visibility/tab events settle before dispatching a
			// non-cancelable VS Code reveal. Never postpone saving or indexing.
			if (this.settleDelayMs > 0) await this.waitForSettle();
			if (this.disposed || generation !== this.generation) return;
			if (!this.options.isVisible() || !sameTarget(target, this.options.getTarget())) {
				this.requested = undefined;
				return;
			}
			const entry = await this.options.resolve(target);
			if (this.disposed || generation !== this.generation) return;
			if (entry === undefined || !this.options.isVisible() || !sameTarget(target, this.options.getTarget())) {
				this.requested = undefined;
				return;
			}
			await this.options.reveal(entry, () => !this.disposed && generation === this.generation
				&& this.options.isVisible() && sameTarget(target, this.options.getTarget()));
		} catch {
			// Watchers can move/remove entries while resolving them. Permit a
			// later event to retry, without rejecting a background event handler.
			if (generation === this.generation) this.requested = undefined;
		}
	}

	private waitForSettle(): Promise<void> {
		return new Promise(resolve => {
			const pending = {
				resolve,
				timer: setTimeout(() => {
					if (this.pendingSettle === pending) this.pendingSettle = undefined;
					resolve();
				}, this.settleDelayMs),
			};
			this.pendingSettle = pending;
		});
	}

	dispose(): void {
		this.disposed = true;
		this.invalidate();
	}
}

function sameTarget(a: RevealTarget | undefined, b: RevealTarget | undefined): boolean {
	return a !== undefined && b !== undefined && a.key === b.key && a.scope === b.scope;
}
