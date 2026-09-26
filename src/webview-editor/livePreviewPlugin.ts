import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { notifyActiveDraftChanged, preserveUncommittedDraft, registerActiveDraft } from './activeDraft';
import { syntaxTree, foldEffect, unfoldEffect, foldedRanges } from '@codemirror/language';
import type { Range, EditorState, Transaction } from '@codemirror/state';
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common';
import { cursorTouchesRange, blockCursorTouchesRange, noteRevealed, protectRenderedBlockFromCaret } from './cmUtils';
import { isDiagramLang, isDiagramRenderingAllowed } from './diagramLang';
import { diagramFenceRange, diagramFenceText } from './diagramFence';
import { calloutForNode, calloutState, containingCallouts, toggleCallout } from './calloutState';
import { renderableMathRanges } from './math';
import { isDrawioPath } from './drawioFileClient';
import { refreshPreview } from './previewRefresh';
import { DrawioFileWidget } from './drawioWidget';
import { wrapBlockWidget } from './blockWidgetWrap';
import { detectFrontmatter } from './frontmatterWidget';
import { renderInlineInto, type CellInlineHooks } from './tableCellInline';
import { escapeTableCellSource } from './tableCellSource';
import { pasteSpreadsheetCells, MAX_SPREADSHEET_INPUT_BYTES } from './spreadsheetClipboard';
import { isolatedSpreadsheetPaste, readSpreadsheetClipboard, showSpreadsheetPasteWarning, spreadsheetReplacementFits } from './spreadsheetPaste';
import { onStickyTableHeadersChange, stickyTableHeadersEnabled } from './tableHeaderSettings';
import { createCodeModeButton, createCopyCodeButton } from './codeModeButton';
import {
	insertRow,
	insertColumn,
	deleteRow,
	deleteColumn,
	moveRow,
	moveColumn,
	sortRows,
	setColumnAlignment,
	renderTableMarkdown,
	type TableEditModel,
} from './tableEdit';
import { t } from '../shared/i18n';
import { calloutIcon, createCalloutOutlineIcon, parseCalloutHeader } from './callouts';
import type { RemoteMediaPolicy } from '../shared/messages';
import { resolveLocalImage } from './localImageClient';
import { referenceLinkTarget } from './referenceLinks';
import { markdownDestination } from '../shared/markdownDestination';
import { isAbsoluteWebUrl } from '../shared/linkTarget';
import {
	findInlineHighlightRanges,
	MAX_HIGHLIGHT_LINE_CHARACTERS,
	MAX_HIGHLIGHTS_PER_VIEWPORT,
} from './inlineHighlight';

const HEADING_LINE_CLASS: Record<string, string> = {
	SetextHeading1: 'mlp-line-h1',
	SetextHeading2: 'mlp-line-h2',
	ATXHeading1: 'mlp-line-h1',
	ATXHeading2: 'mlp-line-h2',
	ATXHeading3: 'mlp-line-h3',
	ATXHeading4: 'mlp-line-h4',
	ATXHeading5: 'mlp-line-h5',
	ATXHeading6: 'mlp-line-h6',
};

export function isLineAligned(state: EditorState, from: number, to: number): boolean {
	return from === state.doc.lineAt(from).from && to === state.doc.lineAt(to).to;
}

// A block-level decoration (rich table widget) requires `to` to land exactly
// at the end of its line, but `from` doesn't strictly have to be a line
// start — it may sit after indentation or quote markers in a list/callout.
// Widening `from` back to the start of its own line is safe when only these
// container prefixes precede it. The table model retains them when rewriting.
// This satisfies CodeMirror's line-alignment requirement for block decorations
// without swallowing unrelated content sharing that line (e.g. a list
// marker, which always lives on a different line from an indented table).
export function alignedBlockRange(state: EditorState, from: number, to: number): { from: number; to: number } | null {
	const toLine = state.doc.lineAt(to);
	if (to !== toLine.to) return null;
	const fromLine = state.doc.lineAt(from);
	if (fromLine.from === from) return { from, to };
	return /^[ \t>]*$/.test(state.sliceDoc(fromLine.from, from)) ? { from: fromLine.from, to } : null;
}

/**
 * End offset of the empty line directly after `blockTo`, or `null` when there
 * is none (end of document, or the next line has content). Lets a paragraph
 * claim the blank line that separates it from whatever follows — see the
 * `Paragraph` case in `buildDecorations` for why.
 */
export function blankLineAfter(state: EditorState, blockTo: number): number | null {
	const lastLine = state.doc.lineAt(blockTo);
	if (lastLine.number >= state.doc.lines) return null;
	const next = state.doc.line(lastLine.number + 1);
	return next.text === '' || next.text === '\r' ? next.to : null;
}

// Local paths are never converted into webview-resource URLs here. They cross
// the validated message boundary and the extension host returns a URL only
// after lexical and canonical (symlink-resolved) vault containment checks.
let remoteMediaPolicy: RemoteMediaPolicy = 'block';

export function setRemoteMediaPolicy(policy: RemoteMediaPolicy): void {
	remoteMediaPolicy = policy;
}

const ABSOLUTE_SRC_RE = /^([a-z][a-z0-9+.-]*:)/i;

export function resolveImageSrc(
	src: string,
	remoteMedia: RemoteMediaPolicy = 'block',
): string | undefined {
	const trimmed = src.trim();
	if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('\\\\')) return undefined;
	const scheme = ABSOLUTE_SRC_RE.exec(trimmed)?.[1].toLowerCase();
	if (scheme) {
		return scheme === 'https:' && remoteMedia === 'https' && isAbsoluteWebUrl(trimmed, 'https:')
			? trimmed
			: undefined;
	}
	return undefined;
}

/** Applies the active remote-media policy. Local files always cross the host boundary. */
export function resolveImageSrcForCurrentPolicy(src: string): string | undefined {
	return resolveImageSrc(src, remoteMediaPolicy);
}

function isPotentialLocalImage(src: string): boolean {
	const trimmed = src.trim();
	return !!trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('\\\\') && !ABSOLUTE_SRC_RE.test(trimmed);
}

function requestLocalImage(src: string): Promise<string | undefined> {
	return isPotentialLocalImage(src) ? resolveLocalImage(src) : Promise.resolve(undefined);
}

// Cells render their own images, so they use the same remote-media policy and
// host-authorized local-image request path as the document's ImageWidget.
const cellInlineHooks: CellInlineHooks = {
	resolveImageSrc: (src) => resolveImageSrc(src, remoteMediaPolicy),
	resolveImageSrcAsync: requestLocalImage,
};

const tableWidgetCleanup = new WeakMap<HTMLElement, () => void>();

class ImageWidget extends WidgetType {
	constructor(
		private readonly src: string,
		private readonly alt: string,
	) {
		super();
	}
	eq(other: ImageWidget): boolean {
		return other.src === this.src && other.alt === this.alt;
	}
	toDOM(view: EditorView): HTMLElement {
		const img = document.createElement('img');
		img.className = 'mlp-image';
		const resolved = resolveImageSrc(this.src, remoteMediaPolicy);
		if (resolved) img.src = resolved;
		else {
			img.classList.add('mlp-image-blocked');
			if (isPotentialLocalImage(this.src)) {
				void resolveLocalImage(this.src).then((uri) => {
					img.src = uri;
					img.classList.remove('mlp-image-blocked');
					view.requestMeasure();
				}).catch(() => undefined);
			}
		}
		img.alt = this.alt;
		// An <img> is zero-height until its bytes arrive, so the line CodeMirror
		// measures at mount time is nothing like the line the user ends up seeing.
		// CodeMirror can't observe the load, so ask it to re-measure once the real
		// dimensions are in (and on failure, when the broken-image box settles).
		const remeasure = () => view.requestMeasure();
		img.addEventListener('load', remeasure);
		img.addEventListener('error', remeasure);
		return img;
	}
	/**
	 * Let clicks through, so the image can be edited.
	 *
	 * `WidgetType.ignoreEvent` defaults to ignoring *everything*, which meant a
	 * click on a rendered image never placed a caret: the line kept no cursor, so
	 * `cursorTouchesRange` stayed false and the `![alt](url)` behind it could not
	 * be reached by mouse at all. Passing the event on lets CodeMirror put the
	 * caret at the clicked edge of the widget, which reveals the source the same
	 * way clicking any other inline construct does.
	 */
	ignoreEvent(): boolean {
		return false;
	}
}

class MarkdownLinkWidget extends WidgetType {
	constructor(
		private readonly label: string,
		private readonly href: string,
	) { super(); }
	eq(other: MarkdownLinkWidget): boolean {
		return other.label === this.label && other.href === this.href;
	}
	toDOM(): HTMLElement {
		const link = document.createElement('a');
		link.className = 'mlp-link';
		link.dataset.href = this.href;
		link.setAttribute('role', 'link');
		link.setAttribute('tabindex', '0');
		renderInlineInto(link, this.label, { resolveImageSrc: () => undefined });
		if (!link.textContent) link.setAttribute('aria-label', this.href);
		return link;
	}
	ignoreEvent(): boolean { return false; }
}

// CodeMirror calibrates its "typical line height" estimate (used to figure out
// how far to move for one line on ArrowUp/ArrowDown, among other things) by
// measuring the first short, plain-text line it finds whose only DOM content is
// a single text node — see `measureTextSize` in @codemirror/view. A hidden
// marker built via a bare `Decoration.replace({})` leaves the rest of the line
// as exactly that: one plain text node. For a heading line (much taller than
// body text via font-size/padding/margin/border) that makes it eligible as the
// sample, poisoning the estimate for the whole document and causing
// ArrowUp/ArrowDown to overshoot by a line at a time once it walks past one.
// Backing every hidden marker with this zero-size widget instead gives the
// line an extra, non-text DOM child, which disqualifies it from that scan.
class HiddenMarkerWidget extends WidgetType {
	eq(): boolean {
		return true;
	}
	toDOM(): HTMLElement {
		return document.createElement('span');
	}
	get estimatedHeight(): number {
		return 0;
	}
}
const hiddenMarker = new HiddenMarkerWidget();
const hiddenMarkerDeco = Decoration.replace({ widget: hiddenMarker });

const BULLET_GLYPHS = ['•', '◦', '▪'] as const;

export function bulletListDepth(node: SyntaxNode): number {
	let depth = 0;
	for (let ancestor: SyntaxNode | null = node; ancestor; ancestor = ancestor.parent) {
		if (ancestor.name === 'BulletList') depth++;
	}
	return Math.max(1, depth);
}

class BulletWidget extends WidgetType {
	private readonly variant: number;

	constructor(depth: number) {
		super();
		this.variant = ((Math.max(1, depth) - 1) % BULLET_GLYPHS.length) + 1;
	}

	eq(other: BulletWidget): boolean {
		return other.variant === this.variant;
	}
	toDOM(): HTMLElement {
		const span = document.createElement('span');
		span.className = `mlp-bullet mlp-bullet-${this.variant}`;
		span.textContent = BULLET_GLYPHS[this.variant - 1];
		return span;
	}
}

class CheckboxWidget extends WidgetType {
	constructor(
		private readonly checked: boolean,
		private readonly markerFrom: number,
	) {
		super();
	}
	eq(other: CheckboxWidget): boolean {
		return other.checked === this.checked && other.markerFrom === this.markerFrom;
	}
	toDOM(view: EditorView): HTMLElement {
		const box = document.createElement('span');
		box.className = 'mlp-checkbox' + (this.checked ? ' mlp-checkbox-checked' : '');
		box.setAttribute('role', 'checkbox');
		box.setAttribute('aria-checked', String(this.checked));
		box.setAttribute('aria-label', t(this.checked ? 'task.markIncomplete' : 'task.markComplete'));
		box.tabIndex = 0;
		const toggle = () => {
			// The marker is "[ ]" / "[x]"; the state character sits at markerFrom + 1.
			const stateChar = view.state.sliceDoc(this.markerFrom + 1, this.markerFrom + 2);
			const insert = stateChar === ' ' ? 'x' : ' ';
			view.dispatch({ changes: { from: this.markerFrom + 1, to: this.markerFrom + 2, insert } });
		};
		box.addEventListener('pointerdown', (event) => event.preventDefault());
		box.addEventListener('click', (event) => {
			event.preventDefault();
			toggle();
		});
		box.addEventListener('keydown', (event) => {
			if (event.key !== ' ' && event.key !== 'Enter') return;
			event.preventDefault();
			event.stopPropagation();
			toggle();
		});
		return box;
	}
	ignoreEvent(): boolean {
		return false;
	}
}

class CalloutHeaderWidget extends WidgetType {
	constructor(
		private readonly type: string,
		private readonly title: string,
		private readonly initiallyCollapsed: boolean,
		private readonly from: number,
	) { super(); }
	eq(other: CalloutHeaderWidget): boolean {
		return this.type === other.type && this.title === other.title && this.initiallyCollapsed === other.initiallyCollapsed && this.from === other.from;
	}
	toDOM(view: EditorView): HTMLElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'mlp-callout-header';
		button.dataset.calloutFrom = String(this.from);
		button.setAttribute('aria-expanded', String(!this.initiallyCollapsed));
		button.setAttribute('aria-label', t('callout.label', this.title));
		const icon = document.createElement('span');
		icon.className = 'mlp-callout-icon';
		icon.setAttribute('aria-hidden', 'true');
		const outline = createCalloutOutlineIcon(this.type);
		if (outline) icon.append(outline);
		else icon.textContent = calloutIcon(this.type);
		const label = document.createElement('span');
		label.className = 'mlp-callout-title';
		label.textContent = this.title;
		const chevron = document.createElement('span');
		chevron.className = 'mlp-callout-chevron';
		chevron.textContent = this.initiallyCollapsed ? '›' : '⌄';
		button.append(icon, label, chevron);
		const toggle = () => {
			// Folding is a widget action, not a request to edit the callout source.
			// Removing a focused nested table commits its draft on blur and parks
			// CodeMirror's caret inside this callout. Keep the header rendered while
			// that commit runs so its unfold button does not disappear into markup.
			protectRenderedBlockFromCaret();
			const focused = document.activeElement === button;
			view.dispatch({ effects: toggleCallout.of({ from: this.from, collapsed: !this.initiallyCollapsed }) });
			view.requestMeasure();
			if (focused) view.dom.querySelector<HTMLElement>(`[data-callout-from="${this.from}"]`)?.focus();
		};
		button.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			toggle();
		});
		button.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			event.stopPropagation();
			toggle();
		});
		return button;
	}
	ignoreEvent(): boolean { return true; }
}

