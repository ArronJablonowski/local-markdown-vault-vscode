import DOMPurify from 'dompurify';

// Formatting only: no URLs, CSS, custom attributes, active content, or namespaces.
const TAGS = ['p', 'div', 'span', 'br', 'hr', 'strong', 'b', 'em', 'i', 's', 'del', 'u',
	'mark', 'sub', 'sup', 'kbd', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
	'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
	'caption', 'details', 'summary'];
export const MAX_HTML_CHARACTERS = 100_000;

/** Parse only in the sanitizer's inert document; never mount untrusted markup. */
export function renderSafeHtml(parent: HTMLElement, source: string): void {
	if (source.length > MAX_HTML_CHARACTERS) { parent.textContent = source; return; }
	const fragment = DOMPurify.sanitize(source, {
		ALLOWED_TAGS: TAGS,
		ALLOWED_ATTR: [],
		ALLOW_DATA_ATTR: false,
		ALLOW_ARIA_ATTR: false,
		FORBID_TAGS: ['script', 'style', 'svg', 'math', 'template', 'iframe', 'object', 'embed', 'form', 'input'],
		RETURN_DOM_FRAGMENT: true,
	});
	// Bound mounted DOM complexity even for small, deeply nested input.
	if (!fragment.hasChildNodes() || fragment.querySelectorAll('*').length > 2_000) { parent.textContent = source; return; }
	parent.appendChild(fragment);
}
