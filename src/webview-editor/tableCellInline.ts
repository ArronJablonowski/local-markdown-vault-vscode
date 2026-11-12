import { parser as baseMarkdownParser, Table, TaskList, Strikethrough, Autolink } from '@lezer/markdown';
import type { SyntaxNode, Tree } from '@lezer/common';
import { decodeHTMLStrict } from 'entities/decode';
import { markdownDestination } from '../shared/markdownDestination';
import { parseTableCellLists, type CellListPart } from './tableCellLists';

// A table cell's content is plain text as far as CodeMirror is concerned — the
// rich TableWidget builds its own DOM outside the editor, so the live-preview
// decorations that render inline markup in the buffer never reach inside it.
// Cell content therefore has to be rendered here, from scratch.
//
// It used to be rendered by a small set of hand-rolled regexes, which diverged
// from GFM the moment a cell held anything beyond one flat construct: nested
// emphasis (`**a *b* c**`) came out mangled, `***bold italic***` kept stray
// asterisks, underscore emphasis and images were not recognised at all, a lone
// `*` used as a multiplication sign turned into spurious italics, and
// multi-backtick code spans broke apart. Running the cell through the very same
// parser the editor already uses for the document removes that whole class of
// divergence by construction: whatever the parser says the markup is, is what
// gets drawn.
// A cell/label is inline content: an unfinished fence is literal text, not a
// block that may swallow the rest of the value while the user is typing.
// Reference definitions and indentation likewise must not open block constructs.
const cellParser = baseMarkdownParser.configure([Table, TaskList, Strikethrough, Autolink, {
	remove: ['FencedCode', 'IndentedCode', 'LinkReference', 'HTMLBlock'],
}]);

/** Inline nodes rendered as a wrapper element around their own children. */
const WRAPPER_TAGS: Record<string, { tag: string; className: string }> = {
	StrongEmphasis: { tag: 'strong', className: 'mlp-strong' },
	Emphasis: { tag: 'em', className: 'mlp-em' },
	Strikethrough: { tag: 'del', className: 'mlp-strikethrough' },
};

/** Marker nodes that are syntax only and must not reach the rendered output. */
const MARK_NODES = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark', 'LinkTitle', 'CodeInfo']);

// HTML numeric-reference compatibility replacements; decode to text, never HTML.
// https://html.spec.whatwg.org/multipage/parsing.html#numeric-character-reference-end-state
const NUMERIC_REFERENCE_REPLACEMENTS: Readonly<Record<number, number>> = {
	0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
	0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
	0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
	0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
	0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
	0x9e: 0x017e, 0x9f: 0x0178,
};

function appendText(parent: HTMLElement, text: string): void {
	if (text) parent.appendChild(document.createTextNode(text));
}

/**
 * CommonMark lets a backslash escape any ASCII punctuation; only the escaped
 * character itself is rendered. The parser reports such a pair as an `Escape`
 * node, but the literal runs *between* nodes are handed back as raw source, so
 * they need the same treatment applied by hand.
 */
