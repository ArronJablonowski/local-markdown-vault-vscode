import { StateEffect, StateField } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { t } from '../shared/i18n';

const setWidths = StateEffect.define<{ from: number; widths: number[] }>();
/** View-only widths follow source offsets without inserting nonstandard Markdown. */
export const tableColumnWidths = StateField.define<Map<number, number[]>>({
	create: () => new Map(),
	update(value, transaction) {
		let next = value;
		if (transaction.docChanged) {
			next = new Map();
			for (const [from, widths] of value) {
				let deleted = false;
				transaction.changes.iterChangedRanges((start, end) => { if (start <= from && end > from) deleted = true; });
				if (!deleted) next.set(transaction.changes.mapPos(from, -1), widths);
			}
		}
		for (const effect of transaction.effects) if (effect.is(setWidths)) {
			if (next === value) next = new Map(value);
			if (effect.value.widths.length) next.set(effect.value.from, effect.value.widths);
			else next.delete(effect.value.from);
			if (next.size > 1024) next.delete(next.keys().next().value!);
		}
		return next;
	},
});

export function installTableColumnResize(view: EditorView, table: HTMLTableElement, from: number): () => void {
	const cells = () => Array.from(table.tHead?.rows[0]?.cells ?? []);
	const read = () => cells().map(cell => cell.getBoundingClientRect().width);
	const apply = (widths: number[]) => {
		if (widths.length !== cells().length) return;
		table.classList.add('mlp-table-resized');
		table.style.tableLayout = 'fixed';
		table.style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`;
		table.style.minWidth = '0';
		cells().forEach((cell, index) => {
			cell.style.boxSizing = 'border-box'; cell.style.width = `${widths[index]}px`;
			cell.querySelector('.mlp-column-resize')?.setAttribute('aria-valuenow', String(Math.round(widths[index])));
		});
		view.requestMeasure();
	};
	const remember = (widths: number[]) => {
		const current = table.closest<HTMLElement>('[data-mlp-table-from]');
		const position = Number(current?.dataset.mlpTableFrom ?? from);
		view.dispatch({ effects: setWidths.of({ from: position, widths }) });
	};
	const saved = view.state.field(tableColumnWidths, false)?.get(from);
	if (saved) apply(saved);
	return function refresh() {
		cells().forEach((cell, index) => {
			if (cell.querySelector('.mlp-column-resize')) return;
			const handle = document.createElement('span');
			handle.className = 'mlp-column-resize'; handle.tabIndex = 0;
			handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'vertical');
			handle.setAttribute('aria-label', t('table.resizeColumn', String(index + 1)));
			handle.setAttribute('aria-valuemin', '64'); handle.setAttribute('aria-valuemax', '2000');
			handle.setAttribute('aria-valuenow', String(Math.round(saved?.[index] ?? 64)));
			handle.title = t('table.resizeHint');
			handle.addEventListener('focus', () => handle.setAttribute('aria-valuenow', String(Math.round(cell.getBoundingClientRect().width))));
			let drag: { x: number; widths: number[] } | undefined;
			const resize = (widths: number[], width: number) => {
				const next = [...widths]; next[index] = Math.max(64, Math.min(2000, width));
				apply(next); remember(next);
			};
			handle.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });
			handle.addEventListener('pointerdown', event => {
				if (event.button !== 0) return;
				event.preventDefault(); event.stopPropagation();
				drag = { x: event.clientX, widths: read() }; handle.setPointerCapture(event.pointerId); handle.focus();
			});
			handle.addEventListener('pointermove', event => {
				if (drag) { event.stopPropagation(); resize(drag.widths, drag.widths[index] + event.clientX - drag.x); }
			});
			handle.addEventListener('pointerup', () => { drag = undefined; });
			handle.addEventListener('pointercancel', () => { drag = undefined; });
			handle.addEventListener('lostpointercapture', () => { drag = undefined; });
			handle.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
			handle.addEventListener('dblclick', event => {
				event.preventDefault(); event.stopPropagation(); remember([]);
				table.classList.remove('mlp-table-resized'); table.style.tableLayout = ''; table.style.width = ''; table.style.minWidth = '';
				cells().forEach(header => { header.style.width = ''; header.style.boxSizing = ''; }); view.requestMeasure();
			});
			handle.addEventListener('keydown', event => {
				if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
				event.preventDefault(); event.stopPropagation(); const widths = read();
				resize(widths, widths[index] + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 40 : 10));
			});
			cell.appendChild(handle);
		});
		view.requestMeasure({
			read,
			write: widths => cells().forEach((cell, index) => {
				const handle = cell.querySelector('.mlp-column-resize');
				const width = Math.round(widths[index]);
				if (!handle || !Number.isFinite(width) || width <= 0) return;
				handle.setAttribute('aria-valuenow', String(width));
				handle.setAttribute('aria-valuemin', String(Math.min(64, width)));
				handle.setAttribute('aria-valuemax', String(Math.max(2000, width)));
			}),
		});
	};
}
