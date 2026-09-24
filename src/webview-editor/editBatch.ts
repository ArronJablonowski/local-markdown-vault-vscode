import { ChangeSet } from '@codemirror/state';
import { MAX_EDIT_CHANGES, MAX_EDITOR_MESSAGE_TEXT_BYTES } from '../shared/messageValidation';
import type { TextChange } from '../shared/messages';

/** Split a pending edit without relaxing the host's per-message security limits. */
export function takeEditBatch(pending: ChangeSet): { changes: TextChange[]; remaining: ChangeSet | null } {
	const remaining: TextChange[] = [];
	pending.iterChanges((from, to, _fromB, _toB, inserted) => remaining.push({ from, to, insert: inserted.toString() }));
	const changes: TextChange[] = [];
	const encoder = new TextEncoder();
	let budget = MAX_EDITOR_MESSAGE_TEXT_BYTES;
	let length = pending.length;
	// Work from the end so unbatched changes to the left retain their offsets.
	while (remaining.length && changes.length < MAX_EDIT_CHANGES) {
		const change = remaining[remaining.length - 1];
		const bytes = encoder.encode(change.insert).byteLength;
		if (bytes > budget) {
			if (changes.length) break;
			let low = 0, high = Math.min(change.insert.length, budget);
			while (low < high) {
				const middle = Math.ceil((low + high) / 2);
				if (encoder.encode(change.insert.slice(0, middle)).byteLength <= budget) low = middle;
				else high = middle - 1;
			}
			// Never turn a valid emoji's surrogate pair into two replacement characters.
			if (low && /[\uD800-\uDBFF]/.test(change.insert[low - 1]) && /[\uDC00-\uDFFF]/.test(change.insert[low] ?? '')) low--;
			const insert = change.insert.slice(0, low);
			changes.push({ ...change, insert });
			length += insert.length - (change.to - change.from);
			remaining[remaining.length - 1] = { from: change.from + low, to: change.from + low, insert: change.insert.slice(low) };
			break;
		}
		remaining.pop();
		changes.unshift(change);
		budget -= bytes;
		length += change.insert.length - (change.to - change.from);
	}
	return { changes, remaining: remaining.length ? ChangeSet.of(remaining, length) : null };
}