/**
 * Floats a copy button over a fenced code block's top-right corner.
 *
 * Attached as a zero-width widget at the start of the block's first content
 * line, so it rides along with that line — no separate positioning root is
 * needed, and unlike the rendered blocks a code block is plain editor lines
 * that cannot host one anyway. `estimatedHeight: 0` keeps it out of
 * CodeMirror's height accounting, since it takes no space in the flow.
 */
class CopyCodeWidget extends WidgetType {
	constructor(
		private readonly from: number,
		private readonly to: number,
		private readonly revealPos: number,
		private readonly lineCount: number,
		private readonly collapsed: boolean,
		private readonly language: string,
	) {
		super();
	}
	eq(other: CopyCodeWidget): boolean {
		return other.from === this.from && other.to === this.to && other.revealPos === this.revealPos && other.lineCount === this.lineCount && other.collapsed === this.collapsed && other.language === this.language;
	}
	toDOM(view: EditorView): HTMLElement {
		const host = document.createElement('span');
		host.className = 'mlp-copy-code-host';
		host.dataset.codeFrom = String(this.from);
		if (this.language) {
			const label = document.createElement('span');
			label.className = 'mlp-code-language';
			label.textContent = this.language;
			label.title = this.language;
			host.appendChild(label);
		}
		const collapsed = this.collapsed;
		const setCollapsed = (next: boolean) => {
			const firstLine = view.state.doc.lineAt(this.from);
			const range = { from: firstLine.to, to: this.to };
			// Folding belongs to editor state, not transient viewport DOM. Keep the
			// first code line and controls visible; never change the Markdown bytes.
			view.dispatch({
				effects: (next ? foldEffect : unfoldEffect).of(range),
				...(next && view.state.selection.ranges.some((selection) => selection.from < range.to && selection.to > range.from)
					? { selection: { anchor: firstLine.from } } : {}),
			});
		};
		// Code-mode first, so the button order matches every other block: the
		// `</>` control sits leftmost in the group.
		//
		// A code block already shows its text, so what this reveals is the part
		// that is hidden — the ``` fence lines, with the language tag on them.
		// Editing those is how the language is changed or the block is unwrapped,
		// and there is otherwise no way to reach them by mouse: clicking a content
		// line places the caret without bringing the fences back.
		host.appendChild(
			createCodeModeButton(view, {
				anchor: host,
				beforeShow: () => {
					if (collapsed) setCollapsed(false);
					return null;
				},
				// The opening ``` line, not the first line of code. Each fence hides
				// itself based on whether the caret is on *that* line (see the
				// `FencedCode` case in buildDecorations), so parking inside the body
				// leaves both fences blank and nothing appears to happen. Landing on
				// the opening fence puts the caret on the language tag, which is the
				// thing this button exists to let you edit.
				caretPos: () => Math.min(this.revealPos, view.state.doc.length),
			}),
		);
		if (this.lineCount >= 8) {
			const collapseButton = document.createElement('button');
			collapseButton.type = 'button';
			collapseButton.className = 'mlp-collapse-code-btn';
			const updateButton = () => {
				collapseButton.textContent = collapsed ? '›' : '⌄';
				collapseButton.setAttribute('aria-expanded', String(!collapsed));
				collapseButton.title = t(collapsed ? 'code.expand.title' : 'code.collapse.title', String(this.lineCount));
				collapseButton.setAttribute('aria-label', t(collapsed ? 'code.expand.aria' : 'code.collapse.aria'));
			};
			collapseButton.addEventListener('mousedown', (event) => {
				event.preventDefault();
				event.stopPropagation();
			});
			collapseButton.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				setCollapsed(!collapsed);
				view.dom.querySelector<HTMLButtonElement>(`[data-code-from="${this.from}"] .mlp-collapse-code-btn`)?.focus();
			});
			updateButton();
			host.appendChild(collapseButton);
		}
		// Read the text at click time: the block's content can change after the
		// widget is built, and the offsets are re-derived on every rebuild.
		host.appendChild(
			createCopyCodeButton(() => {
				let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(Math.min(this.revealPos, view.state.doc.length), -1);
				while (node && node.name !== 'FencedCode') node = node.parent;
				return node ? diagramFenceText(view.state, node)
					: view.state.sliceDoc(Math.min(this.from, view.state.doc.length), Math.min(this.to, view.state.doc.length));
			}),
		);
		return host;
	}
	get estimatedHeight(): number {
		return 0;
	}
	ignoreEvent(): boolean {
		return true;
	}
}

export type ColumnAlign = 'left' | 'center' | 'right' | null;

/**
 * Builds the `<table>` for a parsed table model. Split out of `TableWidget` so
 * the rendered markup can be asserted on directly, without an `EditorView`.
 *
 * Each cell carries its grid position and, when it maps to real source, that
 * range — as data attributes. `TableWidget` reads them back on edit to know
 * which span of the document a cell's new text replaces.
 */
export function renderTableElement(model: TableModel, hooks: CellInlineHooks): HTMLTableElement {
	const table = document.createElement('table');
	table.className = 'mlp-table';
	const thead = document.createElement('thead');
	const tbody = document.createElement('tbody');
	model.rows.forEach((cells, rowIndex) => {
		const tr = document.createElement('tr');
		cells.forEach((cellText, columnIndex) => {
			const cell = document.createElement(rowIndex < model.headerRowCount ? 'th' : 'td');
			if (rowIndex < model.headerRowCount) cell.setAttribute('scope', 'col');
			const align = model.align[columnIndex];
			if (align) cell.style.textAlign = align;
			cell.className = 'mlp-table-cell';
			cell.dataset.mlpRow = String(rowIndex);
			cell.dataset.mlpCol = String(columnIndex);
			const span = model.cellRanges[rowIndex]?.[columnIndex];
			if (span) {
				// A rendered cell is an editing control, not just static table text.
				// Keep it in the natural tab order so keyboard users can select the
				// row/column for toolbar actions and press Enter or F2 to edit it.
				cell.setAttribute('tabindex', '0');
				cell.dataset.mlpFrom = String(span.from);
				cell.dataset.mlpTo = String(span.to);
				// The Markdown source, kept verbatim: editing shows this rather than
				// the rendered text, so `**bold**` stays editable as `**bold**`
				// instead of collapsing to `bold` and losing its markup on save.
				cell.dataset.mlpSrc = span.text;
			}
			renderInlineInto(cell, cellText, { ...hooks, inTableCell: true });
			tr.appendChild(cell);
		});
		(rowIndex < model.headerRowCount ? thead : tbody).appendChild(tr);
	});
	table.appendChild(thead);
	table.appendChild(tbody);
	return table;
}

/** The `data-mlp-*` bookkeeping `renderTableElement` puts on a cell. */
interface CellRef {
	row: number;
	col: number;
	from: number;
	to: number;
	source: string;
}

function readCellRef(cell: HTMLElement): CellRef | null {
	const { mlpRow, mlpCol, mlpFrom, mlpTo, mlpSrc } = cell.dataset;
	if (mlpRow === undefined || mlpCol === undefined || mlpFrom === undefined || mlpTo === undefined) return null;
	return {
		row: Number(mlpRow),
		col: Number(mlpCol),
		from: Number(mlpFrom),
		to: Number(mlpTo),
		source: mlpSrc ?? '',
	};
}

/**
 * A cell's edited text, normalised so writing it back cannot break the table.
 *
 * A newline would split the row into two lines and a raw `|` would invent a
 * column boundary, so both are neutralised: newlines collapse to spaces, and
 * pipes are backslash-escaped, which is how GFM spells a literal pipe inside a
 * cell.
 */
export function sanitizeCellInput(text: string): string {
	return escapeTableCellSource(text).trim();
}

/**
 * Rendered table with directly editable cells, in the style of Obsidian's
 * table editor.
 *
 * Clicking a cell puts the caret in that cell alone; the table stays rendered
 * rather than reverting to its pipe-delimited source, and only the edited cell
 * is written back (over the exact range `renderTableElement` recorded for it).
 * That keeps the rest of the row's text, padding and pipes byte-identical, so
 * an edit can neither reflow the source nor corrupt the table's structure.
 */
