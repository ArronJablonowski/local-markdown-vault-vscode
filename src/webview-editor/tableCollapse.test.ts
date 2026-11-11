import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { setTableCollapsed, tableCollapseState } from './tableCollapse';
import { collectCollapsibleObjects } from './foldAll';
import { GFM } from './gfmTableFix';

const table = '| A | B |\n| --- | --- |\n' + Array.from({ length: 9 }, (_, n) => `| Row ${n + 1} | Value |`).join('\n');
function state(doc = table) { return EditorState.create({ doc, extensions: [tableCollapseState, markdown({ extensions: GFM })] }); }
describe('view-only table collapse state', () => {
	it('toggles without modifying source', () => {
		const collapsed = state().update({ effects: setTableCollapsed.of({ from: 0, collapsed: true }) }).state;
		expect([...collapsed.field(tableCollapseState)]).toEqual([0]);
		expect(collapsed.doc.toString()).toBe(table);
		expect(collapsed.update({ effects: setTableCollapsed.of({ from: 0, collapsed: false }) }).state.field(tableCollapseState).size).toBe(0);
	});
	it('maps through insertions and cell edits', () => {
		const collapsed = state().update({ effects: setTableCollapsed.of({ from: 0, collapsed: true }) }).state;
		const moved = collapsed.update({ changes: { from: 0, insert: 'Before\n\n' } }).state;
		expect([...moved.field(tableCollapseState)]).toEqual([8]);
		expect([...moved.update({ changes: { from: moved.doc.length, insert: '\nAfter' } }).state.field(tableCollapseState)]).toEqual([8]);
	});
	it('does not donate deleted collapse state to an identical neighbor', () => {
		const collapsed = state(table + '\n\n' + table).update({ effects: setTableCollapsed.of({ from: 0, collapsed: true }) }).state;
		expect(collapsed.update({ changes: { from: 0, to: table.length + 2 } }).state.field(tableCollapseState).size).toBe(0);
	});
	it('preserves choices through compatible table rewrites', () => {
		const collapsed = state().update({ effects: setTableCollapsed.of({ from: 0, collapsed: true }) }).state;
		expect(collapsed.update({ changes: { from: 0, to: table.length, insert: table.replace('Row 9', 'Updated') } }).state.field(tableCollapseState).has(0)).toBe(true);
	});
	it.each([5, 6, 9])('only collects tables with more than five data rows: %i', count => {
		const doc = '| A |\n| --- |\n' + Array.from({ length: count }, (_, n) => `| Row ${n + 1} |`).join('\n');
		const parsed = state(doc); ensureSyntaxTree(parsed, doc.length, 5000);
		const objects = collectCollapsibleObjects(parsed.update({}).state);
		expect(objects).toHaveLength(count > 5 ? 1 : 0);
		if (count > 5) expect(objects[0]).toEqual({ kind: 'table', from: doc.indexOf('| Row 6'), to: doc.length, anchor: 0 });
	});
	it.each([
		['> ', '> [!note] Meeting\n>\n'], ['  ', '- Item\n\n'],
		['> > ', '> [!note] Outer\n>\n> > [!tip] Inner\n> >\n'],
	])('uses the same whole-line anchor as the %j table widget', (prefix, intro) => {
		const doc = intro + table.split('\n').map(line => prefix + line).join('\n');
		const parsed = state(doc); ensureSyntaxTree(parsed, doc.length, 5000);
		const target = collectCollapsibleObjects(parsed.update({}).state).find(object => object.kind === 'table');
		expect(target?.anchor).toBe(doc.indexOf(prefix + '| A | B |'));
		expect(target?.from).toBe(doc.indexOf(prefix + '| Row 6 |'));
	});
});
