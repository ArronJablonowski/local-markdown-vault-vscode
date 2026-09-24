import { describe, expect, it } from 'vitest';
import { ChangeSet, Text } from '@codemirror/state';
import { takeEditBatch } from './editBatch';
import { validateEditorToHostMessage } from '../shared/messageValidation';

describe('bounded editor batches', () => {
	for (const insert of ['a'.repeat(1_100_000), '\u{1F642}'.repeat(300_000), '\u65e5'.repeat(400_000)]) {
		it(`round-trips a large replacement with UTF-16 length ${insert.length}`, () => {
			let document = Text.of(['left middle right']);
			let pending: ChangeSet | null = ChangeSet.of([{ from: 0, to: 4, insert: 'LEFT' }, { from: 5, to: 11, insert }, { from: 12, to: 17, insert: 'RIGHT' }], document.length);
			const expected = pending.apply(document).toString();
			let batches = 0;
			while (pending) {
				const batch = takeEditBatch(pending);
				expect(validateEditorToHostMessage({ type: 'edit', baseVersion: 1, changes: batch.changes }, document.length, 1).ok).toBe(true);
				document = ChangeSet.of(batch.changes, document.length).apply(document);
				pending = batch.remaining;
				expect(++batches).toBeLessThan(10);
			}
			expect(document.toString()).toBe(expected);
		});
	}
	it('splits more than 1,000 disjoint changes and composes later typing', () => {
		let document = Text.of(['ab'.repeat(1500)]);
		const changes = ChangeSet.of(Array.from({ length: 1500 }, (_, i) => ({ from: i * 2, to: i * 2 + 1, insert: 'X' })), document.length);
		const batch = takeEditBatch(changes);
		expect(batch.changes).toHaveLength(1000);
		document = ChangeSet.of(batch.changes, document.length).apply(document);
		const remaining = batch.remaining!.compose(ChangeSet.of({ from: changes.newLength, insert: 'later' }, changes.newLength));
		expect(remaining.apply(document).toString()).toBe('Xb'.repeat(1500) + 'later');
	});
});
