import { parser as baseMarkdownParser, Table, TaskList, Strikethrough, Autolink } from '@lezer/markdown';
import type { SyntaxNode, Tree } from '@lezer/common';

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
const cellParser = baseMarkdownParser.configure([Table, TaskList, Strikethrough, Autolink]);

/** Inline nodes rendered as a wrapper element around their own children. */
const WRAPPER_TAGS: Record<string, { tag: string; className: string }> = {
	StrongEmphasis: { tag: 'strong', className: 'mlp-strong' },
	Emphasis: { tag: 'em', className: 'mlp-em' },
	Strikethrough: { tag: 'del', className: 'mlp-strikethrough' },
};

/** Marker nodes that are syntax only and must not reach the rendered output. */
const MARK_NODES = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark', 'LinkTitle', 'CodeInfo']);

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

/** The `[label](url "title")` pieces of a Link/Image node. */
function readLinkParts(node: SyntaxNode, src: string): { label: string; url: string; title: string } {
	let url = '';
	let title = '';
	const marks: SyntaxNode[] = [];
	for (let c = node.firstChild; c; c = c.nextSibling) {
		if (c.name === 'URL') url = unescapePunctuation(src.slice(c.from, c.to));
		else if (c.name === 'LinkTitle') title = src.slice(c.from + 1, c.to - 1);
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
function renderChildren(parent: HTMLElement, node: SyntaxNode, src: string, hooks: CellInlineHooks): void {
	let pos = node.from;
	for (let child = node.firstChild; child; child = child.nextSibling) {
		if (child.from > pos) appendText(parent, unescapePunctuation(src.slice(pos, child.from)));
		renderNode(parent, child, src, hooks);
		pos = child.to;
	}
	if (pos < node.to) appendText(parent, unescapePunctuation(src.slice(pos, node.to)));
}

function renderNode(parent: HTMLElement, node: SyntaxNode, src: string, hooks: CellInlineHooks): void {
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

	switch (name) {
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
			if (hooks.inTableCell) code.textContent = code.textContent.replace(/\\\|/g, '|');
			parent.appendChild(code);
			return;
		}
		case 'Image': {
			const { label, url, title } = readLinkParts(node, src);
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
			img.alt = label;
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
			const href = text.replace(/^<|>$/g, '');
			const a = document.createElement('a');
			a.className = 'mlp-link';
			const resolved = hooks.resolveLinkHref ? hooks.resolveLinkHref(href) : href;
			if (resolved) {
				a.setAttribute('data-href', resolved);
				a.setAttribute('role', 'link');
				a.setAttribute('tabindex', '0');
			}
			else { a.classList.add('mlp-link-blocked'); a.setAttribute('aria-disabled', 'true'); }
			a.textContent = href;
			parent.appendChild(a);
			return;
		}
		case 'HTMLTag': {
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
