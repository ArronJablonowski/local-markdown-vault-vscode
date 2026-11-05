import { parser as baseMarkdownParser, Autolink, Strikethrough, Table, TaskList } from '@lezer/markdown';
import type { SyntaxNode } from '@lezer/common';
import { renderInlineInto, renderTableCellInto, type CellInlineHooks } from './tableCellInline';
import { t } from '../shared/i18n';
import { renderSafeHtml } from './safeHtml';

const parser = baseMarkdownParser.configure([Table, TaskList, Strikethrough, Autolink]);
const MAX_RENDER_NODES = 5_000;

export interface EmbeddedMarkdownHooks extends CellInlineHooks {
	renderNested: (parent: HTMLElement, body: string) => void;
}

/** Renders a deliberately small, inert CommonMark/GFM DOM subset. */
export function renderEmbeddedMarkdown(parent: HTMLElement, source: string, hooks: EmbeddedMarkdownHooks): void {
	const tree = parser.parse(source);
	// Only parser-confirmed container marks are removed; literal '>' remains text.
	const inlineSource = (node: SyntaxNode, end = node.to): string => {
		const pieces: string[] = [];
		let position = node.from;
		tree.iterate({ from: node.from, to: end, enter(child) {
			if (child.name !== 'QuoteMark' || child.from < position || child.to > end) return;
			pieces.push(source.slice(position, child.from));
			position = child.to + Number(source[child.to] === ' ' && child.to < end);
		} });
		pieces.push(source.slice(position, end));
		return pieces.join('');
	};
	let visited = 0;
	const render = (container: HTMLElement, node: SyntaxNode): void => {
		if (++visited > MAX_RENDER_NODES) throw new Error(t('embed.renderLimit'));
		const raw = source.slice(node.from, node.to);
		switch (node.name) {
			case 'Document':
				for (let child = node.firstChild; child; child = child.nextSibling) render(container, child);
				return;
			case 'Paragraph': {
				const text = inlineSource(node);
				const nested = /^!\[\[([^\]\n]+)\]\]$/.exec(text.trim());
				if (nested) { hooks.renderNested(container, nested[1]); return; }
				const p = document.createElement('p');
				renderInlineInto(p, text, hooks);
				container.appendChild(p);
				return;
			}
			case 'ATXHeading1': case 'ATXHeading2': case 'ATXHeading3':
			case 'ATXHeading4': case 'ATXHeading5': case 'ATXHeading6': {
				const level = Number(node.name.slice(-1));
				const heading = document.createElement(`h${level}`);
				const text = raw.replace(/^#{1,6}\s+/, '').replace(/\s+#+\s*$/, '');
				renderInlineInto(heading, text, hooks);
				container.appendChild(heading);
				return;
			}
			case 'SetextHeading1': case 'SetextHeading2': {
				const heading = document.createElement(node.name === 'SetextHeading1' ? 'h1' : 'h2');
				// The last source line is the underline, including any quote prefix.
				const end = source.lastIndexOf('\n', node.to - 1);
				renderInlineInto(heading, inlineSource(node, end).trimEnd(), hooks);
				container.appendChild(heading);
				return;
			}
			case 'FencedCode': case 'CodeBlock': {
				// Container prefixes split code into multiple CodeText nodes. Join all
				// literal segments, excluding quote/list prefixes and fence delimiters.
				const segments: string[] = [];
				for (let child = node.firstChild; child; child = child.nextSibling) {
					if (child.name === 'CodeText') segments.push(source.slice(child.from, child.to));
				}
				const pre = document.createElement('pre');
				const code = document.createElement('code');
				code.textContent = segments.join('');
				pre.appendChild(code);
				container.appendChild(pre);
				return;
			}
			case 'BulletList': case 'OrderedList': {
				const list = document.createElement(node.name === 'OrderedList' ? 'ol' : 'ul');
				// Continued agendas may start at zero or any other valid Markdown number.
				if (node.name === 'OrderedList') {
					const start = /^\s*(\d{1,9})[.)]/.exec(raw)?.[1];
					if (start !== undefined) list.setAttribute('start', String(Number(start)));
				}
				for (let child = node.firstChild; child; child = child.nextSibling) {
					if (child.name === 'ListItem') render(list, child);
				}
				container.appendChild(list);
				return;
			}
			case 'ListItem': {
				const item = document.createElement('li');
				for (let child = node.firstChild; child; child = child.nextSibling) {
					if (child.name !== 'ListMark' && child.name !== 'QuoteMark') render(item, child);
				}
				container.appendChild(item);
				return;
			}
			case 'Task': {
				const marker = node.getChild('TaskMarker');
				if (!marker) return;
				const checked = /x/i.test(source.slice(marker.from, marker.to));
				const paragraph = document.createElement('p');
				paragraph.className = 'mlp-embed-task';
				const checkbox = document.createElement('input');
				checkbox.setAttribute('type', 'checkbox');
				// Embedded notes are read-only: a task must not suggest it can save edits.
				checkbox.setAttribute('disabled', '');
				if (checked) checkbox.setAttribute('checked', '');
				const label = document.createElement('span');
				if (checked) label.className = 'mlp-embed-task-complete';
				renderInlineInto(label, inlineSource(node).slice(marker.to - node.from).replace(/^[ \t]/, ''), hooks);
				checkbox.setAttribute('aria-label', label.textContent ?? '');
				paragraph.appendChild(checkbox);
				paragraph.appendChild(label);
				container.appendChild(paragraph);
				return;
			}
			case 'Blockquote': {
				const quote = document.createElement('blockquote');
				for (let child = node.firstChild; child; child = child.nextSibling) {
					if (child.name !== 'QuoteMark') render(quote, child);
				}
				container.appendChild(quote);
				return;
			}
			case 'HorizontalRule':
				container.appendChild(document.createElement('hr'));
				return;
			case 'Table':
				renderTable(container, raw, hooks);
				return;
			case 'HTMLBlock': {
				const literal = document.createElement('div');
				literal.className = 'mlp-embed-raw-html';
				renderSafeHtml(literal, raw);
				container.appendChild(literal);
				return;
			}
			default:
				if (node.firstChild) {
					let child: SyntaxNode | null = node.firstChild;
					while (child) {
						const current = child;
						child = child.nextSibling;
						render(container, current);
					}
				} else if (raw.trim()) container.appendChild(document.createTextNode(raw));
		}
	};
	render(parent, tree.topNode);
}

