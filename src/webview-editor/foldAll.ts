import { EditorSelection, type EditorState, type StateEffect } from '@codemirror/state';
import { foldEffect, foldedRanges, forceParsing, syntaxTree, syntaxTreeAvailable, unfoldEffect } from '@codemirror/language';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { calloutForNode, calloutState, toggleCallout } from './calloutState';
import { detectFrontmatter } from './frontmatterWidget';
import { isDiagramLang, isDiagramRenderingAllowed } from './diagramLang';
import { diagramFenceRange, diagramFenceText } from './diagramFence';
import { protectRenderedBlockFromCaret } from './cmUtils';
import { t } from '../shared/i18n';

export interface CollapsibleObject {
	kind: 'callout' | 'code';
	from: number;
	to: number;
	anchor: number;
	header?: number;
	defaultCollapsed?: boolean;
}

/** Match individual controls' ranges, including objects hidden by a parent callout. */
export function collectCollapsibleObjects(state: EditorState): CollapsibleObject[] {
	const objects: CollapsibleObject[] = [];
	const frontmatter = detectFrontmatter(state);
	let visited = 0;
	syntaxTree(state).iterate({ enter(node) {
		// Bound document-derived work without ever presenting a partial result as "all".
		if (++visited > 200_000 || objects.length > 10_000) throw new Error('Fold target limit');
		if (frontmatter && node.from >= frontmatter.from && node.to <= frontmatter.to) return false;
		if (node.name === 'Blockquote') {
			const callout = calloutForNode(state, node.node);
			if (callout) objects.push({ kind: 'callout', header: callout.from,
				from: state.doc.lineAt(callout.from).to + 1, to: callout.to, anchor: callout.from,
				defaultCollapsed: callout.collapsed });
		} else if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
			let first = state.doc.lineAt(node.from).number;
			let last = state.doc.lineAt(Math.max(node.from, node.to - 1)).number;
			if (node.name === 'FencedCode') {
				const info = node.node.getChild('CodeInfo');
				if (info && isDiagramLang(state.sliceDoc(info.from, info.to).trim().toLowerCase())
					&& diagramFenceRange(state, node.node) !== null && diagramFenceText(state, node.node).trim()) return false;
				first++;
				if (node.node.getChildren('CodeMark').length >= 2) last--;
			}
			if (last - first + 1 >= 8) objects.push({ kind: 'code',
				from: state.doc.line(first).to, to: state.doc.line(last).to, anchor: state.doc.line(first).from });
			return false;
		} else if (node.name === 'Paragraph' || node.name === 'Table' || /^(?:ATX|Setext)Heading/.test(node.name)) {
			return false; // Inline syntax cannot contain a callout or a code block.
		}
	} });
	if (objects.length > 10_000) throw new Error('Fold target limit');
	return objects;
}

/** Presentation-only folding: neither the +/- marker nor the document is rewritten. */
export class FoldAllControls {
	readonly button = document.createElement('button');
	private readonly status = document.createElement('span');
	private readonly iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	private cachedDoc?: EditorState['doc'];
	private cachedTree?: ReturnType<typeof syntaxTree>;
	private cachedDiagramPolicy?: boolean;
	private objects: CollapsibleObject[] = [];
	private tooComplex = false;
	private busy = false;
	private generation = 0;
	private frame = 0;

	constructor(private readonly view: EditorView, parent: HTMLElement, private readonly settleDraft: () => boolean) {
		this.button.type = 'button';
		this.button.className = 'mlp-fold-all-toggle';
		const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		icon.setAttribute('viewBox', '0 0 16 16');
		icon.setAttribute('width', '16');
		icon.setAttribute('height', '16');
		icon.setAttribute('aria-hidden', 'true');
		icon.setAttribute('focusable', 'false');
		icon.append(this.iconPath);
		this.button.append(icon);
		this.status.className = 'mlp-fold-all-status';
		this.status.setAttribute('role', 'status');
		this.status.setAttribute('aria-live', 'polite');
		// Commit while a widget still owns focus; blur can otherwise discard its draft.
		this.button.addEventListener('mousedown', event => event.preventDefault());
		this.button.addEventListener('click', () => { void this.toggle(); });
		parent.append(this.button, this.status);
		this.refresh();
	}

	update(update: ViewUpdate): void {
		if (update.docChanged || syntaxTree(update.startState) !== syntaxTree(update.state)
			|| foldedRanges(update.startState) !== foldedRanges(update.state)
			|| update.startState.field(calloutState, false) !== update.state.field(calloutState, false)
			|| this.cachedDiagramPolicy !== isDiagramRenderingAllowed()) this.scheduleRefresh();
	}

	reset(): void {
		this.generation++;
		this.cachedDoc = undefined;
		this.status.textContent = '';
		this.status.classList.remove('mlp-fold-all-warning');
		this.scheduleRefresh();
	}

	private scheduleRefresh(): void {
		if (this.frame) return;
		this.frame = requestAnimationFrame(() => { this.frame = 0; this.refresh(); });
	}