function unescapePunctuation(text: string): string {
	return text.replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

export interface CellInlineHooks {
	/** GFM table cells decode escaped pipes even inside literal code spans. */
	inTableCell?: boolean;
	/** Resolves an image's `src` for display (webview base-URI rewriting). */
	resolveImageSrc: (src: string) => string | undefined;
	/** Asks the host to authorize a local image after canonical containment checks. */
	resolveImageSrcAsync?: (src: string) => Promise<string | undefined>;
	/** Re-bases a link for contexts such as embedded notes. */
	resolveLinkHref?: (href: string) => string | undefined;
}

/** Internal text-only pass: image descriptions must never request resources. */
interface InlineRenderHooks extends CellInlineHooks { imageDescription?: number }

/** Consume escapes and references together so an escaped ampersand stays literal. */
function decodeTitle(source: string): string {
	return source.replace(/\\([!-/:-@[-`{-~])|&(?:#(?:x[\da-f]+|\d+)|[a-z][\da-z]+);/gi,
		(token, escaped: string | undefined) => escaped ?? decodeHTMLStrict(token));
}

/** The `[label](url "title")` pieces of a Link/Image node. */
function readLinkParts(node: SyntaxNode, src: string): { label: string; url: string; title: string } {
	let url = '';
	let title = '';
	const marks: SyntaxNode[] = [];
	for (let c = node.firstChild; c; c = c.nextSibling) {
		if (c.name === 'URL') url = markdownDestination(src.slice(c.from, c.to));
		// Attribute assignment keeps decoded text inert; never parse it as HTML.
		else if (c.name === 'LinkTitle') title = decodeTitle(src.slice(c.from + 1, c.to - 1));
		else if (c.name === 'LinkMark') marks.push(c);
	}
	// The label is everything between the opening "[" (or "![") and its matching
	// "]" — both are LinkMark nodes, so it is the span between the first two.
	const label = marks.length >= 2 ? src.slice(marks[0].to, marks[1].from) : '';
	return { label, url, title };
}

/**
 * Renders the children of an inline container into `parent`, filling the gaps
 * between recognised children with their literal text.
 */
function renderChildren(parent: HTMLElement, node: SyntaxNode, src: string, hooks: InlineRenderHooks, literalReference = false): void {
	let pos = node.from;
	for (let child = node.firstChild; child; child = child.nextSibling) {
		if (child.from > pos) appendText(parent, unescapePunctuation(src.slice(pos, child.from)));
		if (literalReference && (child.name === 'LinkMark' || child.name === 'LinkLabel')) {
			appendText(parent, unescapePunctuation(src.slice(child.from, child.to)));
		} else renderNode(parent, child, src, hooks);
		pos = child.to;
	}
	if (pos < node.to) appendText(parent, unescapePunctuation(src.slice(pos, node.to)));
}

function renderNode(parent: HTMLElement, node: SyntaxNode, src: string, hooks: InlineRenderHooks): void {
	const name = node.name;

	// Syntax-only markers contribute nothing on their own; the node owning them
	// already renders whatever they delimit.
	if (MARK_NODES.has(name)) return;

	const wrapper = WRAPPER_TAGS[name];
	if (wrapper) {
		const el = document.createElement(wrapper.tag);
		el.className = wrapper.className;
		renderChildren(el, node, src, hooks);
		parent.appendChild(el);
		return;
	}
	// The inline parser also reports unresolved reference syntax as Link/Image.
	// Keep its brackets and formatting instead of inventing an empty destination.
	// Four direct marks distinguish an explicit empty destination, e.g. [text]().
	if ((name === 'Link' || name === 'Image') && !node.getChild('URL') && node.getChildren('LinkMark').length < 4) {
		renderChildren(parent, node, src, hooks, true);
		return;
	}

	switch (name) {
		case 'HardBreak':
			// Only parser-confirmed Markdown breaks become DOM; code stays literal.
			parent.appendChild(document.createElement('br'));
			return;
		case 'Entity': {
			// Numeric references preserve spreadsheet boundary whitespace without
			// feeding clipboard/source text to an HTML parser. Decode to a text
			// node only; a decoded '<' can never become markup or a resource.
			const raw = src.slice(node.from, node.to);
			const match = /^&#(x[\da-f]+|\d+);$/i.exec(raw);
			if (match) {
				const original = /^x/i.test(match[1]) ? parseInt(match[1].slice(1), 16) : Number(match[1]);
				const point = NUMERIC_REFERENCE_REPLACEMENTS[original] ?? original;
				appendText(parent, point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
					? String.fromCodePoint(point) : '\ufffd');
			// Decode only parser-confirmed, semicolon-terminated references once.
			// The result is a text node, never HTML or another Markdown parse.
			} else appendText(parent, decodeHTMLStrict(raw));
			return;
		}
		case 'InlineCode': {
			// The two CodeMark children delimit the literal run; everything between
			// them is code text, backticks of a shorter run included.
			const marks: SyntaxNode[] = [];
			for (let c = node.firstChild; c; c = c.nextSibling) {
				if (c.name === 'CodeMark') marks.push(c);
			}
			const code = document.createElement('code');
			code.className = 'mlp-inline-code';
			code.textContent = marks.length >= 2 ? src.slice(marks[0].to, marks[1].from) : src.slice(node.from, node.to);
			// CommonMark folds line endings and removes one paired padding space,
			// except when the code consists entirely of spaces. Keep markup literal.
			code.textContent = code.textContent.replace(/\r\n?|\n/g, ' ');
			if (code.textContent.startsWith(' ') && code.textContent.endsWith(' ') && /[^ ]/.test(code.textContent)) {
				code.textContent = code.textContent.slice(1, -1);
			}
			if (hooks.inTableCell) code.textContent = code.textContent.replace(/\\\|/g, '|');
			parent.appendChild(code);
			return;
		}
		case 'Image': {
			const { label, url, title } = readLinkParts(node, src);
			if (hooks.imageDescription) {
				// Pathological nesting falls back to inert text rather than growing the stack.
				if (hooks.imageDescription >= 32) appendText(parent, label);
				else renderInlineInto(parent, label, { ...hooks, imageDescription: hooks.imageDescription + 1 } as InlineRenderHooks);
				return;
			}
			const img = document.createElement('img');
			img.className = 'mlp-image mlp-table-image';
			const resolved = hooks.resolveImageSrc(url);
			if (resolved) img.src = resolved;
			else {
				img.classList.add('mlp-image-blocked');
				if (hooks.resolveImageSrcAsync) {
					void hooks.resolveImageSrcAsync(url).then((uri) => {
						if (!uri) return;
						img.src = uri;
						img.classList.remove('mlp-image-blocked');
					}).catch(() => undefined);
				}
			}
			const description = document.createElement('span');
			const descriptionHooks: InlineRenderHooks = { resolveImageSrc: () => undefined, imageDescription: 1, inTableCell: hooks.inTableCell };
			renderInlineInto(description, label, descriptionHooks);
			img.alt = description.textContent ?? '';
			if (title) img.title = title;
			parent.appendChild(img);
			return;
		}
		case 'Link': {
			const { label, url, title } = readLinkParts(node, src);
			const a = document.createElement('a');
			a.className = 'mlp-link';
			const href = hooks.resolveLinkHref ? hooks.resolveLinkHref(url) : url;
			if (href) {
				// Store an inert target; the host authorizes navigation through the shared click handler.
				a.setAttribute('data-href', href);
				a.setAttribute('role', 'link');
				a.setAttribute('tabindex', '0');
			}
			else { a.classList.add('mlp-link-blocked'); a.setAttribute('aria-disabled', 'true'); }
			if (title) a.title = title;
			// A link label is itself inline markup ("[**bold** label](u)"), so
			// render it rather than assigning it as text.
			renderInlineInto(a, label, hooks);
			parent.appendChild(a);
			return;
		}
		case 'Autolink':
		case 'URL': {
			// A bare or angle-bracketed URL the Autolink extension promoted.
			const text = src.slice(node.from, node.to);
			const label = text.replace(/^<|>$/g, '');
			// The parser recognizes email/www forms without an authored scheme.
			// Preserve explicit schemes for the existing authorization boundary.
			const href = /^[a-z][a-z0-9+.-]*:/i.test(label) ? label
				: /^www\./i.test(label) ? `https://${label}`
					: label.includes('@') ? `mailto:${label}` : label;
			const a = document.createElement('a');
			a.className = 'mlp-link';
			const resolved = hooks.resolveLinkHref ? hooks.resolveLinkHref(href) : href;
			if (resolved) {
				a.setAttribute('data-href', resolved);
				a.setAttribute('role', 'link');
				a.setAttribute('tabindex', '0');
			}
			else { a.classList.add('mlp-link-blocked'); a.setAttribute('aria-disabled', 'true'); }
			a.textContent = label;
			parent.appendChild(a);
			return;
		}
		case 'HTMLTag': {
			if (hooks.imageDescription) return;
			const tag = src.slice(node.from, node.to);
			// A bare <br> is a common, Obsidian-compatible way to put multiple
			// lines in a GFM table cell. Construct the element ourselves; never
			// parse source as HTML. Attributes and every other tag stay inert text.
			if (/^<br\s*\/?\s*>$/i.test(tag)) parent.appendChild(document.createElement('br'));
			else appendText(parent, tag);
			return;
		}
		case 'Escape': {
			appendText(parent, unescapePunctuation(src.slice(node.from, node.to)));
			return;
		}
		default: {
			// Structural containers (Document, Paragraph) and anything not modelled
			// specially: descend when there are children, else emit literal text.
			if (node.firstChild) renderChildren(parent, node, src, hooks);
			else appendText(parent, unescapePunctuation(src.slice(node.from, node.to)));
			return;
		}
	}
}

/** Unwraps the Paragraph a single-line cell's inline content sits in. */
function inlineRoot(tree: Tree): SyntaxNode {
	const top = tree.topNode;
	const first = top.firstChild;
	return first && first.name === 'Paragraph' && !first.nextSibling ? first : top;
}

/**
 * Renders `text` — the raw source of one table cell — as inline Markdown into
 * `parent`, following the same rules the editor applies to the document body.
 */
export function renderInlineInto(parent: HTMLElement, text: string, hooks: CellInlineHooks): void {
	if (!text) return;
	renderChildren(parent, inlineRoot(cellParser.parse(text)), text, hooks);
}

/** Render safe list structure only at a table-cell root, never in link labels. */
export function renderTableCellInto(parent: HTMLElement, text: string, hooks: CellInlineHooks): void {
	const cellHooks = { ...hooks, inTableCell: true };
	const parts = parseTableCellLists(text);
	if (!parts) { renderInlineInto(parent, text, cellHooks); return; }
	const append = (container: HTMLElement, part: CellListPart): void => {
		if (typeof part === 'string') {
			// A fragment following a list is still inline content, not paragraph
			// indentation. Preserve its whitespace before parsing the remainder.
			const leading = /^[\t\n\r ]*/.exec(part)![0];
			appendText(container, leading);
			renderInlineInto(container, part.slice(leading.length), cellHooks);
			return;
		}
		const element = document.createElement(part.tag);
		if (part.tag === 'li') element.className = 'mlp-cell-list-item';
		else if (part.tag === 'ul' || part.tag === 'ol') element.className = 'mlp-cell-list';
		for (const child of part.children) append(element, child);
		container.appendChild(element);
	};
	for (const part of parts) append(parent, part);
}