function renderTable(parent: HTMLElement, source: string, hooks: CellInlineHooks): void {
	const lines = source.split('\n').filter((line) => line.trim());
	if (lines.length < 2) return;
	const rows = lines.map(splitEmbeddedTableRow);
	const table = document.createElement('table');
	table.className = 'mlp-table mlp-embed-table';
	const head = document.createElement('thead');
	const body = document.createElement('tbody');
	const width = rows[0].length;
	for (let row = 0; row < rows.length; row++) {
		if (row === 1) continue;
		const tr = document.createElement('tr');
		for (let column = 0; column < width; column++) {
			const cell = document.createElement(row === 0 ? 'th' : 'td');
			if (row === 0) cell.setAttribute('scope', 'col');
			const separator = rows[1][column]?.trim() ?? '';
			if (separator.endsWith(':')) cell.style.textAlign = separator.startsWith(':') ? 'center' : 'right';
			else if (separator.startsWith(':')) cell.style.textAlign = 'left';
			renderTableCellInto(cell, (rows[row][column] ?? '').trim(), hooks);
			tr.appendChild(cell);
		}
		(row === 0 ? head : body).appendChild(tr);
	}
	table.append(head, body);
	const viewport = document.createElement('div');
	viewport.className = 'mlp-table-viewport mlp-table-scrollable';
	viewport.tabIndex = 0;
	viewport.setAttribute('role', 'region');
	viewport.setAttribute('aria-label', t('table.scrollRegion'));
	viewport.appendChild(table);
	parent.appendChild(viewport);
}

/** Preserve escaped pipes and count backslash parity, just like GFM. */
export function splitEmbeddedTableRow(line: string): string[] {
	const value = line.trim();
	const cells: string[] = [];
	let current = '';
	let backslashes = 0;
	const first = value.startsWith('|') ? 1 : 0;
	for (let i = first; i < value.length; i++) {
		const char = value[i];
		if (char === '|' && backslashes % 2 === 0) {
			cells.push(current);
			current = '';
			if (i === value.length - 1) return cells;
		} else current += char;
		backslashes = char === '\\' ? backslashes + 1 : 0;
	}
	cells.push(current);
	return cells;
}
