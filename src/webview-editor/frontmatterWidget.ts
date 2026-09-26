import type { EditorState } from '@codemirror/state';
import { notifyActiveDraftChanged, preserveUncommittedDraft, registerActiveDraft } from './activeDraft';
import { EditorView, WidgetType } from '@codemirror/view';
import { wrapBlockWidget } from './blockWidgetWrap';
import { withCodeModeButton } from './codeModeButton';
import { t } from '../shared/i18n';
import { parseDocument } from 'yaml';
import { MAX_YAML_BYTES, MAX_YAML_NODES } from './frontmatterSecurity';
import { parseWikiLinkBody } from '../vault/LinkResolver';

export interface FrontmatterRange {
	from: number;
	to: number;
	yamlText: string;
	rawText: string;
	lineEnding: '\n' | '\r\n';
}

let propertyValidationId = 0;

type PropertyChangeHandler = (key: string, value: unknown, onAccepted?: () => void) => boolean;

function lineContent(text: string): string {
	return text.endsWith('\r') ? text.slice(0, -1) : text;
}

/**
 * Detects a YAML frontmatter block: the document's first line must be exactly
 * `---`, followed later by a line that is also exactly `---`. Unlike every other
 * block construct in this app, frontmatter has no `@lezer/markdown` node of its
 * own, so this is a plain line scan over `state.doc`, not a syntax-tree match.
 */
export function detectFrontmatter(state: EditorState): FrontmatterRange | null {
	const { doc } = state;
	if (doc.lines < 2 || lineContent(doc.line(1).text) !== '---') return null;

	const yamlStart = doc.line(2).from;
	for (let n = 2; n <= doc.lines; n++) {
		const line = doc.line(n);
		if (lineContent(line.text) === '---') {
			const previous = n > 2 ? doc.line(n - 1) : undefined;
			// In the raw-offset CRLF model a line's `.to` includes its CR. YAML
			// treats a final bare CR as scalar content, so omit only that terminal
			// separator half while retaining all complete CRLF pairs inside YAML.
			const yamlEnd = previous
				? previous.to - (previous.text.endsWith('\r') ? 1 : 0)
				: 0;
			const yamlText = previous ? doc.sliceString(doc.line(2).from, yamlEnd) : '';
			const rawText = doc.sliceString(doc.line(1).from, line.to);
			return {
				from: doc.line(1).from,
				to: line.to,
				yamlText,
				rawText,
				lineEnding: rawText.includes('\r\n') ? '\r\n' : '\n',
			};
		}
		// Do not repeatedly scan the remainder of a very large or unterminated
		// properties block during decoration. Oversized YAML stays visible and
		// editable as ordinary source instead of becoming a rendered widget.
		if (line.to - yamlStart > MAX_YAML_BYTES) return null;
	}
	return null;
}

function isScalar(value: unknown): boolean {
	return value === null || (typeof value !== 'object' && typeof value !== 'function');
}

/** Human-readable text for one frontmatter value (design.md §6). */
function formatValue(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (isScalar(value)) return String(value);
	if (Array.isArray(value) && value.every(isScalar)) {
		return value.map((v) => (v === null || v === undefined ? '' : String(v))).join(', ');
	}
	return JSON.stringify(value, null, 2);
}

function propertyWikiLinkBody(value: unknown): string | undefined {
	if (typeof value !== 'string' || !/^\[\[[^\]\n]+\]\]$/.test(value)) return undefined;
	const body = value.slice(2, -2);
	return parseWikiLinkBody(body) ? body : undefined;
}

function createPropertyWikiLink(body: string, includeChipClass = false): HTMLAnchorElement {
	const parsed = parseWikiLinkBody(body);
	const link = document.createElement('a');
	link.className = `${includeChipClass ? 'mlp-property-chip ' : ''}mlp-property-link mlp-link`;
	link.textContent = parsed?.alias || body;
	link.dataset.href = `wikilink:${encodeURIComponent(body)}`;
	link.setAttribute('role', 'link');
	link.tabIndex = 0;
	return link;
}

function createPropertyEditButton(): HTMLButtonElement {
	const edit = document.createElement('button');
	edit.type = 'button';
	edit.className = 'mlp-property-edit';
	edit.textContent = '✎';
	return edit;
}

/**
 * Formats a scalar YAML sequence for the compact property editor. Commas inside
 * wikilink aliases are unambiguous because the parser below understands the
 * `[[...]]` boundary; other comma-bearing strings are JSON-quoted so a
 * round-trip cannot silently turn one item into two.
 */