class TableWidget extends WidgetType {
	constructor(
		private readonly rows: string[][],
		private readonly headerRowCount: number,
		private readonly align: ColumnAlign[],
		private readonly cellRanges: (CellSpan | null)[][],
		private readonly tableFrom: number,
		private readonly tableTo: number,
		private readonly indent: string,
	) {
		super();
	}
	eq(other: TableWidget): boolean {
		return (
			JSON.stringify(other.rows) === JSON.stringify(this.rows) &&
			other.headerRowCount === this.headerRowCount &&
			JSON.stringify(other.align) === JSON.stringify(this.align) &&
			JSON.stringify(other.cellRanges) === JSON.stringify(this.cellRanges) &&
			other.tableFrom === this.tableFrom &&
			other.tableTo === this.tableTo &&
			other.indent === this.indent
		);
	}
	toDOM(view: EditorView): HTMLElement {
		const originalTableSource = view.state.sliceDoc(this.tableFrom, this.tableTo);
		const table = renderTableElement(
			{
				rows: this.rows,
				headerRowCount: this.headerRowCount,
				align: this.align,
				cellRanges: this.cellRanges,
				tableFrom: this.tableFrom,
				tableTo: this.tableTo,
				indent: this.indent,
			},
			cellInlineHooks,
		);
		// Positioning root for the code-mode button, which floats over the table's
		// top-right corner. The button can't hang off `.mlp-block` (the outer
		// spacing wrapper) because that box is what CodeMirror measures.
		const wrap = document.createElement('div');
		wrap.className = 'mlp-table-wrap';
		wrap.dataset.mlpTableFrom = String(this.tableFrom);
		// The button is a normal element *before* the table, not an overlay on top
		// of it: floated over the corner it was easy to miss, and it had to be kept
		// clear of the header cell's own text. In the flow it sits in its own strip
		// above the table, where it reads as a control belonging to the table, and
		// the height it occupies is part of the box CodeMirror measures.
		const toolbar = document.createElement('div');
		toolbar.className = 'mlp-table-toolbar';
		toolbar.setAttribute('role', 'toolbar');
		toolbar.setAttribute('aria-label', t('table.toolbar'));
		toolbar.hidden = true;
		const optionsButton = document.createElement('button');
		optionsButton.type = 'button';
		optionsButton.className = 'mlp-table-options-btn';
		optionsButton.textContent = t('table.options');
		optionsButton.setAttribute('aria-label', t('table.options'));
		optionsButton.setAttribute('aria-expanded', 'false');
		const setOptionsOpen = (open: boolean) => {
			toolbar.hidden = !open;
			optionsButton.setAttribute('aria-expanded', String(open));
			view.requestMeasure();
		};
		optionsButton.addEventListener('mousedown', (event) => {
			event.preventDefault();
			event.stopPropagation();
			protectRenderedBlockFromCaret();
		});
		optionsButton.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			protectRenderedBlockFromCaret();
			setOptionsOpen(toolbar.hidden);
			if (!editing) optionsButton.focus();
		});
		optionsButton.addEventListener('keydown', (event) => {
			event.stopPropagation();
			protectRenderedBlockFromCaret();
			if (event.key === 'Tab' && !event.shiftKey && !toolbar.hidden) {
				event.preventDefault();
				toolbar.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				setOptionsOpen(false);
			}
		});
		wrap.addEventListener('keydown', (event) => {
			if (toolbar.hidden) return;
			if (toolbar.contains(event.target as Node)) {
				event.stopPropagation();
				protectRenderedBlockFromCaret();
				if (event.key === 'Tab') {
					event.preventDefault();
					const buttons = Array.from(toolbar.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
					const next = buttons.indexOf(document.activeElement as HTMLButtonElement) + (event.shiftKey ? -1 : 1);
					if (next < 0) optionsButton.focus();
					else if (next >= buttons.length) table.querySelector<HTMLElement>('.mlp-table-cell')?.focus();
					else buttons[next].focus();
				}
			}
			if (toolbar.contains(event.target as Node) && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
				event.preventDefault();
				event.stopPropagation();
				protectRenderedBlockFromCaret();
				const buttons = Array.from(toolbar.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
				const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
				const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
					: (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
				buttons[next]?.focus();
			}
			if (event.key === 'Escape' && (toolbar.contains(event.target as Node) || event.target === optionsButton)) {
				event.preventDefault();
				event.stopPropagation();
				setOptionsOpen(false);
				optionsButton.focus();
			}
		});
		wrap.addEventListener('focusout', () => queueMicrotask(() => {
			if (!wrap.contains(document.activeElement)) setOptionsOpen(false);
		}));
		const hint = document.createElement('span');
		hint.className = 'mlp-table-options-hint';
		hint.textContent = t('table.optionsHint');
		toolbar.appendChild(hint);
		const tableButtons = document.createElement('div');
		tableButtons.className = 'mlp-table-buttons';
		tableButtons.appendChild(optionsButton);
		wrap.appendChild(tableButtons);
		wrap.appendChild(toolbar);
		const tableViewport = document.createElement('div');
		tableViewport.className = 'mlp-table-viewport';
		tableViewport.tabIndex = 0;
		tableViewport.setAttribute('role', 'region');
		tableViewport.setAttribute('aria-label', t('table.scrollRegion'));
		tableViewport.appendChild(table);
		wrap.appendChild(tableViewport);
		// Horizontal overflow creates a new scroll container, which prevents the
		// real <thead> from sticking to CodeMirror's vertical scroller. Mirror only
		// the header in a non-interactive, clipped overlay for wide tables.
		const stickyHeader = document.createElement('div');
		stickyHeader.className = 'mlp-table-sticky-header';
		stickyHeader.setAttribute('aria-hidden', 'true');
		stickyHeader.hidden = true;
		const stickyClip = document.createElement('div');
		stickyClip.className = 'mlp-table-sticky-clip';
		const stickyTable = document.createElement('table');
		stickyTable.className = 'mlp-sticky-table';
		stickyClip.appendChild(stickyTable);
		stickyHeader.appendChild(stickyClip);
		wrap.insertBefore(stickyHeader, tableViewport);
		const syncStickyHeader = (): void => {
			if (!stickyTableHeadersEnabled()) return;
			const header = table.tHead;
			if (!header) return;
			const originalCells = Array.from(header.rows[0]?.cells ?? []);
			const widths = originalCells.map(cell => cell.getBoundingClientRect().width);
			const tableWidth = table.getBoundingClientRect().width;
			if (!tableWidth || !widths.length || widths.some(width => width <= 0)) return;
			const clone = header.cloneNode(true) as HTMLTableSectionElement;
			clone.querySelectorAll<HTMLElement>('[tabindex], [contenteditable]').forEach((cell) => {
				cell.removeAttribute('tabindex');
				cell.removeAttribute('contenteditable');
			});
			clone.querySelectorAll<HTMLElement>('.mlp-table-cell').forEach((cell) => {
				cell.classList.remove('mlp-table-cell', 'mlp-table-cell-editing');
				for (const attribute of Array.from(cell.attributes)) {
					if (attribute.name.startsWith('data-mlp-')) cell.removeAttribute(attribute.name);
				}
			});
			// Pin column tracks, not content-box cell widths. Otherwise padding and
			// theme table-layout rules let the header compute a different grid.
			const columns = document.createElement('colgroup');
			for (const width of widths) {
				const column = document.createElement('col');
				column.style.setProperty('width', `${width}px`, 'important');
				columns.appendChild(column);
			}
			stickyTable.replaceChildren(columns, clone);
			stickyTable.style.setProperty('table-layout', 'fixed', 'important');
			stickyTable.style.setProperty('box-sizing', 'border-box', 'important');
			stickyTable.style.setProperty('width', `${tableWidth}px`, 'important');
			stickyTable.style.setProperty('min-width', '0', 'important');
			stickyTable.style.setProperty('max-width', 'none', 'important');
			const clonedCells = Array.from(clone.rows[0]?.cells ?? []);
			clonedCells.forEach(cell => {
				cell.style.setProperty('box-sizing', 'border-box', 'important');
				cell.style.setProperty('width', 'auto', 'important');
				cell.style.setProperty('min-width', '0', 'important');
			});
			stickyClip.scrollLeft = tableViewport.scrollLeft;
		};
		const updateStickyHeader = (): void => {
			if (!stickyTableHeadersEnabled()) {
				stickyHeader.hidden = true;
				if (stickyTable.firstChild) stickyTable.replaceChildren();
				return;
			}
			const scrollerTop = view.scrollDOM.getBoundingClientRect().top;
			const bounds = table.getBoundingClientRect();
			const headerHeight = table.tHead?.getBoundingClientRect().height ?? 0;
			const show = tableViewport.classList.contains('mlp-table-scrollable')
				&& bounds.top < scrollerTop && bounds.bottom > scrollerTop + headerHeight;
			if (stickyHeader.hidden === show) {
				stickyHeader.hidden = !show;
				// A hidden clip cannot accept scrollLeft. Refresh after making it
				// visible so its scroll range exists before restoring the offset.
				if (show) syncStickyHeader();
			}
			if (show) stickyClip.scrollLeft = tableViewport.scrollLeft;
		};
		// Keep native horizontal scrolling synchronized in either direction,
		// including trackpad/wheel gestures made directly over the pinned header.
		stickyClip.addEventListener('scroll', () => {
			if (!stickyHeader.hidden && tableViewport.scrollLeft !== stickyClip.scrollLeft) {
				tableViewport.scrollLeft = stickyClip.scrollLeft;
			}
		}, { passive: true });
		const widthObserver = new ResizeObserver(() => {
			const overflowing = table.scrollWidth > tableViewport.clientWidth + 1;
			if (tableViewport.classList.contains('mlp-table-scrollable') !== overflowing) {
				tableViewport.classList.toggle('mlp-table-scrollable', overflowing);
				view.requestMeasure();
			}
			if (overflowing) syncStickyHeader();
			updateStickyHeader();
		});
		widthObserver.observe(tableViewport);
		widthObserver.observe(table);
		const headerObserver = new MutationObserver(() => {
			if (tableViewport.classList.contains('mlp-table-scrollable')) syncStickyHeader();
		});
		if (table.tHead) headerObserver.observe(table.tHead, { childList: true, subtree: true, characterData: true });
		view.scrollDOM.addEventListener('scroll', updateStickyHeader, { passive: true });
		tableViewport.addEventListener('scroll', updateStickyHeader, { passive: true });
		const stopHeaderSettings = onStickyTableHeadersChange(updateStickyHeader);
		const preserveHorizontalScroll = (change: () => void): void => {
			const left = tableViewport.scrollLeft;
			change();
			const doc = view.state.doc;
			requestAnimationFrame(() => {
				if (view.state.doc !== doc) return;
				const replacement = view.dom.querySelector<HTMLElement>(
					`.mlp-table-wrap[data-mlp-table-from="${this.tableFrom}"] .mlp-table-viewport`,
				);
				if (replacement) {
					// The new widget's ResizeObserver may not have run yet. Establish
					// its scroll container before restoring the saved horizontal offset.
					replacement.classList.toggle('mlp-table-scrollable', replacement.scrollWidth > replacement.clientWidth + 1);
					replacement.scrollLeft = left;
				}
			});
		};

		// The cell currently being edited, if any. Editing is entered lazily on
		// click rather than by making every cell permanently `contenteditable`,
		// so a cell shows its *rendered* form until the user actually goes to
		// change it, and its raw Markdown only while being edited.
		let editing: HTMLElement | null = null;
		let tableBlockSelected = false;
		const setTableBlockSelected = (selected: boolean) => {
			tableBlockSelected = selected;
			wrap.classList.toggle('mlp-table-block-selected', selected);
			wrap.setAttribute('aria-selected', String(selected));
		};
		// The cell most recently clicked or tabbed to, remembered after editing
		// ends so the code-mode button can put the caret back where the user was.
		let lastCell: HTMLElement | null = null;
		let refreshTableActions = (): void => {};

		// Bound to the cell being edited, not to the table. A Tab that moves to the
		// next cell commits first, which rebuilds this widget — the table element
		// these listeners live on is replaced, so a handler on it never sees the
		// keys typed into the new cell, and Enter/Escape/Tab stopped working after
		// the first move. `beginEditing` attaches this to whichever cell is live.
		function onCellKeydown(event: KeyboardEvent): void {
			if (!editing) return;
			const ref = readCellRef(editing);
			if (!ref) return;
			if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {
				// A nested contenteditable is one cell, not the whole CodeMirror
				// document. Otherwise Mod+A bubbles into selectAll and the next
				// keystroke replaces the entire note instead of this cell's text.
				event.preventDefault();
				event.stopPropagation();
				const selection = window.getSelection?.();
				if (selection) {
					const range = document.createRange();
					range.selectNodeContents(editing);
					selection.removeAllRanges();
					selection.addRange(range);
				}
				return;
			}
			if (event.key === 'Tab') {
				event.preventDefault();
				const current = editing;
				if (!moveFocus(ref, event.shiftKey ? -1 : 1)) commit(current);
				return;
			}
			if (event.key === 'Enter') {
				// A newline cannot live inside a cell, so Enter means "done".
				event.preventDefault();
				commit(editing);
				if (editing) return;
				protectRenderedBlockFromCaret();
				view.focus();
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				// Restoring the original text makes `commit` see no change, so the
				// edit is discarded rather than written back.
				editing.textContent = ref.source;
				commit(editing);
				protectRenderedBlockFromCaret();
				view.focus();
			}
		}

		/**
		 * Writes a cell's edited text back to its own span of the document.
		 *
		 * Returns where that cell's text now ends, so a caller that wants to put
		 * the caret there doesn't have to re-derive it through the edit's own
		 * change in length. Null when nothing was written.
		 */
		const commit = (cell: HTMLElement): number | null => {
			// Write-back happens exactly once per cell. Committing re-renders the
			// table, and the DOM swap that follows fires `focusout` on the old
			// element — whose listener belongs to the *previous* widget instance and
			// so has its own `editing`, making an instance-level check useless. The
			// spent mark lives on the element itself, which is the thing both paths
			// share: without it the typed text was written twice ("oneXY" became
			// "oneXYXY") on Enter, on Tab, and on a structural edit.
			if (cell.dataset.mlpCommitted === '1') return null;
			const ref = readCellRef(cell);
			if (!ref) return null;
			const next = sanitizeCellInput(cell.textContent ?? '');
			let transaction: Transaction | undefined;
			if (next !== ref.source) {
				if (ref.to > view.state.doc.length || view.state.sliceDoc(ref.from, ref.to) !== ref.source) {
					preserveUncommittedDraft(`Uncommitted table cell:\n${cell.textContent ?? ''}`);
					return null;
				}
				const changes = { from: ref.from, to: ref.to, insert: next };
				const anchor = caretPastTable(view.state, ref.from, next.length - (ref.to - ref.from));
				transaction = view.state.update(anchor === null ? { changes } : { changes, selection: { anchor } });
				// A size/queue/lock filter can reject a transaction. Keep the draft
				// editable and recoverable instead of spending it before acceptance.
				if (!transaction.docChanged) {
					preserveUncommittedDraft(`Uncommitted table cell:\n${cell.textContent ?? ''}`);
					return null;
				}
			}
			cell.dataset.mlpCommitted = '1';
			cell.removeEventListener('keydown', onCellKeydown);
			cell.contentEditable = 'false';
			cell.classList.remove('mlp-table-cell-editing');
			if (editing === cell) editing = null;
			// Let the columns size to content again. Tabbing on to another cell
			// re-freezes before anything is re-rendered (`beginEditing` calls
			// `freezeColumnWidths` first), so the table never visibly relaxes
			// between two cells — only when editing genuinely stops.
			thawColumnWidths();
			if (next === ref.source) {
				// Unchanged: re-render in place. Skipping the dispatch avoids pushing
				// a no-op onto the undo history, but the DOM currently holds the raw
				// source text, so it still has to be restored.
				cell.textContent = '';
				renderInlineInto(cell, ref.source, { ...cellInlineHooks, inTableCell: true });
				notifyActiveDraftChanged();
				return ref.to;
			}
			preserveHorizontalScroll(() => view.dispatch(transaction!));
			// The replacement's own length is what the cell now ends at.
			return ref.from + next.length;
		};

		/**
		 * Pins the table's column widths to whatever they are right now.
		 *
		 * A table sizes its columns from their content, and a cell being edited
		 * swaps its rendered text for the Markdown source behind it — `t` becomes
		 * `**[t](https://example.com)**`. Left alone the column jumps to fit that,
		 * dragging every other column with it, so clicking a cell makes the whole
		 * table lurch. Measuring the columns first and writing those widths back as
		 * explicit `width` values, together with `table-layout: fixed` (which sizes
		 * columns from those values instead of from content), holds the layout
		 * still for as long as the edit lasts.
		 *
		 * Widths are read in one pass before any is written: setting a width
		 * changes the layout, so interleaving reads and writes would measure
		 * columns that had already been moved by the previous write.
		 */
		const freezeColumnWidths = (): void => {
			if (table.style.tableLayout === 'fixed') return; // already frozen
			const firstRow = (table as HTMLTableElement).rows?.[0];
			if (!firstRow) return;
			const cells = Array.from(firstRow.cells) as HTMLElement[];
			const widths = cells.map((c) => c.getBoundingClientRect().width);
			// A table that has not been laid out yet (zero-width) has nothing
			// meaningful to pin, and writing zeros would collapse it.
			if (!widths.every((w) => w > 0)) return;
			const tableWidth = table.getBoundingClientRect().width;
			// Keep column proportions and the current table width stable during
			// editing. A narrower editor is handled by the horizontal viewport.
			const total = widths.reduce((sum, w) => sum + w, 0);
			if (total <= 0) return;
			cells.forEach((c, i) => {
				// `getBoundingClientRect` measures the border box, but `width`
				// defaults to sizing the *content* box — without this the padding and
				// borders would be added on top of the measurement and every column
				// would come back wider than it was.
				c.style.boxSizing = 'border-box';
				c.style.width = (widths[i] / total) * 100 + '%';
			});
			table.style.boxSizing = 'border-box';
			table.style.width = `${tableWidth}px`;
			table.style.tableLayout = 'fixed';
		};

		/** Releases the pinned widths, letting the table size to content again. */
		const thawColumnWidths = (): void => {
			if (table.style.tableLayout !== 'fixed') return;
			table.style.tableLayout = '';
			table.style.boxSizing = '';
			table.style.width = '';
			const firstRow = (table as HTMLTableElement).rows?.[0];
			if (!firstRow) return;
			for (const cell of Array.from(firstRow.cells) as HTMLElement[]) {
				cell.style.width = '';
				cell.style.boxSizing = '';
			}
		};

		/** Swaps a cell to its raw Markdown and puts the caret in it. */
		const beginEditing = (cell: HTMLElement, caret: 'all' | 'end'): void => {
			// Widget contenteditable attributes bypass the parent editor's DOM
			// editability. Keep locked cells inert as well as rejecting transactions.
			if (!view.state.facet(EditorView.editable)) {
				protectRenderedBlockFromCaret();
				cell.focus();
				return;
			}
			if (editing === cell) return;
			if (editing) commit(editing);
			if (editing) return;
			const ref = readCellRef(cell);
			if (!ref) return; // padding cell invented by fitRow; no source to edit
			// Must run before the cell's text is swapped below, while the columns
			// still hold their rendered widths.
			freezeColumnWidths();
			// Park the document caret on this cell's own line. It is not used for
			// typing — the contenteditable cell below handles that — but it has to
			// go *somewhere*, and wherever it was left is a line whose inline markup
			// then shows its source: clicking a table cell would reveal the `#` on a
			// heading elsewhere in the document. The table's own line is safe,
			// because this widget is exempt from that reveal while a cell is being
			// edited (see `blockCursorTouchesRange`).
			if (ref.from <= view.state.doc.length) {
				protectRenderedBlockFromCaret();
				view.dispatch({ selection: { anchor: ref.from } });
			}
			editing = cell;
			lastCell = cell;
			refreshTableActions();
			// Clear the spent mark: this cell is being edited afresh, and its next
			// commit must go through even if an earlier one already did. Tabbing
			// back onto a cell edited a moment ago otherwise silently discarded the
			// new text.
			delete cell.dataset.mlpCommitted;
			cell.addEventListener('keydown', onCellKeydown);
			registerActiveDraft(cell, () => { if (editing === cell) commit(cell); },
				() => editing === cell ? `Uncommitted table cell:\n${cell.textContent ?? ''}` : undefined,
				() => {
					if (editing !== cell) return undefined;
					const current = readCellRef(cell);
					if (!current || current.to > view.state.doc.length || view.state.sliceDoc(current.from, current.to) !== current.source) return undefined;
					return view.state.sliceDoc(0, current.from) + sanitizeCellInput(cell.textContent ?? '') + view.state.sliceDoc(current.to);
				});
			cell.classList.add('mlp-table-cell-editing');
			cell.contentEditable = 'true';
			cell.textContent = ref.source;
			cell.focus();
			const selection = window.getSelection?.();
			if (!selection) return;
			const range = document.createRange();
			range.selectNodeContents(cell);
			if (caret === 'end') range.collapse(false);
			selection.removeAllRanges();
			selection.addRange(range);
		};

		const cellAt = (row: number, col: number): HTMLElement | null =>
			table.querySelector('[data-mlp-row="' + row + '"][data-mlp-col="' + col + '"]');

		/** Moves editing `delta` cells along in reading order. */
		const moveFocus = (ref: CellRef, delta: number): boolean => {
			const width = this.align.length || this.rows[0]?.length || 0;
			if (!width) return false;
			const index = ref.row * width + ref.col + delta;
			if (index < 0 || index >= this.rows.length * width) return false;
			const row = Math.floor(index / width);
			const col = index % width;
			if (!cellAt(row, col)) return false;

			// Saving the cell being left rewrites the document, and CodeMirror
			// answers that by rebuilding this widget — every cell element, including
			// the one Tab is moving to, is replaced. Holding a reference across the
			// commit therefore landed the edit on a node no longer in the document:
			// the caret went nowhere and whatever was typed next was lost. The
			// destination is identified by its grid position instead, and looked up
			// again afterwards, in the table that is on screen by then.
			if (editing) commit(editing);
			if (editing) return false;
			const finish = (): void => {
				// Scoped to *this* table's replacement, not the first one in the
				// document: a file with several tables would otherwise start editing
				// the wrong one. Match the source position and exclude the decorative
				// sticky-header copy from keyboard editing targets.
				const scope = view.dom.querySelector<HTMLElement>(`.mlp-table-wrap[data-mlp-table-from="${this.tableFrom}"]`);
				const live = scope?.querySelector<HTMLElement>(
					`.mlp-table .mlp-table-cell[data-mlp-row="${row}"][data-mlp-col="${col}"]`,
				);
				// Tab selects the whole cell it lands on, the way a spreadsheet does,
				// so typing straight away replaces the old value.
				if (live) beginEditing(live, 'all');
			};
			// The rebuild lands in a measure/update cycle, so the new element does not
			// exist yet; `requestAnimationFrame` runs after it has been mounted.
			if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish);
			else finish();
			return true;
		};


		const tableSourceButton = createCodeModeButton(view, {
				anchor: table,
				// Save any half-finished cell edit first; `commit` reports where that
				// cell's text ended up, which already accounts for the edit's own change
				// in length.
				beforeShow: () => (editing ? commit(editing) : null),
				// Otherwise open the source at the cell the user last touched, so it
				// lands where they were looking rather than at the table's start.
				caretPos: () => {
					const target = editing ?? lastCell;
					return (target ? readCellRef(target)?.to : undefined) ?? (view.posAtDOM(table) + this.indent.length);
				},
			});
		tableSourceButton.classList.add('mlp-table-action-btn');
		tableSourceButton.textContent = '</>';
		tableSourceButton.title = t('table.source');
		tableSourceButton.setAttribute('aria-label', t('table.source'));
		tableButtons.prepend(tableSourceButton);

		// Cell interaction is driven from `mousedown`, not `click`.
		//
		// The editor is editable, so CodeMirror installs its own `mousedown`
		// handler on the content DOM and sets the selection from it — before any
		// `click` fires. (`ignoreEvent` does not prevent this: it only stops
		// CodeMirror reading the event as an interaction with the *widget's*
		// document position.) So while a click handler was in charge, every press
		// on the table had already moved the caret into it by the time that handler
		// ran, and a caret on a table line makes `cursorTouchesRange` withhold this
		// widget — the table flipped to raw pipe text. It usually looked fine only
		// because `beginEditing` then re-rendered fast enough to hide it; whenever
		// the click handler bailed out early instead, the revert was what remained.
		// Taking the press itself, and stopping it there, removes the race rather
		// than trying to out-run it.
		//
		// What still has to be distinguished is a click from a drag-select, and that
		// is only knowable at release — so the press records its position and the
		// decision is made on `mouseup`.
		let pressedCell: HTMLElement | null = null;
		let pressX = 0;
		let pressY = 0;
		const DRAG_SLOP_PX = 4;

		table.addEventListener('mousedown', (event) => {
			setTableBlockSelected(false);
			pressedCell = null;
			// Ctrl/Cmd-click opens a link (createLinkClickHandler) and the secondary
			// button opens a context menu; neither is ours to take.
			if (event.ctrlKey || event.metaKey || event.button !== 0) return;
			const cell = cellFromPoint(event, table);
			if (!cell) return;
			pressedCell = cell;
			pressX = event.clientX;
			pressY = event.clientY;
			if (event.detail > 1) {
				// Second and later presses of a rapid sequence: the browser would
				// select a word or paragraph of the *rendered* text, which is about to
				// be replaced by the cell's raw Markdown anyway. Suppressing it keeps
				// repeated clicking from looking like a drag-select.
				event.preventDefault();
			}
			// Keep the press away from CodeMirror's own handler, which would otherwise
			// put the caret in the table and unrender it.
			event.stopPropagation();
		});

		table.addEventListener('mouseup', (event) => {
			const cell = pressedCell;
			pressedCell = null;
			if (!cell) return;
			event.stopPropagation();
			// Released far from where it went down: that was a drag, and the text it
			// selected is a copy gesture. Leave the selection alone.
			if (Math.hypot(event.clientX - pressX, event.clientY - pressY) > DRAG_SLOP_PX) {
				requestAnimationFrame(() => {
					const selection = window.getSelection?.();
					if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
					const range = selection.getRangeAt(0);
					const cells = Array.from(table.querySelectorAll('.mlp-table-cell'));
					const selectedCells = cells.filter((candidate) => {
						try { return range.intersectsNode(candidate); } catch { return false; }
					});
					setTableBlockSelected(cells.length > 0 && selectedCells.length === cells.length);
				});
				return;
			}
			// A single press that nonetheless left text selected is the tail of a
			// drag that ended near its start; also a copy gesture.
			if (event.detail <= 1 && hasTextSelectionWithin(table)) return;
			event.preventDefault();
			if (event.detail > 1) window.getSelection?.()?.removeAllRanges();
			beginEditing(cell, 'end');
		});

		// The click that follows a handled press has nothing left to do, but it must
		// not reach CodeMirror either.
		table.addEventListener('click', (event) => {
			if (event.ctrlKey || event.metaKey) return;
			if (cellFromPoint(event, table)) {
				event.preventDefault();
				event.stopPropagation();
			}
		});

		// Pointer interaction enters editing immediately. Keyboard focus first
		// selects a cell, enabling the same row/column toolbar actions without
		// changing source; Enter or F2 then enters its in-place editor. Arrow keys
		// move through the rendered grid and leave Tab/Shift+Tab available for the
		// surrounding toolbar and editor controls.
		table.addEventListener('focusin', (event) => {
			const target = event.target as HTMLElement | null;
			const cell = target?.closest('.mlp-table-cell') as HTMLElement | null;
			if (!cell || !table.contains(cell) || !readCellRef(cell)) return;
			// CodeMirror may park its document selection at this block's position
			// while focus is inside a widget. The global keydown capture listener
			// deliberately clears stale pointer protection before every keyboard
			// action, so restore it after Tab or an arrow key moves focus into a
			// table cell. Otherwise a later measure/update cycle can see that parked
			// caret and replace the focused table with raw pipe source mid-navigation.
			protectRenderedBlockFromCaret();
			lastCell = cell;
			refreshTableActions();
		});
		table.addEventListener('keydown', (event) => {
			if (!view.state.facet(EditorView.editable)) protectRenderedBlockFromCaret();
			if (editing || event.altKey || event.ctrlKey || event.metaKey) return;
			const target = event.target as HTMLElement | null;
			const cell = target?.closest('.mlp-table-cell') as HTMLElement | null;
			// Links and other focusable content inside a cell keep their own keys.
			if (!cell || target !== cell) return;
			const ref = readCellRef(cell);
			if (!ref) return;
			if (event.key === 'Enter' || event.key === 'F2') {
				event.preventDefault();
				event.stopPropagation();
				beginEditing(cell, 'all');
				return;
			}
			const delta = event.key === 'ArrowLeft' ? [0, -1]
				: event.key === 'ArrowRight' ? [0, 1]
					: event.key === 'ArrowUp' ? [-1, 0]
						: event.key === 'ArrowDown' ? [1, 0]
							: null;
			if (!delta) return;
			const next = cellAt(ref.row + delta[0], ref.col + delta[1]);
			if (!next || !readCellRef(next)) return;
			event.preventDefault();
			event.stopPropagation();
			next.focus();
		});


		// Clicking or tabbing away saves, mirroring a spreadsheet. Moving to
		// another cell is handled by `beginEditing` before this fires.
		table.addEventListener('focusout', (event) => {
			const cell = event.target as HTMLElement | null;
			if (!cell || cell !== editing) return;
			const next = (event as FocusEvent).relatedTarget as Node | null;
			if (next && cell.contains(next)) return;
			// A diagram/layout redraw can remove this focused DOM node during
			// EditorView.update. Dispatching synchronously from that blur reenters
			// CodeMirror and throws. The spent/source guards still ensure a deferred
			// save cannot duplicate an Enter/Tab commit or overwrite a stale range.
			queueMicrotask(() => { if (view.dom.isConnected) commit(cell); });
		});

		/**
		 * Reads this table back out of the document as it stands right now.
		 *
		 * Returns null when the range no longer holds a table — the document was
		 * edited out from under this widget, and rewriting through a stale range
		 * would overwrite unrelated text.
		 */
		const currentTableModel = (): { model: TableEditModel; from: number; to: number } | null => {
			const state = view.state;
			const pos = Math.min(this.tableFrom, state.doc.length);
			let found: SyntaxNode | null = null;
			syntaxTree(state).iterate({
				from: pos,
				to: Math.min(this.tableTo, state.doc.length),
				enter(node) {
					if (!found && node.name === 'Table') found = node.node;
				},
			});
			if (!found) return null;
			const table = found as SyntaxNode;
			const read = readTableModel(state, table);
			return {
				model: {
					rows: read.sourceRows ?? read.rows,
					headerRowCount: read.headerRowCount,
					align: read.align,
					indent: read.indent,
				},
				from: read.tableFrom,
				to: read.tableTo,
			};
		};

		// A widget opts out of CodeMirror DOM events, so spreadsheet paste must
		// be handled at the actual cell boundary, before native rich-text paste.
		table.addEventListener('paste', event => {
			const cell = event.target instanceof Element ? event.target.closest<HTMLElement>('.mlp-table-cell') : null;
			if (!cell || !table.contains(cell) || !event.clipboardData) return;
			event.preventDefault();
			event.stopPropagation();
			if (!view.state.facet(EditorView.editable)) return;
			if (!table.isConnected || view.state.sliceDoc(this.tableFrom, this.tableTo) !== originalTableSource) {
				showSpreadsheetPasteWarning('stale'); return;
			}
			const { result, hasText, text } = readSpreadsheetClipboard(event.clipboardData);
			if (!hasText) { showSpreadsheetPasteWarning('textOnly'); return; }
			if (result.kind === 'invalid') { showSpreadsheetPasteWarning(result.reason); return; }
			if (result.kind === 'text') {
				if (text.length > MAX_SPREADSHEET_INPUT_BYTES || new TextEncoder().encode(text).byteLength > MAX_SPREADSHEET_INPUT_BYTES) {
					showSpreadsheetPasteWarning('tooLarge'); return;
				}
				// Preserve ordinary one-cell paste, without ever importing clipboard
				// HTML or its images, links, scripts, styles, or event attributes.
				if (editing !== cell) beginEditing(cell, 'all');
				const selection = window.getSelection();
				if (editing !== cell || !selection?.rangeCount) return;
				const range = selection.getRangeAt(0);
				if (!cell.contains(range.commonAncestorContainer)) return;
				const ref = readCellRef(cell);
				if (!ref) return;
				const before = document.createRange(), after = document.createRange();
				before.selectNodeContents(cell); before.setEnd(range.startContainer, range.startOffset);
				after.selectNodeContents(cell); after.setStart(range.endContainer, range.endOffset);
				const candidate = sanitizeCellInput(before.toString() + text + after.toString());
				if (!spreadsheetReplacementFits(view.state, ref.from, ref.to, candidate)) {
					showSpreadsheetPasteWarning('tooLarge'); return;
				}
				range.deleteContents();
				const node = document.createTextNode(text);
				range.insertNode(node); range.setStartAfter(node); range.collapse(true);
				selection.removeAllRanges(); selection.addRange(range);
				showSpreadsheetPasteWarning();
				notifyActiveDraftChanged();
				commit(cell);
				return;
			}
			const row = Number(cell.dataset.mlpRow), col = Number(cell.dataset.mlpCol);
			let current = currentTableModel();
			if (!current) { showSpreadsheetPasteWarning('stale'); return; }
			try {
				// Preflight before committing a typed draft: a rejected paste must
				// not change either the note or the in-progress cell text.
				let preflight = current.model;
				const draft = editing && readCellRef(editing);
				if (draft && editing) {
					preflight = { ...preflight, rows: preflight.rows.map(cells => cells.slice()) };
					preflight.rows[draft.row][draft.col] = sanitizeCellInput(editing.textContent ?? '');
				}
				const proposed = renderTableMarkdown(pasteSpreadsheetCells(preflight, result.rows, row, col))
					+ (current.to === view.state.doc.length ? '\n\n' : '');
				if (!spreadsheetReplacementFits(view.state, current.from, current.to, proposed)) throw new RangeError();
				// Commit preceding typing as its own operation so Undo of the paste
				// restores the typed value. Re-read after that commit swaps the DOM.
				if (editing) commit(editing);
				if (editing) return;
				current = currentTableModel();
				if (!current) { showSpreadsheetPasteWarning('stale'); return; }
				const { from, to, model } = current;
				const insert = renderTableMarkdown(pasteSpreadsheetCells(model, result.rows, row, col))
					+ (to === view.state.doc.length ? '\n\n' : '');
				if (!spreadsheetReplacementFits(view.state, from, to, insert)) throw new RangeError();
				showSpreadsheetPasteWarning();
				protectRenderedBlockFromCaret();
				const anchor = Math.min(from + insert.length + 1, view.state.doc.length - (to - from) + insert.length);
				preserveHorizontalScroll(() => view.dispatch({ changes: { from, to, insert }, selection: { anchor },
					annotations: isolatedSpreadsheetPaste.of(true), userEvent: 'input.paste' }));
				view.focus();
			} catch {
				showSpreadsheetPasteWarning('tooLarge');
			}
		});

		const copySelectedTable = (event: ClipboardEvent): void => {
			if (!tableBlockSelected || !event.clipboardData) return;
			const current = currentTableModel();
			if (!current) return;
			event.clipboardData.setData('text/plain', view.state.sliceDoc(current.from, current.to));
			event.preventDefault();
		};
		const deleteSelectedTable = (event: KeyboardEvent): void => {
			if (!tableBlockSelected || (event.key !== 'Backspace' && event.key !== 'Delete')) return;
			if (event.altKey || event.ctrlKey || event.metaKey) return;
			const current = currentTableModel();
			if (!current) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			window.getSelection?.()?.removeAllRanges();
			setTableBlockSelected(false);
			view.dispatch({
				changes: { from: current.from, to: current.to, insert: '' },
				selection: { anchor: current.from },
				scrollIntoView: true,
				userEvent: 'delete.selection',
			});
			view.focus();
		};
		const cutSelectedTable = (event: ClipboardEvent): void => {
			if (!tableBlockSelected || !event.clipboardData) return;
			copySelectedTable(event);
			if (!event.defaultPrevented) return;
			event.stopImmediatePropagation();
			if (view.state.facet(EditorView.editable)) deleteSelectedTable(new KeyboardEvent('keydown', { key: 'Delete' }));
		};
		const clearTableSelectionOutside = (event: PointerEvent): void => {
			if (tableBlockSelected && !wrap.contains(event.target as Node | null)) setTableBlockSelected(false);
		};
		view.dom.addEventListener('copy', copySelectedTable, true);
		view.dom.addEventListener('cut', cutSelectedTable, true);
		view.dom.addEventListener('keydown', deleteSelectedTable, true);
		view.dom.addEventListener('pointerdown', clearTableSelectionOutside, true);
		tableWidgetCleanup.set(wrap, () => {
			stopHeaderSettings();
			widthObserver.disconnect();
			headerObserver.disconnect();
			view.scrollDOM.removeEventListener('scroll', updateStickyHeader);
			tableViewport.removeEventListener('scroll', updateStickyHeader);
			view.dom.removeEventListener('copy', copySelectedTable, true);
			view.dom.removeEventListener('cut', cutSelectedTable, true);
			view.dom.removeEventListener('keydown', deleteSelectedTable, true);
			view.dom.removeEventListener('pointerdown', clearTableSelectionOutside, true);
		});

		/**
		 * Rebuilds the whole table through `change` and replaces it in the
		 * document.
		 *
		 * Unlike a cell edit, which writes back one span, a structural change
		 * touches every line — a new column has to appear in the header, the
		 * delimiter row and every data row at once — so the table is re-rendered
		 * from its model and swapped in whole.
		 */
		const applyStructuralEdit = (change: (model: TableEditModel) => TableEditModel): void => {
			// Any half-finished cell edit is saved first, or it would be discarded by
			// the rewrite that follows. `commit` clears `editing` itself, so the
			// `focusout` this button's click also triggers finds nothing left to do
			// — without that, both paths committed and the typed text was written
			// twice ("oneXY" became "oneXYXY").
			if (editing) commit(editing);
			if (editing) return;
			// Re-read the table from the document rather than using this widget's own
			// fields. Those describe the document as it stood when the widget was
			// built, and the `commit` above may just have changed it — rebuilding
			// from the stale copy wrote the old cell text back over the new, leaving
			// the row mangled. Re-reading also makes a widget outlive an edit from
			// anywhere else (another tab, an undo) safely.
			const current = currentTableModel();
			if (!current) return;
			const { model, from, to } = current;
			const next = change(model);
			const insert = renderTableMarkdown(next);
			if (view.state.sliceDoc(from, to) === insert) return;
			const doc = view.state.doc;
			// The caret must not land inside the rebuilt table: a caret on a table
			// line withholds the widget, so the table would show as raw pipe text
			// straight after the row was added. `from + insert.length` is its very
			// end — still on the last table line — so the line *after* it is the
			// nearest safe spot, and the end of the document if there is none.
			const nextLength = doc.length - (to - from) + insert.length;
			const endOfTable = from + insert.length;
			const anchor = Math.min(endOfTable + 1, nextLength);
			preserveHorizontalScroll(() => view.dispatch({ changes: { from, to, insert }, selection: { anchor } }));
		};

		const makeAddButton = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'mlp-table-add-btn';
			button.textContent = label;
			button.title = title;
			button.setAttribute('aria-label', title);
			// The press must not reach the table underneath, or the cell below the
			// button starts editing before the click runs.
			button.addEventListener('mousedown', (event) => {
				event.preventDefault();
				event.stopPropagation();
			});
			button.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				onClick();
			});
			return button;
		};
		const selectTableButton = makeAddButton('▦', t('table.select'), () => {
			window.getSelection?.()?.removeAllRanges();
			setTableBlockSelected(true);
			selectTableButton.focus();
		});
		selectTableButton.className = 'mlp-table-action-btn';
		selectTableButton.textContent = t('table.select');
		toolbar.appendChild(selectTableButton);

		const tableActionButtons: HTMLButtonElement[] = [];
		const makeActionButton = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
			const button = makeAddButton(label, title, onClick);
			button.className = 'mlp-table-action-btn';
			button.textContent = title;
			button.disabled = true;
			tableActionButtons.push(button);
			toolbar.appendChild(button);
			return button;
		};
		const selectedRef = (): CellRef | null => readCellRef(editing ?? lastCell ?? document.createElement('span'));
		const applyToSelected = (change: (model: TableEditModel, ref: CellRef) => TableEditModel): void => {
			const ref = selectedRef();
			if (!ref) return;
			applyStructuralEdit((model) => change(model, ref));
		};

		const insertRowAboveButton = makeActionButton('+R↑', t('table.insertRowAbove'), () =>
			applyToSelected((model, ref) => insertRow(model, ref.row)),
		);
		const insertRowBelowButton = makeActionButton('+R↓', t('table.insertRowBelow'), () =>
			applyToSelected((model, ref) => insertRow(model, ref.row + 1)),
		);
		const deleteRowButton = makeActionButton('−R', t('table.deleteRow'), () =>
			applyToSelected((model, ref) => deleteRow(model, ref.row)),
		);
		const rowUpButton = makeActionButton('↑R', t('table.moveRowUp'), () =>
			applyToSelected((model, ref) => moveRow(model, ref.row, -1)),
		);
		const rowDownButton = makeActionButton('↓R', t('table.moveRowDown'), () =>
			applyToSelected((model, ref) => moveRow(model, ref.row, 1)),
		);
		const insertColumnLeftButton = makeActionButton('+C←', t('table.insertColumnLeft'), () =>
			applyToSelected((model, ref) => insertColumn(model, ref.col)),
		);
		const insertColumnRightButton = makeActionButton('+C→', t('table.insertColumnRight'), () =>
			applyToSelected((model, ref) => insertColumn(model, ref.col + 1)),
		);
		const deleteColumnButton = makeActionButton('−C', t('table.deleteColumn'), () =>
			applyToSelected((model, ref) => deleteColumn(model, ref.col)),
		);
		const columnLeftButton = makeActionButton('←C', t('table.moveColumnLeft'), () =>
			applyToSelected((model, ref) => moveColumn(model, ref.col, -1)),
		);
		const columnRightButton = makeActionButton('→C', t('table.moveColumnRight'), () =>
			applyToSelected((model, ref) => moveColumn(model, ref.col, 1)),
		);
		const sortAscendingButton = makeActionButton('A↑', t('table.sortAscending'), () =>
			applyToSelected((model, ref) => sortRows(model, ref.col, 'asc')),
		);
		const sortDescendingButton = makeActionButton('A↓', t('table.sortDescending'), () =>
			applyToSelected((model, ref) => sortRows(model, ref.col, 'desc')),
		);
		const alignmentButton = makeActionButton('≡', t('table.cycleAlignment'), () =>
			applyToSelected((model, ref) => {
				const order: ColumnAlign[] = [null, 'left', 'center', 'right'];
				const current = model.align[ref.col] ?? null;
				return setColumnAlignment(model, ref.col, order[(order.indexOf(current) + 1) % order.length]);
			}),
		);
		refreshTableActions = (): void => {
			const ref = selectedRef();
			hint.hidden = Boolean(ref);
			for (const button of tableActionButtons) button.disabled = !ref;
			if (!ref) return;
			const headerCount = Math.max(1, this.headerRowCount);
			const width = this.align.length || this.rows[0]?.length || 0;
			insertRowAboveButton.disabled = ref.row < headerCount;
			insertRowBelowButton.disabled = false;
			deleteRowButton.disabled = ref.row < headerCount;
			rowUpButton.disabled = ref.row <= headerCount;
			rowDownButton.disabled = ref.row < headerCount || ref.row >= this.rows.length - 1;
			deleteColumnButton.disabled = width <= 1;
			insertColumnLeftButton.disabled = false;
			insertColumnRightButton.disabled = false;
			columnLeftButton.disabled = ref.col <= 0;
			columnRightButton.disabled = ref.col >= width - 1;
			sortAscendingButton.disabled = this.rows.length - headerCount < 2;
			sortDescendingButton.disabled = this.rows.length - headerCount < 2;
			alignmentButton.disabled = false;
		};

		// The edge controls preserve the quick append gesture. The toolbar controls
		// above provide insertion relative to a selected row or column.
		const addRowBtn = makeAddButton('+', t('table.addRow'), () =>
			applyStructuralEdit((m) => insertRow(m, m.rows.length)),
		);
		addRowBtn.classList.add('mlp-table-add-row');
		const addColBtn = makeAddButton('+', t('table.addColumn'), () =>
			applyStructuralEdit((m) => insertColumn(m, m.align.length || m.rows[0]?.length || 0)),
		);
		addColBtn.classList.add('mlp-table-add-col');
		wrap.append(addRowBtn, addColBtn);

		return wrapBlockWidget(wrap);
	}
	ignoreEvent(): boolean {
		// Every event the rendered table handles itself — text selection, cell
		// clicks, and typing into a `contenteditable` cell — has to reach the DOM
		// rather than being read by CodeMirror as an interaction with the widget's
		// position in the document. Letting mousedown through in particular is what
		// allows a drag to select cell text for copying.
		return true;
	}
	destroy(dom: HTMLElement): void {
		const wrap = dom.matches('.mlp-table-wrap') ? dom : dom.querySelector<HTMLElement>('.mlp-table-wrap');
		if (!wrap) return;
		tableWidgetCleanup.get(wrap)?.();
		tableWidgetCleanup.delete(wrap);
	}
}

