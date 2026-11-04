import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { retainedTableColumnWidths, tableColumnWidths } from './tableColumnResize';

const table = '| A | B |\n| --- | --- |\n| One | Two |';
const widths = [240, 180];
function state() {
	return EditorState.create({ doc: table, extensions: [tableColumnWidths.init(() => new Map([[0, widths]]))] });
}
describe('table presentation width mapping', () => {
	it('preserves widths across whole-table row rewrites and host undo', () => {
		const start = state();
		const next = start.update({ changes: { from: 0, to: table.length, insert: table + '\n| Three | Four |' } }).state;
		expect(next.field(tableColumnWidths).get(0)).toEqual(widths);
		const restored = next.update({ changes: { from: 0, to: next.doc.length, insert: table } }).state;
		expect(restored.field(tableColumnWidths).get(0)).toEqual(widths);
		expect(start.field(tableColumnWidths).get(0)).toEqual(widths);
	});
	it('maps table offsets after preceding text is inserted', () => {
		const next = state().update({ changes: { from: 0, insert: 'Before\n\n' } }).state;
		expect(next.field(tableColumnWidths).get('Before\n\n'.length)).toEqual(widths);
		expect(next.field(tableColumnWidths).has(0)).toBe(false);
	});
	it('drops widths when the table is deleted rather than assigning them to prose', () => {
		expect(state().update({ changes: { from: 0, to: table.length, insert: 'Unrelated prose' } }).state.field(tableColumnWidths).size).toBe(0);
	});
	it('retains compatible tracks during normalized structural edits only', () => {
		const start = state();
		const next = start.update({ changes: { from: 0, to: table.length, insert: table.replace('| A | B |', '| Owner | Status |') }, effects: retainedTableColumnWidths(start, 0, 2) }).state;
		expect(next.field(tableColumnWidths).get(0)).toEqual(widths);
		expect(retainedTableColumnWidths(start, 0, 3)).toEqual([]);
	});
});
