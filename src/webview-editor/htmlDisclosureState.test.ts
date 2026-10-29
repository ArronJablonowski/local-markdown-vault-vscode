import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { htmlDisclosureState, rememberHtmlDisclosures } from './htmlDisclosureState';

const source = '<details><summary>Review</summary>Evidence</details>';
function expanded() {
	return EditorState.create({ doc: 'Before\n\n' + source + '\n\nAfter', extensions: [htmlDisclosureState] })
		.update({ effects: rememberHtmlDisclosures.of({ from: 8, source, open: [0] }) }).state;
}
describe('HTML disclosure presentation state', () => {
	it('bounds retained block snapshots in a long-lived editor', () => {
		const state = EditorState.create({ doc: (source + '\n\n').repeat(1_001), extensions: [htmlDisclosureState] })
			.update({ effects: Array.from({ length: 1_001 }, (_, i) => rememberHtmlDisclosures.of({ from: i * (source.length + 2), source, open: [0] })) }).state;
		expect(state.field(htmlDisclosureState).size).toBe(1_000);
	});
	it('does not change Markdown when toggled', () => {
		const state = expanded();
		expect(state.doc.toString()).toBe('Before\n\n' + source + '\n\nAfter');
		expect(state.field(htmlDisclosureState).get(8)?.open).toEqual([0]);
	});
	it('maps across edits before and after the block', () => {
		const state = expanded().update({ changes: [{ from: 0, insert: 'New ' }, { from: 8 + source.length + 2, insert: 'Updated ' }] }).state;
		expect(state.field(htmlDisclosureState).get(12)?.open).toEqual([0]);
	});
	it('discards state when the underlying HTML is edited or removed', () => {
		for (const changes of [{ from: 8, to: 8 + source.length, insert: '' }, { from: 30, insert: 'changed' }]) {
			expect(expanded().update({ changes }).state.field(htmlDisclosureState).size).toBe(0);
		}
	});
	it('removes a fully closed snapshot', () => {
		const state = expanded().update({ effects: rememberHtmlDisclosures.of({ from: 8, source, open: [] }) }).state;
		expect(state.field(htmlDisclosureState).size).toBe(0);
	});
	it('rejects stale sources and invalid ordinal indices', () => {
		for (const snapshot of [{ from: -1, source, open: [0] }, { from: 8, source: 'stale', open: [0] },
			{ from: 8, source, open: [-1] }, { from: 8, source, open: [2_000] }, { from: 8, source, open: [0.5] }]) {
			const state = EditorState.create({ doc: 'Before\n\n' + source, extensions: [htmlDisclosureState] })
				.update({ effects: rememberHtmlDisclosures.of(snapshot) }).state;
			expect(state.field(htmlDisclosureState).size).toBe(0);
		}
	});
});