/**
 * A caret position just past the table containing `posInTable`, in the
 * *post-change* document (`lengthDelta` is how much the edit grew or shrank it).
 *
 * Returns null when the table runs to the end of the document and there is no
 * line after it to hold the caret; the caller then leaves the selection alone
 * rather than placing it somewhere that would unrender the table.
 */
export function caretPastTable(state: EditorState, posInTable: number, lengthDelta: number): number | null {
	const doc = state.doc;
	let line = doc.lineAt(Math.min(posInTable, doc.length));
	// Walk to the last line of the table. A table is a run of consecutive lines
	// that each contain a pipe; the first line without one ends it.
	while (line.number < doc.lines) {
		const next = doc.line(line.number + 1);
		if (!next.text.includes('|')) break;
		line = next;
	}
	if (line.number >= doc.lines) return null;
	return doc.line(line.number + 1).from + lengthDelta;
}

/**
 * The cell a click landed in, decided from the pointer's own coordinates.
 *
 * `event.target` is not reliable here. Under `border-collapse: collapse`
 * adjacent cells *share* one border, and a click on that shared line is
 * attributed to whichever cell the browser picks — often the one above. Clicking
 * the line just above a cell then began editing the cell above it instead, which
 * is exactly the row the user was trying to leave alone.
 *
 * Measuring the click against each cell's own box removes the ambiguity: a point
 * on the shared border belongs to the cell whose box contains it, and when both
 * do (the border's own thickness) the later one — the row being clicked into —
 * wins, since the scan keeps the last match.
 */
