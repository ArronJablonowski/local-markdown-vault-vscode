import DOMPurify from 'dompurify';

// Formatting only: no URLs, CSS, custom attributes, active content, or namespaces.
const TAGS = ['p', 'div', 'span', 'br', 'hr', 'strong', 'b', 'em', 'i', 's', 'del', 'u',
	'mark', 'sub', 'sup', 'kbd', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
	'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
	'caption', 'details', 'summary'];
export const MAX_HTML_CHARACTERS = 100_000;

/** Conservative preflight, not a sanitizer: reject parser work before DOM creation. */
function exceedsParseBudget(source: string): boolean {
	const stack: string[] = [];
	let tokens = 0;
	for (const match of source.matchAll(/<\s*(\/?)\s*([a-z][\w:-]*)\b[^>]*>/gi)) {
		if (++tokens > 4_000) return true;
		const tag = match[2].toLowerCase();
		if (match[1]) {
			if (stack.pop() !== tag) return true;
		} else if (!['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'].includes(tag)) {
			stack.push(tag);
			if (stack.length > 64) return true;
		}
	}
	return false;
}

/** Parse only in the sanitizer's inert document; never mount untrusted markup. */
export function renderSafeHtml(parent: HTMLElement, source: string): void {
	if (source.length > MAX_HTML_CHARACTERS || exceedsParseBudget(source)) { parent.textContent = source; return; }
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
