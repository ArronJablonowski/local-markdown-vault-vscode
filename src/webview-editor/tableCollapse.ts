import { StateEffect, StateField } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { protectRenderedBlockFromCaret } from './cmUtils';
import { t } from '../shared/i18n';

export const TABLE_PREVIEW_ROWS = 5;
export const setTableCollapsed = StateEffect.define<{ from: number; collapsed: boolean }>();
/** Fold choices are view-only and follow a table through unrelated source edits. */
export const tableCollapseState = StateField.define<Set<number>>({
	create: () => new Set(),
	update(value, transaction) {
		if (!transaction.docChanged && !transaction.effects.some(effect => effect.is(setTableCollapsed))) return value;
		const next = new Set<number>();
		for (const from of value) {
			let deleted = false, replaced = false;
			transaction.changes.iterChangedRanges((start, end, nextStart, nextEnd) => { if (start <= from && end > from) { deleted = true; replaced = nextEnd > nextStart; } });
			const mapped = transaction.changes.mapPos(from, deleted ? -1 : 1);
			if (!deleted || replaced && transaction.startState.doc.lineAt(from).text === transaction.newDoc.lineAt(mapped).text) next.add(mapped);
		}
		for (const effect of transaction.effects) if (effect.is(setTableCollapsed)) {
			if (effect.value.collapsed) next.add(effect.value.from); else next.delete(effect.value.from);
		}
		while (next.size > 10_000) next.delete(next.values().next().value!);
		return next.size === value.size && [...next].every(from => value.has(from)) ? value : next;
	},
});
const refreshers = new WeakMap<HTMLTableElement, () => void>();
export const syncCollapsedTables = EditorView.updateListener.of(update => {
	if (!update.docChanged && update.startState.field(tableCollapseState) === update.state.field(tableCollapseState)) return;
	for (const table of Array.from(update.view.dom.querySelectorAll<HTMLTableElement>('table.mlp-table'))) refreshers.get(table)?.();
});

/** Also used by read-only embedded tables, without editor state or source writes. */
export function tableCollapseButton(table: HTMLTableElement, changed: (collapsed: boolean) => void): { button: HTMLButtonElement; apply(collapsed: boolean): void } | undefined {
	const rows = Array.from(table.tBodies?.[0]?.rows ?? []);
	if (rows.length <= TABLE_PREVIEW_ROWS) return undefined;
	const button = document.createElement('button'); button.type = 'button'; button.className = 'mlp-table-collapse-btn';
	let collapsed = false, initialized = false;
	const apply = (next: boolean) => {
		// Ordinary note edits must not rewrite thousands of unchanged row attributes.
		if (initialized && collapsed === next) return;
		initialized = true;
		collapsed = next;
		rows.forEach((row, index) => { row.hidden = collapsed && index >= TABLE_PREVIEW_ROWS; });
		button.textContent = t(collapsed ? 'table.expand' : 'table.collapse');
		button.setAttribute('aria-label', button.textContent);
		button.setAttribute('aria-expanded', String(!collapsed));
		button.title = collapsed ? t('table.hiddenRows', String(rows.length - TABLE_PREVIEW_ROWS)) : t('table.collapseHint');
	};
	button.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });
	button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); changed(!collapsed); });
	apply(false);
	return { button, apply };
}

export function installTableCollapse(view: EditorView, wrap: HTMLElement, table: HTMLTableElement, buttons: HTMLElement, settle: () => boolean): (cell: HTMLElement) => void {
	const position = () => Number(wrap.dataset.mlpTableFrom);
	const control = tableCollapseButton(table, collapsed => {
		if (!settle()) return;
		protectRenderedBlockFromCaret();
		const from = position();
		view.dispatch({ effects: setTableCollapsed.of({ from, collapsed }) });
		view.dom.querySelector<HTMLElement>(`[data-mlp-table-from="${from}"] .mlp-table-collapse-btn`)?.focus();
	});
	if (!control) return () => {};
	buttons.appendChild(control.button);
	const refresh = () => { control.apply(view.state.field(tableCollapseState).has(position())); view.requestMeasure(); };
	refreshers.set(table, refresh); refresh();
	return cell => {
		if (!cell.closest('tr')?.hidden) return;
		view.dispatch({ effects: setTableCollapsed.of({ from: position(), collapsed: false }) });
	};
}
