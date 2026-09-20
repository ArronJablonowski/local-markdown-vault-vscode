import { t } from '../shared/i18n';
import { decodeCssForSecurity } from '../shared/cssAdapter';

/** Security and resource limits shared by Mermaid and draw.io rendering. */
export const MAX_MERMAID_CHARACTERS = 100 * 1024;
export const MAX_MERMAID_LINES = 5_000;
export const MAX_MERMAID_EDGES = 500;
export const MAX_DRAWIO_XML_CHARACTERS = 5 * 1024 * 1024;
export const MAX_DRAWIO_XML_ELEMENTS = 50_000;
export const MAX_DIAGRAM_SVG_CHARACTERS = 2 * 1024 * 1024;
export const MAX_DIAGRAM_SVG_ELEMENTS = 50_000;
export const DIAGRAM_RENDER_TIMEOUT_MS = 2_000;

const FORBIDDEN_SVG_ELEMENTS = new Set([
	'script',
	'foreignobject',
	'iframe',
	'object',
	'embed',
	'image',
	'audio',
	'video',
	'canvas',
	'cursor',
	'discard',
	'feimage',
	'animate',
	'animatemotion',
	'animatetransform',
	'set',
]);

const URL_ATTRIBUTES = new Set(['href', 'xlink:href', 'src']);

export class DiagramLimitError extends Error {}

/** Rejects diagrams large enough to monopolize the webview's main thread. */
export function assertDiagramInputWithinLimits(kind: 'mermaid' | 'drawio', source: string): void {
	if (kind === 'drawio') {
		if (source.length > MAX_DRAWIO_XML_CHARACTERS) {
			throw new DiagramLimitError(t('diagram.drawioInputLimit'));
		}
		return;
	}

	if (source.length > MAX_MERMAID_CHARACTERS) {
		throw new DiagramLimitError(t('diagram.mermaidInputLimit'));
	}
	const lines = source.split(/\r?\n/);
	if (lines.length > MAX_MERMAID_LINES) {
		throw new DiagramLimitError(t('diagram.mermaidLineLimit'));
	}
	// This is intentionally a conservative lexical count. Mermaid has many edge
	// syntaxes; counting arrow-like operators before parsing is cheap and prevents
	// the common generated-graph denial-of-service case without trusting its AST.
	const edges = source.match(/(?:--+>|==+>|-\.+->|--+[ox]|<--+|<==+)/g)?.length ?? 0;
	if (edges > MAX_MERMAID_EDGES) {
		throw new DiagramLimitError(t('diagram.mermaidEdgeLimit'));
	}
}

/**
 * Parses generated SVG in an inert XML document and removes active content
 * before it can enter the live webview DOM. Mermaid strict mode remains the
 * first defense; this is the independent boundary required if a renderer ever
 * regresses or a hostile label reaches its output.
 */
export function sanitizeDiagramSvg(svg: string): SVGElement {
	if (svg.length > MAX_DIAGRAM_SVG_CHARACTERS) {
		throw new DiagramLimitError(t('diagram.svgSizeLimit'));
	}

	const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
	if (parsed.querySelector('parsererror') || parsed.documentElement.localName.toLowerCase() !== 'svg') {
		throw new Error(t('diagram.invalidSvg'));
	}

	const root = parsed.documentElement;
	const elements = [root, ...Array.from(root.querySelectorAll('*'))];
	if (elements.length > MAX_DIAGRAM_SVG_ELEMENTS) {
		throw new DiagramLimitError(t('diagram.svgElementLimit'));
	}
	for (const element of elements) {
		if (element.namespaceURI !== 'http://www.w3.org/2000/svg') {
			element.remove();
			continue;
		}
		if (element !== root && FORBIDDEN_SVG_ELEMENTS.has(element.localName.toLowerCase())) {
			element.remove();
			continue;
		}
		for (const attribute of Array.from(element.attributes)) {
			const name = attribute.name.toLowerCase();
			const value = attribute.value.trim();
			const decodedValue = decodeCssForSecurity(value);
			if (
				name.startsWith('on') ||
				name === 'srcdoc' ||
				(URL_ATTRIBUTES.has(name) && !value.startsWith('#')) ||
				(/url\s*\(/i.test(decodedValue) && !/^url\(#[A-Za-z0-9_.:-]+\)$/i.test(decodedValue)) ||
				(name === 'style' && unsafeSvgCss(decodedValue, false))
			) {
				element.removeAttribute(attribute.name);
			}
		}
		if (element === root) sanitizeSvgViewport(root);
		if (element.localName.toLowerCase() === 'style') {
			const decodedStyle = decodeCssForSecurity(element.textContent ?? '');
			if (unsafeSvgCss(decodedStyle, true)) {
				element.remove();
			}
		}
	}

	return document.importNode(root, true) as unknown as SVGElement;
}

function unsafeSvgCss(decodedCss: string, stylesheet: boolean): boolean {
	return /\b(?:https?|data|file|blob)\s*:|\/\//i.test(decodedCss)
		|| /(?:url\s*\(|@import|expression\s*\(|@(?:font-face|property|keyframes)\b|\banimation(?:-[\w-]+)?\s*:|\btransition(?:-[\w-]+)?\s*:)/i.test(decodedCss)
		|| (stylesheet && /:host(?:-context)?\b|::slotted\b/i.test(decodedCss));
}

function sanitizeSvgViewport(root: Element): void {
	for (const name of ['width', 'height']) {
		const value = root.getAttribute(name);
		if (value !== null && !safeSvgLength(value)) root.removeAttribute(name);
	}
	const viewBox = root.getAttribute('viewBox');
	if (viewBox !== null) {
		const values = viewBox.trim().split(/[\s,]+/).map(Number);
		if (values.length !== 4 || values.some((value) => !Number.isFinite(value) || Math.abs(value) > 1_000_000) || values[2] <= 0 || values[3] <= 0) {
			root.removeAttribute('viewBox');
		}
	}
}

function safeSvgLength(value: string): boolean {
	const match = /^\s*(\d+(?:\.\d+)?|\.\d+)(px|pt|pc|mm|cm|in|em|ex|%)?\s*$/i.exec(value);
	return Boolean(match && Number(match[1]) <= 100_000);
}

/**
 * Places sanitized renderer output in an open shadow root. SVG `<style>` rules
 * can otherwise match the surrounding editor after insertion into the main
 * document. The host is paint-contained with inline-important properties, and
 * the sanitizer rejects the shadow selectors that could style that host.
 */
export function replaceWithIsolatedDiagramSvg(container: HTMLElement, svg: string): SVGElement {
	container.style.setProperty('contain', 'paint', 'important');
	container.style.setProperty('isolation', 'isolate', 'important');
	const shadow = container.shadowRoot ?? container.attachShadow({ mode: 'open' });
	const layout = document.createElement('style');
	layout.textContent = `
		svg { display: block; max-width: none; }
		:host(.mlp-diagram-fit) svg { max-width: 100%; height: auto; margin: 0 auto; }
	`;
	const safeSvg = sanitizeDiagramSvg(svg);
	shadow.replaceChildren(layout, safeSvg);
	return safeSvg;
}
