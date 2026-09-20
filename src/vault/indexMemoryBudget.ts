export const MAX_IN_MEMORY_INDEX_BYTES = 128 * 1024 * 1024;

/**
 * Conservative size of the record's JSON-shaped attacker-controlled data in
 * JavaScript's two-byte string representation. Avoiding UTF-8 encoding here is
 * important because this runs once per note during every cold rebuild.
 */
export function retainedIndexRecordBytes(value: unknown): number {
	return JSON.stringify(value).length * 2;
}

/** Tracks attacker-controlled strings and arrays retained across the whole vault. */
export class IndexMemoryBudget {
	private readonly sizes = new Map<string, number>();
	private used = 0;

	constructor(readonly limit = MAX_IN_MEMORY_INDEX_BYTES) {
		if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Invalid vault index memory limit.');
	}

	tryReplace(key: string, bytes: number): boolean {
		if (!Number.isSafeInteger(bytes) || bytes < 0) return false;
		const next = this.used - (this.sizes.get(key) ?? 0) + bytes;
		if (!Number.isSafeInteger(next) || next > this.limit) return false;
		this.sizes.set(key, bytes);
		this.used = next;
		return true;
	}

	delete(key: string): void {
		const prior = this.sizes.get(key);
		if (prior === undefined) return;
		this.sizes.delete(key);
		this.used -= prior;
	}

	clear(): void {
		this.sizes.clear();
		this.used = 0;
	}

	get usedBytes(): number {
		return this.used;
	}
}