	private targets(): CollapsibleObject[] {
		const state = this.view.state;
		const tree = syntaxTree(state);
		const policy = isDiagramRenderingAllowed();
		if (state.doc !== this.cachedDoc || tree !== this.cachedTree || policy !== this.cachedDiagramPolicy) {
			this.cachedDoc = state.doc;
			this.cachedTree = tree;
			this.cachedDiagramPolicy = policy;
			this.tooComplex = false;
			try { this.objects = collectCollapsibleObjects(state); }
			catch { this.objects = []; this.tooComplex = true; }
		}
		return this.objects;
	}

	private collapseNext(objects: CollapsibleObject[]): boolean {
		const state = this.view.state;
		const codeFolds = new Set<string>();
		foldedRanges(state).between(0, state.doc.length, (from, to) => { codeFolds.add(`${from}:${to}`); });
		const overrides = state.field(calloutState, false);
		return objects.some(object => object.kind === 'callout'
			? !(overrides?.get(object.header!) ?? object.defaultCollapsed)
			: !codeFolds.has(`${object.from}:${object.to}`));
	}

	private refresh(): void {
		const objects = this.targets();
		const collapse = this.collapseNext(objects);
		const hasFolds = foldedRanges(this.view.state).size > 0;
		const showCollapse = collapse || (!objects.length && !hasFolds);
		const label = t(showCollapse ? 'foldAll.collapse' : 'foldAll.expand');
		this.button.title = this.tooComplex ? t('foldAll.limit') : label;
		this.button.setAttribute('aria-label', label);
		this.button.setAttribute('aria-busy', String(this.busy));
		this.button.disabled = this.busy || this.tooComplex || (!objects.length
			&& !hasFolds && syntaxTreeAvailable(this.view.state));
		this.iconPath.setAttribute('d', showCollapse
			? 'M3 2l5 4 5-4M3 14l5-4 5 4' : 'M3 6l5-4 5 4M3 10l5 4 5-4');
	}

	private async toggle(): Promise<void> {
		if (this.busy || !this.settleDraft()) return;
		this.busy = true;
		this.status.textContent = '';
		this.status.classList.remove('mlp-fold-all-warning');
		const generation = this.generation;
		const doc = this.view.state.doc;
		let interrupted = false;
		const interrupt = (event: Event) => {
			if (!this.button.contains(event.target as Node | null)) interrupted = true;
		};
		// A user may open Find or navigate away during a yielded parse slice.
		// Cancel that action instead of folding the new selection or stealing focus.
		document.addEventListener('pointerdown', interrupt, true);
		document.addEventListener('keydown', interrupt, true);
		document.addEventListener('focusin', interrupt, true);
		this.refresh();
		try {
			// Background parsing stops near the viewport. Finish in bounded, yielding
			// slices before collecting distant objects; never fold a partial document.
			for (let attempt = 0; !syntaxTreeAvailable(this.view.state, doc.length); attempt++) {
				if (attempt === 10) { this.warn(t('foldAll.parsing')); return; }
				forceParsing(this.view, doc.length, 20);
				await new Promise<void>(resolve => setTimeout(resolve, 0));
				if (interrupted || generation !== this.generation || this.view.state.doc !== doc || !this.view.dom.isConnected) return;
			}
			const objects = this.targets();
			if (this.tooComplex) { this.warn(t('foldAll.limit')); return; }
			const collapse = this.collapseNext(objects);
			const effects: StateEffect<unknown>[] = [];
			for (const object of objects) {
				if (object.kind === 'callout') effects.push(toggleCallout.of({ from: object.header!, collapsed: collapse }));
				else if (collapse) effects.push(foldEffect.of({ from: object.from, to: object.to }));
			}
			// Include mapped folds whose code was shortened since folding. Otherwise
			// a block below the eight-line threshold could remain hidden indefinitely.
			if (!collapse) foldedRanges(this.view.state).between(0, doc.length, (from, to) => {
				effects.push(unfoldEffect.of({ from, to }));
			});
			const selection = this.view.state.selection;
			const ranges = selection.ranges.map(range => {
				const hidden = collapse && objects.find(object => range.to >= object.from && range.from < object.to);
				return hidden ? EditorSelection.cursor(hidden.anchor) : range;
			});
			protectRenderedBlockFromCaret();
			this.view.dispatch({ effects, selection: EditorSelection.create(ranges, selection.mainIndex), userEvent: 'select.fold' });
			this.view.requestMeasure();
			this.status.textContent = t(collapse ? 'foldAll.collapsed' : 'foldAll.expanded');
		} finally {
			document.removeEventListener('pointerdown', interrupt, true);
			document.removeEventListener('keydown', interrupt, true);
			document.removeEventListener('focusin', interrupt, true);
			this.busy = false;
			this.refresh();
			if (!interrupted && generation === this.generation && this.view.state.doc === doc) this.button.focus({ preventScroll: true });
		}
	}

	private warn(message: string): void {
		this.status.textContent = message;
		this.status.classList.add('mlp-fold-all-warning');
	}
}
