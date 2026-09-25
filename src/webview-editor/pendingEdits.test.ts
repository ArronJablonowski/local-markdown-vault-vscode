import { describe, expect, it } from 'vitest';
import { ChangeSet, Text } from '@codemirror/state';
import { MAX_EDITOR_MESSAGE_TEXT_BYTES, validateEditorToHostMessage } from '../shared/messageValidation';
import { MAX_PENDING_EDIT_GROUPS, MAX_PENDING_EDIT_INSERT_BYTES, PendingEdits } from './pendingEdits';

function apply(document: Text, batch: { changes: Array<{ from: number; to: number; insert: string }> } | undefined): Text {
	expect(batch).toBeDefined();
	expect(validateEditorToHostMessage({ type: 'edit', baseVersion: 1, changes: batch!.changes }, document.length, 1).ok).toBe(true);
	return ChangeSet.of(batch!.changes, document.length).apply(document);
}

describe('pending host edit groups', () => {
	it('keeps typing before and after an isolated paste in separate host operations', () => {
		const queue = new PendingEdits();
		let document = Text.of(['Start']);
		queue.enqueue(ChangeSet.of({ from: 5, insert: ' AB' }, 5), false);
		queue.enqueue(ChangeSet.of({ from: 8, insert: '\n| A | B |\n| --- | --- |\n| 1 | 2 |' }, 8), true);
		const afterPaste = 8 + '\n| A | B |\n| --- | --- |\n| 1 | 2 |'.length;
		queue.enqueue(ChangeSet.of({ from: afterPaste, insert: '\nLater' }, afterPaste), false);
		document = apply(document, queue.takeBatch()); expect(document.toString()).toBe('Start AB');
		document = apply(document, queue.takeBatch()); expect(document.toString()).toContain('| 1 | 2 |');
		expect(document.toString()).not.toContain('Later');
		document = apply(document, queue.takeBatch()); expect(document.toString()).toContain('\nLater');
		expect(queue.empty).toBe(true); expect(queue.takeBatch()).toBeUndefined();
	});

	it('composes ordinary typing, but never consecutive isolated operations', () => {
		const queue = new PendingEdits();
		queue.enqueue(ChangeSet.of({ from: 0, insert: 'A' }, 0), false);
		queue.enqueue(ChangeSet.of({ from: 1, insert: 'B' }, 1), false);
		queue.enqueue(ChangeSet.of({ from: 2, insert: 'C' }, 2), true);
		queue.enqueue(ChangeSet.of({ from: 3, insert: 'D' }, 3), true);
		let document = apply(Text.empty, queue.takeBatch()); expect(document.toString()).toBe('AB');
		document = apply(document, queue.takeBatch()); expect(document.toString()).toBe('ABC');
		document = apply(document, queue.takeBatch()); expect(document.toString()).toBe('ABCD');
		expect(queue.empty).toBe(true);
	});

	it('keeps an oversized earlier group remainder ahead of a later isolated paste', () => {
		const queue = new PendingEdits(), large = '\u{1f642}'.repeat(300_000);
		queue.enqueue(ChangeSet.of({ from: 0, insert: large }, 0), false);
		queue.enqueue(ChangeSet.of({ from: large.length, insert: 'GRID' }, large.length), true);
		let document = apply(Text.empty, queue.takeBatch()); expect(document.toString()).not.toContain('GRID');
		document = apply(document, queue.takeBatch()); expect(document.toString()).toBe(large);
		document = apply(document, queue.takeBatch()); expect(document.toString()).toBe(large + 'GRID');
		expect(queue.empty).toBe(true);
	});

	it('retains the 1,000-change message limit without reordering the next group', () => {
		const queue = new PendingEdits(); let document = Text.of(['ab'.repeat(1100)]);
		queue.enqueue(ChangeSet.of(Array.from({ length: 1100 }, (_, i) => ({ from: i * 2, to: i * 2 + 1, insert: 'X' })), document.length), false);
		queue.enqueue(ChangeSet.of({ from: document.length, insert: 'GRID' }, document.length), true);
		const first = queue.takeBatch(); expect(first!.changes).toHaveLength(1000);
		document = apply(document, first); document = apply(document, queue.takeBatch());
		expect(document.toString()).toBe('Xb'.repeat(1100));
		document = apply(document, queue.takeBatch()); expect(document.toString()).toBe('Xb'.repeat(1100) + 'GRID');
	});

	it('bounds isolated groups without discarding already queued work', () => {
		const queue = new PendingEdits();
		for (let i = 0; i < MAX_PENDING_EDIT_GROUPS; i++) queue.enqueue(ChangeSet.of({ from: i, insert: 'X' }, i), true);
		const next = ChangeSet.of({ from: MAX_PENDING_EDIT_GROUPS, insert: 'Y' }, MAX_PENDING_EDIT_GROUPS);
		expect(queue.canEnqueue(next, true)).toBe(false);
		expect(() => queue.enqueue(next, true)).toThrow(RangeError);
		let document = Text.empty;
		while (!queue.empty) document = apply(document, queue.takeBatch());
		expect(document.toString()).toBe('X'.repeat(MAX_PENDING_EDIT_GROUPS));
	});

	it('bounds retained insertion estimates even for repeated replacement of one small document', () => {
		const queue = new PendingEdits(), chunk = 'a'.repeat(MAX_EDITOR_MESSAGE_TEXT_BYTES);
		const replacement = ChangeSet.of({ from: 0, to: chunk.length, insert: chunk }, chunk.length);
		for (let i = 0; i < MAX_PENDING_EDIT_INSERT_BYTES / chunk.length; i++) queue.enqueue(replacement, false);
		expect(queue.canEnqueue(replacement, false)).toBe(false);
		queue.takeBatch();
		expect(queue.empty).toBe(true);
		expect(queue.canEnqueue(replacement, false)).toBe(true);
	});

	it('permits an ordinary twenty MiB paste and clears all limits on reset', () => {
		const queue = new PendingEdits(), insert = 'x'.repeat(20 * 1024 * 1024);
		const large = ChangeSet.of({ from: 0, insert }, 0);
		expect(queue.canEnqueue(large, false)).toBe(true); queue.enqueue(large, false);
		queue.clear(); expect(queue.empty).toBe(true); expect(queue.takeBatch()).toBeUndefined();
		expect(queue.canEnqueue(large, false)).toBe(true);
	});

	it('releases capacity for sent chunks while preserving the partial head order', () => {
		const queue = new PendingEdits(), chunk = 'x'.repeat(MAX_EDITOR_MESSAGE_TEXT_BYTES);
		queue.enqueue(ChangeSet.of({ from: 0, insert: chunk.repeat(2) }, 0), false);
		const tail = ChangeSet.of({ from: chunk.length * 2, insert: chunk.repeat(30) }, chunk.length * 2);
		queue.enqueue(tail, true);
		const extra = ChangeSet.of({ from: chunk.length * 32, insert: 'A' }, chunk.length * 32);
		expect(queue.canEnqueue(extra, true)).toBe(false); queue.takeBatch();
		expect(queue.canEnqueue(extra, true)).toBe(true);
		expect(queue.takeBatch()!.changes[0].insert).toBe(chunk);
	});

	it('ignores empty transactions and removes a canceled ordinary tail', () => {
		const queue = new PendingEdits();
		queue.enqueue(ChangeSet.empty(0), true); expect(queue.empty).toBe(true);
		queue.enqueue(ChangeSet.of({ from: 0, insert: 'temporary' }, 0), false);
		queue.enqueue(ChangeSet.of({ from: 0, to: 9, insert: '' }, 9), false);
		expect(queue.empty).toBe(true); expect(queue.takeBatch()).toBeUndefined();
	});

	it('rejects a mismatched document base before composition mutates the queue', () => {
		const queue = new PendingEdits(); queue.enqueue(ChangeSet.of({ from: 0, insert: 'A' }, 0), false);
		const stale = ChangeSet.of({ from: 0, insert: 'B' }, 0);
		expect(queue.canEnqueue(stale, false)).toBe(false); expect(() => queue.enqueue(stale, false)).toThrow(RangeError);
		expect(apply(Text.empty, queue.takeBatch()).toString()).toBe('A');
	});
});
