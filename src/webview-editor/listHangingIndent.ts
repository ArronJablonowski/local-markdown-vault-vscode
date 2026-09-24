import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

interface AppliedIndent {
	padding: string;
	indent: string;
	appliedPadding: string;
	base: number;
}

/** Measure rendered prefixes, not source columns: bullets, tasks, and fonts differ. */
export const listHangingIndent = ViewPlugin.fromClass(class {
	private readonly applied = new Map<HTMLElement, AppliedIndent>();
	private readonly observer: MutationObserver;
	private readonly measure;
	private destroyed = false;

	constructor(private readonly view: EditorView) {
		this.measure = {
			key: this,
			read: () => this.read(),
			write: (rows: ReturnType<typeof this.read>) => {
				if (this.destroyed) return;
				let geometryChanged = false;
				const mounted = new Set(rows.map(row => row.line));
				for (const [line, previous] of this.applied) {
					if (!mounted.has(line)) {
						this.restore(line, previous); this.applied.delete(line);
						geometryChanged = true;
					}
				}
				for (const { line, base, width } of rows) {
					let previous = this.applied.get(line);
					if (!previous || line.style.paddingInlineStart !== previous.appliedPadding) {
						previous = { padding: line.style.paddingInlineStart, indent: line.style.textIndent, appliedPadding: '', base };
					}
					const padding = `${base + width}px`;
					const indent = `${-width}px`;
					if (line.style.paddingInlineStart !== padding) { line.style.paddingInlineStart = padding; geometryChanged = true; }
					if (line.style.textIndent !== indent) { line.style.textIndent = indent; geometryChanged = true; }
					previous.appliedPadding = line.style.paddingInlineStart;
					this.applied.set(line, previous);
				}
				// Prefix padding can change wrapping and therefore row heights. Let
				// CodeMirror update its viewport height map after our DOM write.
				if (geometryChanged) this.view.requestMeasure();
			},
		};
		this.observer = new MutationObserver(() => {
			// A new theme may change the underlying list padding. Remove only our
			// own overrides before remeasuring the theme's actual padding.
			for (const [line, previous] of this.applied) this.restore(line, previous);
			this.applied.clear();
			view.requestMeasure(this.measure);
		});
		this.observer.observe(document.head, { childList: true, subtree: true, characterData: true });
		this.observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
		view.requestMeasure(this.measure);
	}

	update(_update: ViewUpdate): void { this.view.requestMeasure(this.measure); }

	private read(): Array<{ line: HTMLElement; base: number; width: number }> {
		const rows: Array<{ line: HTMLElement; base: number; width: number }> = [];
		if (this.destroyed) return rows;
		// CodeMirror mounts only its viewport. Also cap work for unusually tall panes.
		for (const line of Array.from(this.view.contentDOM.querySelectorAll<HTMLElement>('.cm-line[data-mlp-list-text-offset]')).slice(0, 2000)) {
			const offset = Number(line.dataset.mlpListTextOffset);
			const start = this.view.posAtDOM(line, 0);
			if (!Number.isSafeInteger(offset) || offset < 0 || start + offset > this.view.state.doc.lineAt(start).to) continue;
			const coords = this.view.coordsAtPos(start + offset, 1);
			if (!coords) continue;
			const style = getComputedStyle(line);
			const rtl = style.direction === 'rtl';
			const previous = this.applied.get(line);
			const base = previous && line.style.paddingInlineStart === previous.appliedPadding
				? previous.base : parseFloat(rtl ? style.paddingRight : style.paddingLeft) || 0;
			const box = line.getBoundingClientRect();
			const border = parseFloat(rtl ? style.borderRightWidth : style.borderLeftWidth) || 0;
			const width = (rtl ? box.right - coords.right : coords.left - box.left) - border - base;
			if (!Number.isFinite(width) || width < 0 || width > box.width - 24) continue;
			rows.push({ line, base, width });
		}
		return rows;
	}

	private restore(line: HTMLElement, previous: AppliedIndent): void {
		if (line.style.paddingInlineStart === previous.appliedPadding) {
			line.style.paddingInlineStart = previous.padding;
			line.style.textIndent = previous.indent;
		}
	}

	destroy(): void {
		this.destroyed = true;
		this.observer.disconnect();
		for (const [line, previous] of this.applied) this.restore(line, previous);
		this.applied.clear();
	}
});
