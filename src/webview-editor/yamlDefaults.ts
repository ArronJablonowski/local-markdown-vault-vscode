import type { StateEffect } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { foldEffect, syntaxTree } from '@codemirror/language';
import { codePreviewEnd } from './codePreview';
import { detectFrontmatter } from './frontmatterWidget';
import { yamlCollapsedByDefault } from './yamlSettings';

export function isYamlLanguage(language: string): boolean { return /^(?:yaml|yml)$/i.test(language.trim()); }

/** Apply the opening default once; explicit expansion and active editing win. */
export const yamlCodeDefaults = ViewPlugin.fromClass(class {
	private readonly enabled = yamlCollapsedByDefault();
	private seen = new Set<number>();
	private pending = false;
	private destroyed = false;
	constructor(private readonly view: EditorView) { this.schedule(); }
	update(update: ViewUpdate) {
		if (update.docChanged) {
			const next = new Set<number>();
			for (const from of this.seen) {
				let deleted = false;
				update.changes.iterChangedRanges((start, end) => { if (start <= from && end > from) deleted = true; });
				const mapped = update.changes.mapPos(from, deleted ? -1 : 1);
				if (!deleted || update.startState.doc.lineAt(from).text === update.state.doc.lineAt(mapped).text) next.add(mapped);
			}
			this.seen = next;
		}
		if (update.docChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) this.schedule();
	}
	private schedule() {
		if (!this.enabled || this.pending) return;
		this.pending = true;
		queueMicrotask(() => {
			this.pending = false;
			if (this.destroyed || !this.view.dom.isConnected) return;
			const state = this.view.state, fm = detectFrontmatter(state);
			const effects: StateEffect<unknown>[] = [];
			let visited = 0;
			syntaxTree(state).iterate({ enter: node => {
				if (++visited > 200_000 || this.seen.size >= 10_000) return false;
				if (fm && node.from >= fm.from && node.to <= fm.to) return false;
				if (node.name !== 'FencedCode') return;
				const info = node.node.getChild('CodeInfo');
				if (!info || !isYamlLanguage(state.sliceDoc(info.from, info.to))) return false;
				const anchor = state.doc.lineAt(node.from).from;
				if (this.seen.has(anchor)) return false;
				this.seen.add(anchor);
				const first = state.doc.lineAt(node.from).number + 1;
				const last = state.doc.lineAt(Math.max(node.from, node.to - 1)).number - 1;
				if (node.node.getChildren('CodeMark').length < 2 || last - first + 1 <= 6) return false;
				const from = state.doc.line(first).from, to = state.doc.line(last).to;
				if (state.selection.ranges.some(range => range.from <= to && range.to >= from)) return false;
				effects.push(foldEffect.of({ from: codePreviewEnd(state, from, to), to }));
				return false;
			} });
			if (effects.length) this.view.dispatch({ effects });
		});
	}
	destroy() { this.destroyed = true; }
});