function cellFromPoint(event: MouseEvent, table: HTMLElement): HTMLElement | null {
	const direct = (event.target as HTMLElement | null)?.closest('.mlp-table-cell') as HTMLElement | null;
	const cells = Array.from(table.querySelectorAll('.mlp-table-cell')) as HTMLElement[];
	let found: HTMLElement | null = null;
	for (const cell of cells) {
		const box = cell.getBoundingClientRect();
		if (event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom) {
			found = cell;
		}
	}
	// Fall back to the event's own target when the point matched nothing (a click
	// on the table's outer edge), so behavior is never *worse* than before.
	const cell = found ?? direct;
	return cell && table.contains(cell) ? cell : null;
}

/**
 * Whether the user currently has text selected inside `root`.
 *
 * Used to tell a click apart from the end of a drag-select: after a real
 * selection the click event still fires, and treating it as a plain click would
 * replace the highlighted table with its Markdown source before the user could
 * copy it.
 */
function hasTextSelectionWithin(root: HTMLElement): boolean {
	const selection = typeof window !== 'undefined' ? window.getSelection?.() : null;
	if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
	const range = selection.getRangeAt(0);
	return root.contains(range.commonAncestorContainer);
}

// @lezer/markdown's table parser only emits a `TableCell` node for cells that
// contain non-whitespace content — an empty cell (e.g. the middle column of
// `| a | | c |`) produces no node at all. Reading cells via `getChildren`
// therefore silently drops empty cells and shifts every later column left.
// Splitting the row's raw text ourselves (mirroring the parser's own
// leading/trailing-pipe trimming) keeps empty cells in place.
/**
 * One cell as it sits in the document: its trimmed text, plus the exact source
 * range that text occupies.
 *
 * The range is what makes editing a rendered cell possible. Writing a new value
 * back as a change over just this span leaves every other cell's text, and the
 * row's pipes and padding, untouched, so an edit cannot corrupt the table's
 * structure or disturb columns the user did not touch.
 *
 * `from`/`to` bound the *trimmed* text, so the surrounding padding spaces
 * survive an edit and the source keeps whatever alignment the author had. An
 * empty cell has `from === to`, pointing at the insertion spot between its
 * pipes.
 */