export function formatPropertyListInput(values: readonly unknown[]): string {
	return values.map((value) => {
		if (value === null || value === undefined) return 'null';
		if (typeof value !== 'string') return String(value);
		if (propertyWikiLinkBody(value) !== undefined) return value;
		return value === '' || value.trim() !== value || /[,'"\\]/.test(value)
			? JSON.stringify(value)
			: value;
	}).join(', ');
}

/** Parses the compact list syntax without treating commas in quotes or wikilinks as separators. */
export function parsePropertyListInput(input: string, original: readonly unknown[] = []): unknown[] | undefined {
	if (input.length > MAX_YAML_BYTES) return undefined;
	const rawItems: string[] = [];
	let start = 0;
	let quote: '"' | "'" | undefined;
	let wikiDepth = 0;
	let escaped = false;
	for (let index = 0; index < input.length; index++) {
		const character = input[index];
		if (!quote && wikiDepth > 0) {
			if (character === '[' && input[index + 1] === '[') { wikiDepth++; index++; continue; }
			if (character === ']' && input[index + 1] === ']') { wikiDepth--; index++; continue; }
			continue;
		}
		if (quote) {
			if (quote === '"' && escaped) { escaped = false; continue; }
			if (quote === '"' && character === '\\') { escaped = true; continue; }
			if (character === quote) {
				if (quote === "'" && input[index + 1] === "'") { index++; continue; }
				quote = undefined;
			}
			continue;
		}
		if (character === '"' || character === "'") { quote = character; continue; }
		if (character === '[' && input[index + 1] === '[') { wikiDepth = 1; index++; continue; }
		if (character === ']' && input[index + 1] === ']') {
			if (wikiDepth === 0) return undefined;
			wikiDepth--; index++; continue;
		}
		if (character === ',' && wikiDepth === 0) {
			rawItems.push(input.slice(start, index).trim());
			if (rawItems.length > MAX_YAML_NODES) return undefined;
			start = index + 1;
		}
	}
	if (quote || wikiDepth !== 0 || escaped) return undefined;
	rawItems.push(input.slice(start).trim());
	if (rawItems.length > MAX_YAML_NODES) return undefined;

	const decoded: string[] = [];
	for (const raw of rawItems) {
		if (!raw) continue;
		if (raw.startsWith('"') || raw.endsWith('"')) {
			if (!(raw.startsWith('"') && raw.endsWith('"'))) return undefined;
			try {
				const value = JSON.parse(raw) as unknown;
				if (typeof value !== 'string') return undefined;
				decoded.push(value);
			} catch { return undefined; }
			continue;
		}
		if (raw.startsWith("'") || raw.endsWith("'")) {
			if (!(raw.startsWith("'") && raw.endsWith("'"))) return undefined;
			decoded.push(raw.slice(1, -1).replace(/''/g, "'"));
			continue;
		}
		decoded.push(raw);
	}

	const present = original.filter((value) => value !== null && value !== undefined);
	const homogeneousType = present.length && present.every((value) => typeof value === typeof present[0])
		? typeof present[0]
		: undefined;
	const values: unknown[] = [];
	for (let index = 0; index < decoded.length; index++) {
		const text = decoded[index];
		if (original[index] === null) {
			values.push(text === 'null' ? null : text);
			continue;
		}
		const expected = original[index] === undefined ? homogeneousType : typeof original[index];
		if (expected === 'number') {
			const value = Number(text);
			if (!Number.isFinite(value) || text.trim() === '') return undefined;
			values.push(value);
		} else if (expected === 'boolean') {
			if (text !== 'true' && text !== 'false') return undefined;
			values.push(text === 'true');
		} else if (homogeneousType === 'object' && text === 'null') {
			values.push(null);
		} else values.push(text);
	}
	return values;
}

export function updateFrontmatterProperty(
	yamlText: string,
	key: string,
	value: unknown,
	lineEnding: '\n' | '\r\n' = '\n',
): string {
	const document = parseDocument(yamlText);
	if (document.errors.length) throw new Error(t('yaml.invalid'));
	document.set(key, value);
	const body = document.toString({ lineWidth: 0 }).trimEnd().replace(/\n/g, lineEnding);
	return `---${lineEnding}${body}${lineEnding}---`;
}

function appendTypedValue(
	cell: HTMLTableCellElement, key: string, value: unknown,
	onChange: PropertyChangeHandler,
	getSnapshot: (key: string, value: unknown) => string | undefined,
	canEdit: () => boolean,
): void {
	if (typeof value === 'boolean') {
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.checked = value;
		checkbox.setAttribute('aria-label', value ? t('property.true') : t('property.false'));
		checkbox.addEventListener('mousedown', (event) => event.stopPropagation());
		checkbox.addEventListener('click', (event) => event.stopPropagation());
		checkbox.addEventListener('change', () => {
			// A queue, size, or locked-mode filter may reject the replacement.
			// Keep the control honest: only accepted changes can toggle the value.
			if (!onChange(key, checkbox.checked)) checkbox.checked = value;
			checkbox.setAttribute('aria-label', checkbox.checked ? t('property.true') : t('property.false'));
		});
		cell.classList.add('mlp-property-boolean');
		cell.appendChild(checkbox);
		return;
	}
	if (typeof value === 'number') {
		cell.classList.add('mlp-property-number');
		cell.textContent = String(value);
		enableValueEditing(cell, key, value, onChange, getSnapshot, canEdit);
		return;
	}
	if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+-]+Z?)?$/.test(value)) {
		const time = document.createElement('time');
		time.dateTime = value;
		time.textContent = value;
		cell.classList.add(value.includes('T') || value.includes(' ') ? 'mlp-property-datetime' : 'mlp-property-date');
		cell.appendChild(time);
		enableValueEditing(cell, key, value, onChange, getSnapshot, canEdit);
		return;
	}
	const wikiBody = propertyWikiLinkBody(value);
	if (wikiBody !== undefined) {
		const link = createPropertyWikiLink(wikiBody);
		const edit = createPropertyEditButton();
		cell.classList.add('mlp-property-link-cell');
		cell.append(link, edit);
		enableValueEditing(cell, key, value, onChange, getSnapshot, canEdit, edit);
		return;
	}
	if (Array.isArray(value) && value.every(isScalar)) {
		const isTags = key === 'tags' || key === 'tag';
		const hasWikiLinks = !isTags && value.some((item) => propertyWikiLinkBody(item) !== undefined);
		cell.classList.add('mlp-property-list');
		for (const item of value) {
			const itemWikiBody = hasWikiLinks ? propertyWikiLinkBody(item) : undefined;
			if (itemWikiBody !== undefined) {
				cell.appendChild(createPropertyWikiLink(itemWikiBody, true));
				continue;
			}
			const chip = document.createElement('span');
			chip.className = isTags ? 'mlp-property-chip mlp-property-tag' : 'mlp-property-chip';
			const text = item === null || item === undefined ? '' : String(item);
			chip.textContent = isTags && text && !text.startsWith('#') ? `#${text}` : text;
			cell.appendChild(chip);
		}
		if (hasWikiLinks) {
			const edit = createPropertyEditButton();
			cell.appendChild(edit);
			enableValueEditing(cell, key, value, onChange, getSnapshot, canEdit, edit);
		} else enableValueEditing(cell, key, value, onChange, getSnapshot, canEdit);
		return;
	}
	const formatted = formatValue(value);
	if (formatted.includes('\n')) {
		const pre = document.createElement('pre');
		pre.textContent = formatted;
		cell.appendChild(pre);
	} else {
		cell.textContent = formatted;
	}
	if (isScalar(value) || (Array.isArray(value) && value.every(isScalar))) {
		enableValueEditing(cell, key, value, onChange, getSnapshot, canEdit);
	}
}

