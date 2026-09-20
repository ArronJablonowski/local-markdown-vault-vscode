import { parser as baseMarkdownParser, Autolink, Strikethrough, Table, TaskList } from '@lezer/markdown';
import type { SyntaxNode } from '@lezer/common';
import { renderInlineInto, type CellInlineHooks } from './tableCellInline';
import { t } from '../shared/i18n';

const parser = baseMarkdownParser.configure([Table, TaskList, Strikethrough, Autolink]);
const MAX_RENDER_NODES = 5_000;

export interface EmbeddedMarkdownHooks extends CellInlineHooks {
	renderNested: (parent: HTMLElement, body: string) => void;
}

/** Renders a deliberately small, inert CommonMark/GFM DOM subset. */
export function renderEmbeddedMarkdown(parent: HTMLElement, source: string, hooks: EmbeddedMarkdownHooks): void {
	const tree = parser.parse(source);
	let visited = 0;
	const render = (container: HTMLElement, node: SyntaxNode): void => {
		if (++visited > MAX_RENDER_NODES) throw new Error(t('embed.renderLimit'));
		const raw = source.slice(node.from, node.to);
		switch (node.name) {
			case 'Document':
				for (let child = node.firstChild; child; child = child.nextSibling) render(container, child);
				return;
			case 'Paragraph': {
				const nested = /^!\[\[([^\]\n]+)\]\]$/.exec(raw.trim());
				if (nested) { hooks.renderNested(container, nested[1]); return; }
				const p = document.createElement('p');
				renderInlineInto(p, raw, hooks);
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
			case 'FencedCode': case 'CodeBlock': {
				let text = raw;
				const codeText = node.getChild('CodeText');
				if (codeText) text = source.slice(codeText.from, codeText.to);
				const pre = document.createElement('pre');
				const code = document.createElement('code');
				code.textContent = text;
				pre.appendChild(code);
				container.appendChild(pre);
				return;
			}
			case 'BulletList': case 'OrderedList': {
				const list = document.createElement(node.name === 'OrderedList' ? 'ol' : 'ul');
				for (let child = node.firstChild; child; child = child.nextSibling) {
					if (child.name === 'ListItem') render(list, child);
				}
				container.appendChild(list);
				return;
			}
			case 'ListItem': {
				const item = document.createElement('li');
				for (let child = node.firstChild; child; child = child.nextSibling) {
					if (child.name !== 'ListMark') render(item, child);
				}
				container.appendChild(item);
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
				const literal = document.createElement('pre');
				literal.className = 'mlp-embed-raw-html';
				literal.textContent = raw;
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
	const rows = lines.map(splitRow);
	const table = document.createElement('table');
	table.className = 'mlp-table mlp-embed-table';
	for (let row = 0; row < rows.length; row++) {
		if (row === 1) continue;
		const tr = document.createElement('tr');
		for (const value of rows[row]) {
			const cell = document.createElement(row === 0 ? 'th' : 'td');
			renderInlineInto(cell, value.trim(), hooks);
			tr.appendChild(cell);
		}
		table.appendChild(tr);
	}
	parent.appendChild(table);
}

function splitRow(line: string): string[] {
	const value = line.trim().replace(/^\|/, '').replace(/\|$/, '');
	const cells: string[] = [];
	let current = '';
	for (let i = 0; i < value.length; i++) {
		if (value[i] === '|' && value[i - 1] !== '\\') { cells.push(current); current = ''; }
		else current += value[i];
	}
	cells.push(current);
	return cells;
}
