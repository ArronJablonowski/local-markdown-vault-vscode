import DOMPurify from 'dompurify';

// Formatting only: no URLs, CSS, custom attributes, active content, or namespaces.
const TAGS = ['p', 'div', 'span', 'br', 'hr', 'strong', 'b', 'em', 'i', 's', 'del', 'u',
	'mark', 'sub', 'sup', 'kbd', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
	'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
	'caption', 'details', 'summary'];
export const MAX_HTML_CHARACTERS = 100_000;
const OPTIONAL_END = new Set(['p', 'li', 'td', 'th', 'tr', 'thead', 'tbody', 'tfoot']);
// Formatting subset of https://html.spec.whatwg.org/multipage/syntax.html#optional-tags.
const CLOSE_PARAGRAPH = new Set(['p', 'div', 'blockquote', 'ul', 'ol', 'pre', 'table', 'hr', 'details',
	'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Conservative preflight, not a sanitizer: reject parser work before DOM creation. */
export function htmlExceedsParseBudget(source: string): boolean {
	const stack: string[] = [];
	const closeOptional = (names: readonly string[]) => {
		while (names.includes(stack[stack.length - 1])) stack.pop();
	};
	let tokens = 0;
	for (const match of source.matchAll(/<\s*(\/?)\s*([a-z][\w:-]*)\b[^>]*>/gi)) {
		if (++tokens > 4_000) return true;
		const tag = match[2].toLowerCase();
		if (match[1]) {
			// HTML permits omitted end tags for list items, cells, rows, and
			// paragraphs. Account for those without repairing arbitrary nesting.
			while (stack[stack.length - 1] !== tag && OPTIONAL_END.has(stack[stack.length - 1])) stack.pop();
			if (stack.pop() !== tag) return true;
		} else if (!['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'].includes(tag)) {
			if (CLOSE_PARAGRAPH.has(tag)) closeOptional(['p']);
			if (tag === 'li') closeOptional(['p', 'li']);
			if (tag === 'td' || tag === 'th') closeOptional(['p', 'td', 'th']);
			if (tag === 'tr') closeOptional(['p', 'td', 'th', 'tr']);
			if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') closeOptional(['p', 'td', 'th', 'tr', 'thead', 'tbody', 'tfoot']);
			stack.push(tag);
			if (stack.length > 64) return true;
		}
	}
	return false;
}

/** Parse only in the sanitizer's inert document; never mount untrusted markup. */
export function renderSafeHtml(parent: HTMLElement, source: string): void {
	if (source.length > MAX_HTML_CHARACTERS || htmlExceedsParseBudget(source)) { parent.textContent = source; return; }
	let fragment: DocumentFragment;
	try { fragment = DOMPurify.sanitize(source, {
		ALLOWED_TAGS: TAGS,
		ALLOWED_ATTR: [],
		ALLOW_DATA_ATTR: false,
		ALLOW_ARIA_ATTR: false,
		FORBID_TAGS: ['script', 'style', 'svg', 'math', 'template', 'iframe', 'object', 'embed', 'form', 'input'],
		RETURN_DOM_FRAGMENT: true,
	}); } catch { parent.textContent = source; return; }
	// Bound mounted DOM complexity even for small, deeply nested input.
	if (!fragment.hasChildNodes() || fragment.querySelectorAll('*').length > 2_000) { parent.textContent = source; return; }
	parent.appendChild(fragment);
}
