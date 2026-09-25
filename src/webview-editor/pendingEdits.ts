import { ChangeSet } from '@codemirror/state';
import type { TextChange } from '../shared/messages';
import { takeEditBatch } from './editBatch';

export const MAX_PENDING_EDIT_GROUPS = 32;
export const MAX_PENDING_EDIT_INSERT_BYTES = 32 * 1024 * 1024;

interface PendingGroup {
	changes: ChangeSet;
	isolated: boolean;
	/** Conservative upper bound; composing may remove previously inserted text. */
	insertBytes: number;
}

/**
 * Ordered host edits with explicit undo boundaries around isolated operations.
 * Each group starts from the document produced by its predecessor. Only an
 * ordinary tail may absorb later ordinary typing; an isolated paste never can.
 */
export class PendingEdits {
	private readonly groups: PendingGroup[] = [];
	private insertBytes = 0;
	private readonly byteCounts = new WeakMap<ChangeSet, number>();

	get empty(): boolean { return this.groups.length === 0; }

	canEnqueue(changes: ChangeSet, isolated: boolean): boolean {
		if (changes.empty) return true;
		const tail = this.groups.at(-1);
		if (tail && tail.changes.newLength !== changes.length) return false;
		const combines = !isolated && tail !== undefined && !tail.isolated;
		if (!combines && this.groups.length >= MAX_PENDING_EDIT_GROUPS) return false;
		return this.insertedBytes(changes) <= MAX_PENDING_EDIT_INSERT_BYTES - this.insertBytes;
	}

	/** Call canEnqueue in the transaction filter before changing the local document. */
	enqueue(changes: ChangeSet, isolated: boolean): void {
		if (changes.empty) return;
		if (!this.canEnqueue(changes, isolated)) throw new RangeError('Pending edit capacity exceeded or document base changed.');
		const bytes = this.insertedBytes(changes);
		const tail = this.groups.at(-1);
		if (!isolated && tail && !tail.isolated) {
			const composed = tail.changes.compose(changes);
			if (composed.empty) {
				this.groups.pop();
				this.insertBytes -= tail.insertBytes;
				return;
			}
			tail.changes = composed;
			tail.insertBytes += bytes;
		} else this.groups.push({ changes, isolated, insertBytes: bytes });
		this.insertBytes += bytes;
	}

	/** Remove one bounded head batch; any remainder stays ahead of later groups. */
	takeBatch(): { changes: TextChange[] } | undefined {
		const head = this.groups[0];
		if (!head) return undefined;
		const batch = takeEditBatch(head.changes);
		if (batch.remaining) {
			const emittedBytes = batch.changes.reduce((total, change) => total + new TextEncoder().encode(change.insert).byteLength, 0);
			head.changes = batch.remaining;
			head.insertBytes -= emittedBytes;
			this.insertBytes -= emittedBytes;
		} else {
			this.groups.shift();
			this.insertBytes -= head.insertBytes;
		}
		return { changes: batch.changes };
	}

	clear(): void {
		this.groups.length = 0;
		this.insertBytes = 0;
	}

	private insertedBytes(changes: ChangeSet): number {
		const cached = this.byteCounts.get(changes);
		if (cached !== undefined) return cached;
		let bytes = 0;
		changes.iterChanges((_from, _to, _fromB, _toB, inserted) => {
			if (bytes > MAX_PENDING_EDIT_INSERT_BYTES) return;
			// Examine only this new transaction, never the growing composed tail.
			// The cache also shares work between the filter and update listener.
			if (inserted.length > MAX_PENDING_EDIT_INSERT_BYTES - bytes) bytes = MAX_PENDING_EDIT_INSERT_BYTES + 1;
			else bytes += new TextEncoder().encode(inserted.toString()).byteLength;
		});
		this.byteCounts.set(changes, bytes);
		return bytes;
	}
}