function enableValueEditing(
	cell: HTMLTableCellElement,
	key: string,
	value: unknown,
	onChange: PropertyChangeHandler,
	getSnapshot: (key: string, value: unknown) => string | undefined,
	canEdit: () => boolean,
	explicitTrigger?: HTMLButtonElement,
): void {
	if (typeof value === 'boolean') return;
	let editing = false;
	const start = (): void => {
		// Native inputs are editable even below a locked CodeMirror root. Check
		// the live facet here, because equal widgets can survive a mode toggle.
		if (editing || !canEdit()) return;
		editing = true;
		const original = Array.from(cell.childNodes).map((node) => node.cloneNode(true));
		const input = document.createElement('input');
		input.className = 'mlp-property-input';
		input.type = 'text';
		input.setAttribute('aria-label', t('property.edit', key));
		input.value = Array.isArray(value)
			? formatPropertyListInput(value)
			: String(value ?? '');
		input.maxLength = MAX_YAML_BYTES;
		const validation = document.createElement('div');
		validation.className = 'mlp-property-error';
		validation.id = `mlp-property-error-${++propertyValidationId}`;
		validation.setAttribute('role', 'alert');
		validation.textContent = t(Array.isArray(value) ? 'property.listInvalid' : 'property.numberInvalid');
		validation.hidden = true;
		const clearValidation = (): void => {
			input.removeAttribute('aria-invalid');
			input.removeAttribute('aria-describedby');
			validation.hidden = true;
		};
		const restore = (): void => {
			editing = false;
			cell.replaceChildren(...original.map((node) => node.cloneNode(true)));
			if (explicitTrigger) {
				const restored = cell.querySelector<HTMLButtonElement>('.mlp-property-edit');
				if (restored) bindTrigger(restored);
				(restored ?? cell).focus();
			} else cell.focus();
			notifyActiveDraftChanged();
		};
		const readInput = (): { ok: true; value: unknown } | { ok: false } => {
			let next: unknown;
			if (Array.isArray(value)) {
				next = parsePropertyListInput(input.value, value);
				if (!next) return { ok: false };
				if (key === 'tag' || key === 'tags') next = (next as unknown[]).map((item) => typeof item === 'string' ? item.replace(/^#/, '') : item);
			} else if (typeof value === 'number') {
				const parsed = Number(input.value.trim());
				if (!Number.isFinite(parsed) || input.value.trim() === '') return { ok: false };
				next = parsed;
			} else next = input.value;
			return { ok: true, value: next };
		};
		const commit = (): void => {
			const next = readInput();
			if (!next.ok) {
				input.setAttribute('aria-invalid', 'true');
				input.setAttribute('aria-describedby', validation.id);
				validation.hidden = false;
				return;
			}
			if (!onChange(key, next.value, () => { editing = false; })) {
				// Do not spend an input until CodeMirror accepts its replacement.
				// Preserve before a subsequent blur/redraw can detach the draft.
				preserveUncommittedDraft(`Uncommitted property ${key}:\n${input.value}`);
			}
		};
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commit(); }
			else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); restore(); }
		});
		input.addEventListener('input', clearValidation);
		registerActiveDraft(input, () => { if (editing && input.isConnected) commit(); },
			() => editing ? `Uncommitted property ${key}:\n${input.value}` : undefined,
			() => {
				if (!editing) return undefined;
				const next = readInput();
				return next.ok ? getSnapshot(key, next.value) : undefined;
			});
		input.addEventListener('mousedown', (event) => event.stopPropagation());
		input.addEventListener('blur', () => {
			if (editing && !readInput().ok) {
				// Validation keeps this out of YAML, but moving focus must not erase
				// its only journal when the next source/field change is captured.
				// Preserve synchronously: a redraw may detach the input immediately.
				commit();
				preserveUncommittedDraft(`Uncommitted property ${key}:\n${input.value}`);
				return;
			}
			// A click elsewhere is not cancellation. Defer past CodeMirror redraws
			// and retain validation errors rather than silently discarding a draft.
			queueMicrotask(() => { if (editing && input.isConnected) commit(); });
		});
		cell.replaceChildren(input, validation);
		input.focus();
		input.select();
	};
	const bindTrigger = (trigger: HTMLElement): void => {
		trigger.setAttribute('aria-label', t('property.edit', key));
		trigger.title = t('property.editHint');
		trigger.addEventListener('mousedown', (event) => event.stopPropagation());
		if (explicitTrigger) trigger.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			start();
		});
		else trigger.addEventListener('dblclick', (event) => {
			event.preventDefault();
			event.stopPropagation();
			start();
		});
		trigger.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === 'F2') {
				event.preventDefault();
				event.stopPropagation();
				start();
			}
		});
	};
	if (explicitTrigger) bindTrigger(explicitTrigger);
	else {
		cell.tabIndex = 0;
		cell.setAttribute('role', 'button');
		bindTrigger(cell);
	}
}