export interface CellSpan {
	text: string;
	from: number;
	to: number;
}

/**
 * Splits a table row into its cells, keeping each cell's source range.
 *
 * Cell splitting has to be done by hand rather than through `getChildren`
 * because the parser emits no node for an empty cell (see the note above
 * `readCells`).
 */
export function readCellSpans(state: EditorState, rowNode: SyntaxNode): CellSpan[] {
	const text = state.sliceDoc(rowNode.from, rowNode.to);
	const segments: { raw: string; offset: number }[] = [];
	let cell = '';
	let cellStart = 0;
	let escaped = false;
	let index = 0;
	for (const ch of text) {
		if (ch === '|' && !escaped) {
			segments.push({ raw: cell, offset: cellStart });
			cell = '';
			index += ch.length;
			cellStart = index;
			escaped = false;
			continue;
		}
		cell += ch;
		escaped = !escaped && ch === '\\';
		index += ch.length;
	}
	segments.push({ raw: cell, offset: cellStart });
	// A leading/trailing pipe produces a bounding empty segment, not a column.
	if (segments.length > 1 && segments[0].raw.trim() === '') segments.shift();
	if (segments.length > 1 && segments[segments.length - 1].raw.trim() === '') segments.pop();
	return segments.map(({ raw, offset }) => {
		// Shift past the padding so the range bounds the trimmed text alone.
		const leading = raw.length - raw.trimStart().length;
		const trimmed = raw.trim();
		const from = rowNode.from + offset + leading;
		return { text: trimmed, from, to: from + trimmed.length };
	});
}

export function readCells(state: EditorState, rowNode: SyntaxNode): string[] {
	return readCellSpans(state, rowNode).map((cell) => cell.text);
}

/**
 * Per-column alignment from a table's delimiter row (`|:--|:-:|--:|`).
 *
 * The row sits directly under `Table` as the one multi-character
 * `TableDelimiter` child — the single "|" delimiters inside header/data rows
 * are nested under those rows instead, never under `Table` itself.
 */
export function readColumnAlign(state: EditorState, tableNode: SyntaxNode): ColumnAlign[] {
	for (const child of tableNode.getChildren('TableDelimiter')) {
		const text = state.sliceDoc(child.from, child.to);
		if (text.length <= 1) continue;
		return splitDelimiterCells(text).map((spec) => {
			const left = spec.startsWith(':');
			const right = spec.endsWith(':');
			if (left && right) return 'center';
			if (right) return 'right';
			if (left) return 'left';
			return null;
		});
	}
	return [];
}

/** Splits a delimiter row into its per-column specs (":--", ":-:", "--:", "-"). */
function splitDelimiterCells(text: string): string[] {
	const cells = text.split('|').map((c) => c.trim());
	if (cells.length > 1 && cells[0] === '') cells.shift();
	if (cells.length > 1 && cells[cells.length - 1] === '') cells.pop();
	return cells;
}

/**
 * Pads a short row with empty cells and drops a long row's overflow, so every
 * row has exactly `width` columns.
 *
 * GFM defines the delimiter row as fixing the table's column count: a data row
 * with fewer cells is filled out with empty ones, and any cell beyond that
 * count is discarded. Rendering rows at their own natural width instead
 * produced a ragged table wherever the source was not perfectly aligned —
 * visibly different from every other Markdown renderer.
 */
function fitRow<T>(cells: T[], width: number, pad: T = '' as T): T[] {
	if (cells.length === width) return cells;
	if (cells.length > width) return cells.slice(0, width);
	return cells.concat(new Array(width - cells.length).fill(pad));
}

export interface TableModel {
	rows: string[][];
	/** Untruncated authored cells, including GFM-hidden overflow, for rewrites. */
	sourceRows?: string[][];
	headerRowCount: number;
	align: ColumnAlign[];
	/**
	 * Source range of every cell in `rows`, same shape and indexing.
	 *
	 * Carried alongside the text so an edit made in the rendered table can be
	 * written back to the one span it belongs to. Padding cells invented by
	 * `fitRow` for a ragged row have no source of their own; they are recorded
	 * as `null` and are not directly editable.
	 */
	cellRanges: (CellSpan | null)[][];
	/**
	 * The table's whole range in the document, and the indentation its lines
	 * carry (two spaces for a table nested under a list item, say).
	 *
	 * Cell editing does not need these — it writes one span at a time — but a
	 * structural edit does: adding a row or a column changes every line, so the
	 * table is rebuilt and this range is what the result replaces.
	 */
	tableFrom: number;
	tableTo: number;
	indent: string;
}

/** The cell grid and column alignment a `Table` node renders as. */
export function readTableModel(state: EditorState, tableNode: SyntaxNode): TableModel {
	const align = readColumnAlign(state, tableNode);
	const spanRows: CellSpan[][] = [];
	let headerRowCount = 0;
	for (const child of tableNode.getChildren('TableHeader')) {
		spanRows.push(readCellSpans(state, child));
		headerRowCount = spanRows.length;
	}
	for (const child of tableNode.getChildren('TableRow')) {
		spanRows.push(readCellSpans(state, child));
	}
	// The delimiter row is authoritative for the column count; fall back to the
	// header's own width if it somehow yielded nothing.
	const width = align.length || (spanRows.length ? spanRows[0].length : 0);
	// Whatever precedes the table is indentation and/or quote markers — the
	// block decoration is only applied when that holds (see `alignedBlockRange`).
	const firstLine = state.doc.lineAt(tableNode.from);
	return {
		rows: spanRows.map((cells) => fitRow(cells.map((c) => c.text), width)),
		sourceRows: spanRows.map(cells => cells.map(cell => cell.text)),
		cellRanges: spanRows.map((cells) => fitRow<CellSpan | null>(cells, width, null)),
		headerRowCount,
		align,
		// Widened to the start of the line, the way `alignedBlockRange` widens the
		// decoration's own range. The parser's `from` sits *after* a nested table's
		// indentation, so replacing from there would leave the original indent in
		// front of the rebuilt first line while every other line carried the indent
		// this model reapplies — the first row ending up doubly indented.
		tableFrom: firstLine.from,
		tableTo: tableNode.to,
		indent: state.sliceDoc(firstLine.from, tableNode.from),
	};
}

export function buildTableWidget(state: EditorState, node: SyntaxNodeRef): TableWidget {
	const { rows, headerRowCount, align, cellRanges, tableFrom, tableTo, indent } = readTableModel(state, node.node);
	return new TableWidget(rows, headerRowCount, align, cellRanges, tableFrom, tableTo, indent);
}

/**
 * Line numbers inside `item` that `blockDecorationsField` will replace with a
 * block widget — a table written directly under the item's own text.
 *
 * Those lines must not also carry a line decoration. CodeMirror silently drops
 * a block-replacing decoration whose range overlaps one, so a table nested in a
 * list item stayed raw pipe-separated text while the identical table at the top
 * level rendered normally. The list item's own text line keeps its decoration;
 * only the lines the widget covers are ceded.
 *
 * The conditions mirror `buildBlockDecorations` in blockDecorations.ts: if the
 * two disagree, either the widget is dropped again (line decorated, block
 * replaced) or list styling is lost for nothing (line skipped, no widget).
 * Nested diagram widgets and collapsed callout bodies also own their lines.
 */
export function blockReplacedLines(state: EditorState, item: SyntaxNode): Set<number> {
	const lines = new Set<number>();
	const pending: SyntaxNode[] = [];
	for (let child = item.firstChild; child; child = child.nextSibling) pending.push(child);
	while (pending.length) {
		const child = pending.pop()!;
		const folded = calloutForNode(state, child);
		if (folded?.collapsed) {
			for (let n = state.doc.lineAt(child.from).number + 1; n <= state.doc.lineAt(child.to).number; n++) lines.add(n);
			continue;
		}
		for (let nested = child.firstChild; nested; nested = nested.nextSibling) pending.push(nested);
		if (containingCallouts(state, child).some(callout => callout.collapsed)) continue;
		if (blockCursorTouchesRange(state, child.from, child.to)) continue;
		let range: { from: number; to: number } | null = null;
		if (child.name === 'Table') range = alignedBlockRange(state, child.from, child.to);
		if (child.name === 'FencedCode') {
			const info = child.getChild('CodeInfo');
			if (info && isDiagramLang(state.sliceDoc(info.from, info.to).trim().toLowerCase()) && diagramFenceText(state, child).trim()) range = diagramFenceRange(state, child);
		}
		if (!range) continue;
		const first = state.doc.lineAt(range.from).number;
		const last = state.doc.lineAt(range.to).number;
		for (let n = first; n <= last; n++) lines.add(n);
	}
	return lines;
}

/** True when the list item owning this mark is a GFM task item ("- [ ] ..."). */
function listItemIsTask(state: EditorState, listMark: SyntaxNodeRef): boolean {
	const line = state.doc.lineAt(listMark.from);
	const after = state.sliceDoc(listMark.to, Math.min(line.to, listMark.to + 64));
	return /^\s*\[[^\]\r\n]\]/.test(after);
}

/**
 * Return the completion state of a task list item's first line, or `null` when
 * the item is not a task. Obsidian treats every non-space status character as
 * completed, including custom statuses such as `[?]` and `[-]`.
 */
function taskItemCompletion(state: EditorState, itemFrom: number): boolean | null {
	const line = state.doc.lineAt(itemFrom);
	const marker = /^\s*(?:[-+*]|\d+[.)])\s+\[([^\]\r\n])\]/.exec(
		state.sliceDoc(itemFrom, line.to),
	);
	if (!marker) return null;
	return marker[1] !== ' ';
}

function isInsideCode(node: SyntaxNode): boolean {
	for (let current: SyntaxNode | null = node; current; current = current.parent) {
		if (current.name === 'InlineCode' || current.name === 'FencedCode' || current.name === 'CodeBlock') return true;
	}
	return false;
}

function hasAncestor(node: SyntaxNode, name: string): boolean {
	for (let current: SyntaxNode | null = node; current; current = current.parent) {
		if (current.name === name) return true;
	}
	return false;
}

