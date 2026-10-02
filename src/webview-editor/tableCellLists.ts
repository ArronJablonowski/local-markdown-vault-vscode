import { parser, Autolink, Strikethrough, Table, TaskList } from '@lezer/markdown';

// Disable block HTML classification only for inspection. Inline parsing still
// protects code spans, escapes, comments, and link labels from tag recognition.
const listParser = parser.configure([Table, TaskList, Strikethrough, Autolink, { remove: ['HTMLBlock'] }]);
export const MAX_CELL_LIST_SOURCE = 65_536;
export const MAX_CELL_LIST_NODES = 1_000;
export const MAX_CELL_LIST_DEPTH = 32;

export interface CellListElement {
	tag: 'ul' | 'ol' | 'li';
	children: CellListPart[];
}
export type CellListPart = string | CellListElement;

/** Recognize balanced, attribute-free list structure, never general HTML. */
export function parseTableCellLists(source: string): CellListPart[] | null {
	if (source.length > MAX_CELL_LIST_SOURCE || !/<(?:ul|ol)[\s>]/i.test(source)) return null;
	const parts: CellListPart[] = [];
	const stack: CellListElement[] = [];
	let offset = 0;
	let nodes = 0;
	let invalid = false;
	const append = (text: string): void => {
		const owner = stack[stack.length - 1];
		// A list can contain items, not orphan text or arbitrary markup.
		if (owner && owner.tag !== 'li') { if (text.trim()) invalid = true; return; }
		if (text) (owner?.children ?? parts).push(text);
	};
	listParser.parse(source).iterate({ enter(node) {
		if (invalid) return false;
		// Only direct paragraph tags can open structure. A tag inside code,
		// emphasis, or a link label must remain within its inline construct.
		if (node.name !== 'Document' && node.name !== 'Paragraph' && node.name !== 'HTMLTag') return false;
		if (node.name !== 'HTMLTag') return;
		const raw = source.slice(node.from, node.to);
		if (!/^<\/?(?:ul|ol|li)(?:[\s/>])/i.test(raw)) return;
		append(source.slice(offset, node.from));
		const tag = /^<(\/?)(ul|ol|li)[\t\n\r ]*>$/i.exec(raw);
		if (!tag || invalid) { invalid = true; return false; }
		const name = tag[2].toLowerCase() as CellListElement['tag'];
		const owner = stack[stack.length - 1];
		if (tag[1]) {
			if (owner?.tag !== name) { invalid = true; return false; }
			stack.pop();
		} else {
			if (++nodes > MAX_CELL_LIST_NODES || stack.length >= MAX_CELL_LIST_DEPTH
				|| (name === 'li' ? !owner || owner.tag === 'li' : owner && owner.tag !== 'li')) {
				invalid = true; return false;
			}
			const element: CellListElement = { tag: name, children: [] };
			(owner?.children ?? parts).push(element);
			stack.push(element);
		}
		offset = node.to;
	} });
	append(source.slice(offset));
	// Incomplete edits and over-limit structures fall back to literal source;
	// no partial list is ever mounted before the entire cell is validated.
	return invalid || stack.length || !nodes ? null : parts;
}