function jumpToRange(view: EditorView, el: HTMLElement): void {
	const pos = view.posAtDOM(el);
	view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
	view.focus();
}

/** Renders a parsed frontmatter (1+ entries) as a key/value table. */
export class FrontmatterWidget extends WidgetType {
	constructor(
		private readonly entries: Array<[string, unknown]>,
		private readonly range: FrontmatterRange,
	) {
		super();
	}

	eq(other: FrontmatterWidget): boolean {
		return JSON.stringify(other.entries) === JSON.stringify(this.entries) &&
			other.range.from === this.range.from && other.range.to === this.range.to &&
			other.range.rawText === this.range.rawText;
	}

	toDOM(view: EditorView): HTMLElement {
		const table = document.createElement('table');
		table.className = 'mlp-frontmatter';
		const tbody = document.createElement('tbody');
		const propertyReplacement = (key: string, value: unknown): string | undefined => {
			if (this.range.to > view.state.doc.length ||
				view.state.sliceDoc(this.range.from, this.range.to) !== this.range.rawText) return;
			let insert: string;
			try {
				insert = updateFrontmatterProperty(this.range.yamlText, key, value, this.range.lineEnding);
				// In the raw-offset model CodeMirror treats CR as line content and LF as
				// the separator. The replaced range includes the closing line's CR but
				// leaves its LF in place, so retain that final CR in the replacement.
				if (this.range.lineEnding === '\r\n') insert += '\r';
			}
			catch { return; }
			return insert;
		};
		const updateValue: PropertyChangeHandler = (key, value, onAccepted) => {
			const insert = propertyReplacement(key, value);
			if (insert === undefined) return false;
			const nextLength = view.state.doc.length - (this.range.to - this.range.from) + insert.length;
			const anchor = Math.min(this.range.from + insert.length + 1, nextLength);
			const transaction = view.state.update({ changes: { from: this.range.from, to: this.range.to, insert }, selection: { anchor } });
			if (!transaction.docChanged) return false;
			// Recovery observers run synchronously during dispatch. Clear only an
			// accepted input first so they do not capture it again as a residual.
			onAccepted?.();
			view.dispatch(transaction);
			view.focus();
			return true;
		};
		const propertySnapshot = (key: string, value: unknown): string | undefined => {
			const insert = propertyReplacement(key, value);
			return insert === undefined ? undefined : view.state.sliceDoc(0, this.range.from) + insert + view.state.sliceDoc(this.range.to);
		};
		for (const [key, value] of this.entries) {
			const tr = document.createElement('tr');
			const th = document.createElement('th');
			th.textContent = key;
			const td = document.createElement('td');
			appendTypedValue(td, key, value, updateValue, propertySnapshot, () => view.state.facet(EditorView.editable));
			tr.append(th, td);
			tbody.appendChild(tr);
		}
		table.appendChild(tbody);
		table.addEventListener('mousedown', (event) => {
			if ((event.target as HTMLElement | null)?.closest('input, button, a')) return;
			const editable = (event.target as HTMLElement | null)?.closest('td[role="button"]') as HTMLElement | null;
			if (editable) {
				event.preventDefault();
				event.stopPropagation();
				editable.focus();
				return;
			}
			event.preventDefault();
			jumpToRange(view, table);
		});
		// Clicking the block already reveals the source; the button makes that
		// route visible, and matches the one every other rendered block carries.
		return wrapBlockWidget(withCodeModeButton(view, table, { anchor: table }));
	}