function buildDecorations(view: EditorView): DecorationSet {
	const { state } = view;
	const { doc } = state;
	const decorations: Range<Decoration>[] = [];
	const seenReplace = new Set<string>();
	const seenCodeControls = new Set<number>();
	const seenLine = new Map<number, string>();
	const mathBlockLines = new Set<number>();
	for (const range of renderableMathRanges(state)) if (range.display) {
		for (let n = doc.lineAt(range.from).number; n <= doc.lineAt(range.to).number; n++) mathBlockLines.add(doc.line(n).from);
	}
	const tree = syntaxTree(state);
	// blockDecorationsField renders the whole frontmatter block as its own
	// widget; skip it here too so this pass doesn't waste time computing
	// marks/line-classes for a range that block-level decoration will cover.
	// Only nodes *fully contained* in the block are skipped — fm.from is always
	// 0, so a naive "any overlap" test also matches the tree's own root node
	// (which spans the whole document) and would abort `tree.iterate` before it
	// ever descends into anything, silently dropping every decoration in the
	// entire document whenever frontmatter is present (see blockDecorations.ts).
	const fm = detectFrontmatter(state);

	const pushReplace = (from: number, to: number, deco: Decoration) => {
		const key = `${from}:${to}`;
		if (seenReplace.has(key)) return;
		seenReplace.add(key);
		decorations.push(deco.range(from, to));
	};

	// A line can only carry one line decoration, so merge class names per line and
	// emit them all at the end (each exactly once, at the line start).
	const addLineClass = (lineFrom: number, cls: string) => {
		if (mathBlockLines.has(lineFrom)) return;
		const existing = seenLine.get(lineFrom);
		// The innermost callout owns its hue, regardless of stylesheet order.
		const previous = cls.includes('mlp-line-callout')
			? existing?.split(' ').filter(name => !name.startsWith('mlp-callout-')).join(' ') : existing;
		seenLine.set(lineFrom, [...new Set(`${previous ?? ''} ${cls}`.trim().split(/\s+/))].join(' '));
	};
	// A callback returning '' marks a line as deliberately skipped — used where a
	// block widget will replace that line and a line decoration on it would make
	// CodeMirror drop the widget.
	const addLineRange = (from: number, to: number, cls: (lineNumber: number, first: boolean, last: boolean) => string) => {
		const firstLine = doc.lineAt(from).number;
		const lastLine = doc.lineAt(to).number;
		for (let n = firstLine; n <= lastLine; n++) {
			const value = cls(n, n === firstLine, n === lastLine);
			if (value) addLineClass(doc.line(n).from, value);
		}
	};

	// Obsidian highlight syntax is intentionally small and line-scoped. Scan
	// only mounted lines, reject code nodes, and retain the source delimiters
	// whenever the caret touches the construct (the same source-reveal behavior
	// used by emphasis and links).
	const highlighted = new Set<string>();
	let highlightBudget = MAX_HIGHLIGHTS_PER_VIEWPORT;
	for (const visible of view.visibleRanges) {
		const firstLine = doc.lineAt(visible.from).number;
		const lastLine = doc.lineAt(visible.to).number;
		for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber++) {
			const line = doc.line(lineNumber);
			const linePrefix = state.sliceDoc(line.from, Math.min(line.to, line.from + MAX_HIGHLIGHT_LINE_CHARACTERS));
			const customTask = /^(\s*[-+*]\s+)(\[[^ xX\]\r\n]\])/.exec(linePrefix.slice(0, 4_096));
			if (customTask) {
				const markerFrom = line.from + customTask[1].length;
				if (hasAncestor(tree.resolveInner(markerFrom, 1), 'ListItem') && !cursorTouchesRange(state, markerFrom, markerFrom + 3)) {
					pushReplace(markerFrom, markerFrom + 3, Decoration.replace({ widget: new CheckboxWidget(true, markerFrom) }));
				}
			}
			for (const match of findInlineHighlightRanges(linePrefix, highlightBudget)) {
				const from = line.from + match.from;
				const to = line.from + match.to;
				const key = `${from}:${to}`;
				if (highlighted.has(key) || isInsideCode(tree.resolveInner(from + 2, 1))) continue;
				highlighted.add(key);
				highlightBudget--;
				decorations.push(Decoration.mark({ tagName: 'mark', class: 'mlp-highlight' }).range(from + 2, to - 2));
				if (!cursorTouchesRange(state, from, to)) {
					pushReplace(from, from + 2, hiddenMarkerDeco);
					pushReplace(to - 2, to, hiddenMarkerDeco);
				}
			}
		}
	}

	const decoratedQuotes = new Set<number>();
	const calloutHeaders = new Map<number, { from: number; to: number }>();
	for (const { from: rangeFrom, to: rangeTo } of view.visibleRanges) {
		tree.iterate({
			from: rangeFrom,
			to: rangeTo,
			enter: (node) => {
				if (fm && node.from >= fm.from && node.to <= fm.to) return false;
				// A rendered callout header owns its inline syntax. Overlapping
				// link/marker replacements can steal its DOM during later edits.
				const header = calloutHeaders.get(doc.lineAt(node.from).from);
				if (header && node.from >= header.from && node.to <= header.to) return false;
				const name = node.name;

				if (name in HEADING_LINE_CLASS) {
					if (name.startsWith('SetextHeading')) {
						const underline = node.node.getChild('HeaderMark');
						const last = Math.min(doc.lineAt(rangeTo).number,
							underline ? doc.lineAt(underline.from).number - 1 : doc.lineAt(node.to).number);
						const first = Math.max(doc.lineAt(node.from).number, doc.lineAt(rangeFrom).number);
						for (let n = first; n <= last; n++) {
							const line = doc.line(n);
							addLineClass(line.from, HEADING_LINE_CLASS[name]);
							decorations.push(Decoration.widget({ widget: hiddenMarker, side: 1 }).range(line.to));
						}
						return; // Descend to hide/reveal the underline's HeaderMark.
					}
					addLineClass(doc.lineAt(node.from).from, HEADING_LINE_CLASS[name]);
					const next = node.node.nextSibling;
					if (next && (next.name === 'BulletList' || next.name === 'OrderedList')) {
						addLineClass(doc.lineAt(node.from).from, 'mlp-heading-before-list');
					}
					// Unconditionally plant a zero-size widget at the *end* of the heading
					// line, even while the cursor sits on it and the "#" marker is fully
					// visible. Otherwise, at the moment a heading line first mounts with
					// the cursor already on it (e.g. the very first line of the
					// document), its content is one plain, short, all-ASCII text node —
					// exactly what CodeMirror's height-oracle sampler looks for (see
					// HiddenMarkerWidget above) — and it gets poisoned before the user
					// ever moves the cursor away to trigger the HeaderMark-hiding path
					// below. Anchored at node.to (not node.from, where the HeaderMark's
					// own hidden-marker decoration starts) so the two never compete for
					// the same boundary position.
					decorations.push(Decoration.widget({ widget: hiddenMarker, side: 1 }).range(node.to));
					return; // descend so the HeaderMark ("#") gets hidden
				}

				switch (name) {
					case 'LinkReference': {
						const label = node.node.getChild('LinkLabel');
						if (!label || state.sliceDoc(label.from, label.from + 2) === '[^') return false;
						if (!cursorTouchesRange(state, node.from, node.to)) {
							const first = Math.max(doc.lineAt(node.from).number, doc.lineAt(rangeFrom).number);
							const last = Math.min(doc.lineAt(node.to).number, doc.lineAt(rangeTo).number);
							for (let n = first; n <= last; n++) {
								const line = doc.line(n);
								const from = Math.max(line.from, node.from), to = Math.min(line.to, node.to);
								if (from < to) pushReplace(from, to, hiddenMarkerDeco);
							}
						}
						return false;
					}
					case 'Escape':
						if (!cursorTouchesRange(state, node.from, node.to)) pushReplace(node.from, node.from + 1, hiddenMarkerDeco);
						return false;
					case 'HeaderMark': {
						if (!cursorTouchesRange(state, node.from, node.to)) {
							const next = state.sliceDoc(node.to, node.to + 1);
							const to = next === ' ' ? node.to + 1 : node.to;
							// A plain replace (no widget) here: the heading line already
							// carries its own unconditional widget above, so it's never at
							// risk of being mistaken for a plain text line either way.
							pushReplace(node.from, to, Decoration.replace({}));
						}
						return;
					}
					case 'QuoteMark':
					case 'CodeMark':
					case 'CodeInfo': {
						if (!cursorTouchesRange(state, node.from, node.to)) {
							// Also swallow the single space after the marker so hidden markers
							// don't leave a dangling indent.
							const next = state.sliceDoc(node.to, node.to + 1);
							const to = next === ' ' ? node.to + 1 : node.to;
							pushReplace(node.from, to, hiddenMarkerDeco);
						}
						return;
					}
					case 'EmphasisMark':
					case 'StrikethroughMark': {
						if (!cursorTouchesRange(state, node.from, node.to)) {
							pushReplace(node.from, node.to, hiddenMarkerDeco);
						}
						return;
					}
					case 'StrongEmphasis':
						decorations.push(Decoration.mark({ tagName: 'strong', class: 'mlp-strong' }).range(node.from, node.to));
						return;
					case 'Emphasis':
						decorations.push(Decoration.mark({ tagName: 'em', class: 'mlp-em' }).range(node.from, node.to));
						return;
					case 'Strikethrough':
						decorations.push(Decoration.mark({ tagName: 'del', class: 'mlp-strikethrough' }).range(node.from, node.to));
						return;
					case 'InlineCode':
						decorations.push(Decoration.mark({ tagName: 'code', class: 'mlp-inline-code' }).range(node.from, node.to));
						return;
					case 'Paragraph': {
						// A list item's or blockquote's text is *also* wrapped in a
						// Paragraph node in the syntax tree (CommonMark always has one
						// there, "tight" list rendering just means the HTML omits the
						// `<p>` tag). Skip the standalone-paragraph classes when that's
						// the case: `ListItem`/`Blockquote` already add their own line
						// classes for this same line above, and merging both sets of
						// classes stacked a *second*, unrelated block's top/bottom
						// padding onto the line — e.g. the paragraph rule's
						// margin-bottom opening a gap under a blockquote whose own rule
						// specifies no bottom padding at all.
						const parentName = node.node.parent?.name;
						if (parentName === 'ListItem' || parentName === 'Blockquote') return;
						// Hand the paragraph's trailing gap (a theme's `p { margin-bottom }`,
						// which cssAdapter maps onto `-last` as padding-bottom) to the blank
						// line that separates this paragraph from what follows, rather than
						// leaving it on the paragraph's own last line.
						//
						// Both put the gap in the same place on screen — the separator line
						// and the gap simply swap order, so every block below keeps its exact
						// position. What changes is where the caret lands: pressing Enter at
						// the end of a paragraph leaves the cursor on a line the parser does
						// not consider part of the paragraph yet, so with the gap still above
						// it the caret sat a whole gap below the text it follows, then snapped
						// up the moment the first character was typed and the parser extended
						// the paragraph onto that line. Claiming the line up front makes the
						// layout the user lands on already the one typing produces — nothing
						// left to snap, and no dependence on where the cursor happens to be.
						const paragraphTo = blankLineAfter(state, node.to) ?? node.to;
						addLineRange(node.from, paragraphTo, (_n, first, last) => {
							let cls = 'mlp-line-paragraph';
							if (first) cls += ' mlp-line-paragraph-first';
							if (last) cls += ' mlp-line-paragraph-last';
							return cls;
						});
						return;
					}
					case 'ListItem': {
						// `-first`/`-last` must reflect this item's position within the
						// *enclosing list* (BulletList/OrderedList), not just within its
						// own (usually single-line) range — `addLineRange`'s own
						// first/last only sees the lines *this* ListItem spans, so every
						// item in the list would otherwise come out as both first and
						// last. That mattered once themes convert a `ul, ol { margin-bottom: … }`
						// rule (meant to apply once, after the whole list) onto
						// `-last`: with every item marked "last", every item picked up
						// that trailing margin, spacing a tight list out like a loose one.
						const parent = node.node.parent;
						// Nested lists share their outer list's line boxes. Giving each
						// nested list its own block edges adds theme spacing mid-list.
						const nested = parent?.parent && hasAncestor(parent.parent, 'ListItem');
						const isFirstItem = !nested && (!parent || parent.firstChild?.from === node.from);
						const isLastItem = !nested && (!parent || parent.lastChild?.to === node.to);
						const taskComplete = taskItemCompletion(state, node.from);
						const taskLineNumber = doc.lineAt(node.from).number;
						const itemLine = doc.line(taskLineNumber);
						const indentation = state.sliceDoc(itemLine.from, node.from);
						if (/^[ \t]+$/.test(indentation)) {
							let columns = 0;
							for (const char of indentation) columns += char === '\t' ? state.tabSize - columns % state.tabSize : 1;
							// Proportional themes make two literal spaces narrower than a
							// bullet. Reserve actual character columns for visible nesting.
							decorations.push(Decoration.mark({ class: 'mlp-list-indent', attributes: { style: `width: ${columns}ch` } }).range(itemLine.from, node.from));
						}
						// Lines a nested table widget will replace get no line decoration,
						// or CodeMirror discards the widget and shows raw pipes instead.
						const replaced = blockReplacedLines(state, node.node);
						addLineRange(node.from, node.to, (n, first, last) => {
							if (replaced.has(n)) return '';
							let cls = 'mlp-line-list';
							if (taskComplete === true && n === taskLineNumber) cls += ' mlp-line-task-complete';
							if (first && isFirstItem) cls += ' mlp-line-list-first';
							if (last && isLastItem) cls += ' mlp-line-list-last';
							return cls;
						});
						return;
					}
					case 'Blockquote':
						{
							if (decoratedQuotes.has(node.from)) return calloutForNode(state, node.node)?.collapsed ? false : undefined;
							decoratedQuotes.add(node.from);
							const firstLine = doc.lineAt(node.from);
							const raw = state.sliceDoc(firstLine.from, firstLine.to);
							let blockquoteDepth = 0;
							for (let ancestor: SyntaxNode | null = node.node; ancestor; ancestor = ancestor.parent) {
								if (ancestor.name === 'Blockquote') blockquoteDepth++;
							}
							const callout = parseCalloutHeader(raw, blockquoteDepth);
							if (callout) {
								const type = callout.type;
								const safeType = type.replace(/[^a-z0-9_-]/g, '');
								const collapsed = calloutForNode(state, node.node)!.collapsed;
								const replaced = blockReplacedLines(state, node.node);
								addLineRange(node.from, collapsed ? firstLine.to : node.to, (n, first, last) => replaced.has(n) ? '' :
									`mlp-line-callout mlp-callout-${safeType}${first ? ' mlp-line-callout-first' : ''}${last ? ' mlp-line-callout-last' : ''}`);
								if (!blockCursorTouchesRange(state, node.from, node.to)) {
									calloutHeaders.set(firstLine.from, { from: firstLine.from + callout.markerOffset, to: firstLine.to });
									pushReplace(
										firstLine.from + callout.markerOffset,
										firstLine.to,
										Decoration.replace({ widget: new CalloutHeaderWidget(type, callout.title, collapsed, firstLine.from) }),
									);
								}
								// A callout is not an ordinary quote for styling purposes.
								// User themes adapt blockquote rules to mlp-line-quote;
								// adding that class here overrides the entire colored panel.
								if (collapsed) return false;
								return; // still descend to hide quote markers and render content
							}
						}
						const replacedQuoteLines = blockReplacedLines(state, node.node);
						addLineRange(node.from, node.to, (n, first, last) => {
							if (replacedQuoteLines.has(n)) return '';
							let cls = 'mlp-line-quote';
							if (first) cls += ' mlp-line-quote-first';
							if (last) cls += ' mlp-line-quote-last';
							return cls;
						});
						return; // descend to hide the ">" marks
					case 'ListMark': {
						const line = doc.lineAt(node.from);
						const following = state.sliceDoc(node.to, Math.min(line.to, node.to + 256));
						const prefix = /^[ \t]+(?:\[[^\]\r\n]\][ \t]+)?/u.exec(following)?.[0] ?? '';
						const textFrom = node.to + prefix.length;
						if (textFrom < line.to) decorations.push(Decoration.line({ attributes: {
							'data-mlp-list-text-offset': String(textFrom - line.from),
						} }).range(line.from));
						if (listItemIsTask(state, node)) {
							// Task items render a checkbox from the TaskMarker; drop the bullet.
							if (!cursorTouchesRange(state, node.from, node.to)) {
								const next = state.sliceDoc(node.to, node.to + 1);
								pushReplace(node.from, next === ' ' ? node.to + 1 : node.to, hiddenMarkerDeco);
							}
							return;
						}
						const markText = state.sliceDoc(node.from, node.to);
						if (/^[-*+]$/.test(markText)) {
							if (!cursorTouchesRange(state, node.from, node.to)) {
								pushReplace(node.from, node.to, Decoration.replace({
									widget: new BulletWidget(bulletListDepth(node.node)),
								}));
							} else {
								decorations.push(Decoration.mark({ class: 'mlp-list-mark' }).range(node.from, node.to));
							}
						} else {
							// Ordered marker ("1.", "2)") — keep the number, just tint it.
							decorations.push(Decoration.mark({ class: 'mlp-list-mark' }).range(node.from, node.to));
						}
						return;
					}
					case 'TaskMarker': {
						if (!cursorTouchesRange(state, node.from, node.to)) {
							const checked = !/^\[ \]$/.test(state.sliceDoc(node.from, node.to));
							pushReplace(node.from, node.to, Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }));
						}
						return;
					}
					case 'HorizontalRule':
						decorations.push(Decoration.mark({ class: 'mlp-hr' }).range(node.from, node.to));
						return;
					case 'FencedCode': {
						const infoNode = node.node.getChild('CodeInfo');
						const lang = infoNode ? state.sliceDoc(infoNode.from, infoNode.to).trim().toLowerCase() : '';
						// Must use the same test blockDecorationsField uses to decide
						// whether the diagram renders — if the two disagree, either the
						// widget is dropped or the fence is styled as code underneath it.
						if (
							isDiagramLang(lang) !== null &&
							!blockCursorTouchesRange(state, node.from, node.to) &&
							diagramFenceRange(state, node.node) !== null &&
							diagramFenceText(state, node.node).trim().length > 0
						) {
							// Rendered as a diagram by blockDecorationsField; skip entirely.
							return false;
						}
						const firstLineNum = doc.lineAt(node.from).number;
						// Lezer commonly ends a fenced block at the start of the next
						// line. Resolve the final character inside the node so a newly
						// inserted line after the closing fence is never styled as code.
						const lastLineNum = doc.lineAt(Math.max(node.from, node.to - 1)).number;
						// The opening/closing ``` fence lines have no visible text once their
						// marker is hidden (cursor away): leave them as plain, unstyled lines
						// (same as any blank line elsewhere) instead of styling them as part of
						// the code box, and move the rounded-corner/padding treatment onto the
						// first/last line that still has real content. This avoids doubling the
						// visible gap above/below the block, while keeping the fence line at its
						// normal height so it stays clickable/navigable for editing the language
						// tag. Skip this for an empty fence (no content lines at all) so there's
						// still a box to show.
						const hasClosingFence = node.node.getChildren('CodeMark').length >= 2;
						const finalCodeLine = hasClosingFence ? lastLineNum - 1 : lastLineNum;
						const hasContentLines = finalCodeLine > firstLineNum;
						const firstFenceHidden =
							hasContentLines && !cursorTouchesRange(state, doc.line(firstLineNum).from, doc.line(firstLineNum).to);
						const lastFenceHidden =
							hasClosingFence && hasContentLines && !cursorTouchesRange(state, doc.line(lastLineNum).from, doc.line(lastLineNum).to);
						const firstContentLine = firstFenceHidden ? firstLineNum + 1 : firstLineNum;
						const lastContentLine = lastFenceHidden ? lastLineNum - 1 : lastLineNum;
						addLineRange(node.from, node.to, (n) => {
							if (n === firstLineNum && firstFenceHidden) return '';
							if (n === lastLineNum && lastFenceHidden) return '';
							let cls = 'mlp-line-code';
							if (n === firstContentLine) cls += ' mlp-line-code-first';
							if (n === lastContentLine) cls += ' mlp-line-code-last';
							return cls;
						});
						// Copy button, over the block's top-right corner. Selecting a code
						// block by hand sweeps up the hidden ``` fence lines and any
						// indentation the block is nested under, so a hand-made selection
						// needs tidying before it can be pasted. The button copies the
						// content lines exactly, with neither fence nor indentation.
						if (lastLineNum > firstLineNum && !seenCodeControls.has(node.from)) {
							seenCodeControls.add(node.from);
							const codeFrom = hasContentLines ? doc.line(firstLineNum + 1).from : doc.line(firstLineNum).to;
							const codeTo = hasContentLines ? doc.line(finalCodeLine).to : codeFrom;
							const contentLineCount = hasContentLines ? finalCodeLine - firstLineNum : 0;
							let collapsed = false;
							const foldFrom = doc.lineAt(codeFrom).to;
							foldedRanges(state).between(foldFrom, codeTo, (from, to) => {
								if (from === foldFrom && to === codeTo) collapsed = true;
							});
							decorations.push(
								Decoration.widget({
									widget: new CopyCodeWidget(codeFrom, codeTo, doc.line(firstLineNum).to, contentLineCount, collapsed,
										infoNode ? state.sliceDoc(infoNode.from, Math.min(infoNode.to, infoNode.from + 80)).trim().split(/\s+/)[0] : ''),
									side: -1,
								}).range(codeFrom),
							);
						}
						return; // descend to hide the ``` fence marks
					}
					case 'Link': {
						// Bare bracket syntax is also parsed as a potential reference
						// link. Leave it intact for footnotes/callouts (or as text),
						// rather than creating an empty-href link over their widgets.
						const reference = node.node.getChild('URL') ? undefined : referenceLinkTarget(state, node.node);
						if (!node.node.getChild('URL') && reference === undefined) return false;
						const marks = node.node.getChildren('LinkMark');
						if (marks.length < 2) return;
						const labelFrom = marks[0].to;
						const labelTo = marks[1].from;
						const urlNode = node.node.getChild('URL');
						const href = urlNode ? markdownDestination(state.sliceDoc(urlNode.from, urlNode.to)) : reference!;
						if (!cursorTouchesRange(state, node.from, node.to)) {
							const label = state.sliceDoc(labelFrom, labelTo);
							if (labelFrom > node.from) pushReplace(node.from, labelFrom, hiddenMarkerDeco);
							if (labelFrom < labelTo) {
								decorations.push(Decoration.replace({ widget: new MarkdownLinkWidget(label, href) }).range(labelFrom, labelTo));
							} else {
								decorations.push(Decoration.widget({ widget: new MarkdownLinkWidget(label, href) }).range(labelFrom));
							}
							if (node.to > labelTo) pushReplace(labelTo, node.to, hiddenMarkerDeco);
						}
						return false;
					}
					case 'Image': {
						if (state.sliceDoc(node.from, Math.min(node.from + 3, node.to)) === '![[') return false;
						const marks = node.node.getChildren('LinkMark');
						if (marks.length < 2) return;
						const altFrom = marks[0].to;
						const altTo = marks[1].from;
						const urlNode = node.node.getChild('URL');
						const src = urlNode ? markdownDestination(state.sliceDoc(urlNode.from, urlNode.to)) : referenceLinkTarget(state, node.node);
						if (src === undefined) return false;
						const alt = state.sliceDoc(altFrom, altTo);
						if (isDrawioPath(src) && !isDiagramRenderingAllowed()) return false;
						if (!cursorTouchesRange(state, node.from, node.to)) {
							// A `.drawio` reference is XML, not an image format: an <img>
							// pointed at it renders nothing at all, so it goes to the
							// diagram widget (which reads the file through the host)
							// instead. `.drawio.svg`/`.drawio.png` deliberately do not —
							// those are real images that an <img> already shows correctly.
							const widget = isDrawioPath(src) ? new DrawioFileWidget(src, alt) : new ImageWidget(src, alt);
							pushReplace(node.from, node.to, Decoration.replace({ widget }));
						}
						return false;
					}
					case 'Table': {
						const tableRevealed = blockCursorTouchesRange(state, node.from, node.to);
						noteRevealed(node.from, node.to, tableRevealed);
						if (!tableRevealed && alignedBlockRange(state, node.from, node.to)) {
							// Rendered as a rich table by blockDecorationsField. Block
							// decorations may not be supplied from a view plugin, so emit
							// nothing here and let the state field replace this range.
							return false;
						}
						decorations.push(Decoration.mark({ class: 'mlp-table-raw' }).range(node.from, node.to));
						return;
					}
				}
			},
		});
	}

	for (const [lineFrom, cls] of seenLine) {
		decorations.push(Decoration.line({ class: cls }).range(lineFrom));
	}

	return Decoration.set(decorations, true);
}