	ignoreEvent(): boolean {
		return true;
	}
}

/**
 * Renders a parsed-but-empty frontmatter (0 entries) as nothing. Implements
 * `estimatedHeight` like `HiddenMarkerWidget` in livePreviewPlugin.ts, so
 * CodeMirror's line-height sampler can't mistake it for a plain text line.
 */
export class FrontmatterEmptyWidget extends WidgetType {
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

/** Renders a YAML parse failure in place of the table. */
export class FrontmatterErrorWidget extends WidgetType {
	constructor(private readonly message: string) {
		super();
	}

	eq(other: FrontmatterErrorWidget): boolean {
		return other.message === this.message;
	}

	toDOM(view: EditorView): HTMLElement {
		const container = document.createElement('div');
		container.className = 'mlp-frontmatter-error';
		container.setAttribute('role', 'alert');
		const strong = document.createElement('strong');
		strong.textContent = t('frontmatter.parseFailed');
		const pre = document.createElement('pre');
		pre.textContent = this.message;
		container.append(strong, pre);
		container.addEventListener('mousedown', (event) => {
			event.preventDefault();
			jumpToRange(view, container);
		});
		// A parse error is exactly when the source needs reaching, so the button
		// matters most here.
		return wrapBlockWidget(withCodeModeButton(view, container, { anchor: container }));
	}

	ignoreEvent(): boolean {
		return false;
	}
}