export const livePreviewPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = buildDecorations(view);
		}

		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged || update.selectionSet || update.transactions.some(tr => tr.effects.some(effect => effect.is(refreshPreview))) || foldedRanges(update.startState) !== foldedRanges(update.state) || update.startState.field(calloutState, false) !== update.state.field(calloutState, false)) {
				this.decorations = buildDecorations(update.view);
			}
		}
	},
	{ decorations: (v) => v.decorations },
);

/**
 * Opens a rendered link when it is clicked.
 *
 * A plain click follows the link, which is what a link that *looks* like a
 * link is expected to do — it used to require Ctrl/Cmd, and a plain click fell
 * through to CodeMirror instead, putting the caret in the text and unrendering
 * the link into its `[label](url)` source. Ctrl/Cmd-click keeps working, so
 * the habit from the old behavior still does the right thing.
 *
 * Editing a link's own text is still possible: click just outside it, or use
 * the keyboard. That is the same trade every rendered block makes here.
 */
export function createLinkClickHandler(onOpen: (href: string) => void) {
	const keyboardActivation = ViewPlugin.fromClass(class {
		private readonly tableMousedown = (event: MouseEvent) => {
			if (event.button !== 0 || (!event.ctrlKey && !event.metaKey)) return;
			const target = event.target as HTMLElement | null;
			const link = target?.closest('.mlp-table .mlp-link');
			const href = link?.getAttribute('data-href');
			if (!href) return;
			// Table widgets intentionally ignore CodeMirror events to preserve
			// native text selection and cell editing. Their modified link clicks
			// therefore need the same capture path as keyboard activation.
			event.preventDefault();
			event.stopImmediatePropagation();
			protectRenderedBlockFromCaret();
			onOpen(href);
		};
		private readonly keydown = (event: KeyboardEvent) => {
			if (event.key !== 'Enter') return;
			const target = event.target as HTMLElement | null;
			const linkEl = target?.closest('.mlp-link') as HTMLElement | null;
			const href = linkEl?.getAttribute('data-href');
			if (!href) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			onOpen(href);
		};
		constructor(private readonly view: EditorView) {
			// CodeMirror's keymap consumes Enter before a domEventHandlers keydown
			// callback when focus is on a marked text range. Capture at the editor
			// root so a tabindex-enabled rendered link remains keyboard-operable.
			view.dom.addEventListener('keydown', this.keydown, true);
			view.dom.addEventListener('mousedown', this.tableMousedown, true);
		}
		destroy() {
			this.view.dom.removeEventListener('keydown', this.keydown, true);
			this.view.dom.removeEventListener('mousedown', this.tableMousedown, true);
		}
	});
	const handle = (event: MouseEvent): boolean => {
		// Only the primary button; a right-click belongs to the context menu.
		if (event.button !== 0) return false;
		const target = event.target as HTMLElement | null;
		const linkEl = target?.closest('.mlp-link') as HTMLElement | null;
		const href = linkEl?.getAttribute('data-href');
		if (!href) return false;
		event.preventDefault();
		onOpen(href);
		return true;
	};
	return [EditorView.domEventHandlers({
		// Taken on the press, before CodeMirror's own mousedown handler can move
		// the caret into the link and reveal its source.
		mousedown: handle,
		// The click that follows is swallowed too, so nothing acts on it twice.
		click: (event) => {
			const target = event.target as HTMLElement | null;
			if (!target?.closest('.mlp-link')) return false;
			event.preventDefault();
			return true;
		},
	}), keyboardActivation];
}
