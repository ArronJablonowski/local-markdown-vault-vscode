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

// Renderer output is data, not trusted markup. Keep this list deliberately
// limited to the static SVG vocabulary emitted by Mermaid and the bundled
// draw.io renderer. Unknown/future elements stay inert until reviewed here.
const ALLOWED_SVG_ELEMENTS = new Set([
	'a', 'circle', 'clippath', 'defs', 'desc', 'ellipse', 'filter', 'g',
	'line', 'lineargradient', 'marker', 'mask', 'path', 'pattern', 'polygon',
	'polyline', 'radialgradient', 'rect', 'stop', 'style', 'svg', 'symbol',
	'text', 'textpath', 'title', 'tspan', 'use',
	'feblend', 'fecolormatrix', 'fecomponenttransfer', 'fecomposite',
	'feconvolvematrix', 'fediffuselighting', 'fedisplacementmap',
	'fedistantlight', 'fedropshadow', 'feflood', 'fefunca', 'fefuncb',
	'fefuncg', 'fefuncr', 'fegaussianblur', 'femerge', 'femergenode',
	'femorphology', 'feoffset', 'fepointlight', 'fespecularlighting',
	'fespotlight', 'fetile', 'feturbulence',
]);

// Names are compared case-insensitively because XML preserves SVG camel-case
// spellings while the security decision does not depend on spelling.
const ALLOWED_SVG_ATTRIBUTES = new Set([
	'alignment-baseline', 'amplitude', 'azimuth', 'basefrequency', 'bias',
	'by', 'class', 'clip-path', 'clip-rule', 'clippathunits', 'color',
	'color-interpolation', 'color-interpolation-filters', 'cx', 'cy', 'd',
	'diffuseconstant', 'direction', 'display', 'divisor', 'dominant-baseline',
	'dx', 'dy', 'edgemode', 'elevation', 'exponent', 'fill', 'fill-opacity',
	'fill-rule', 'filter', 'filterunits', 'flood-color', 'flood-opacity',
	'font-family', 'font-size', 'font-stretch', 'font-style', 'font-variant',
	'font-weight', 'fr', 'from', 'fx', 'fy', 'gradienttransform',
	'gradientunits', 'height', 'id', 'in', 'in2', 'intercept', 'k1', 'k2',
	'k3', 'k4', 'kernelmatrix', 'kernelunitlength', 'letter-spacing',
	'lighting-color', 'limitingconeangle', 'marker-end', 'marker-mid',
	'marker-start', 'markerheight', 'markerunits', 'markerwidth', 'mask',
	'maskcontentunits', 'mask-type', 'maskunits', 'mode', 'numoctaves',
	'offset', 'opacity', 'operator', 'order', 'orient', 'overflow',
	'paint-order', 'pathlength', 'patterncontentunits', 'patterntransform',
	'patternunits', 'points', 'pointsatx', 'pointsaty', 'pointsatz',
	'pointer-events', 'preservealpha', 'preserveaspectratio', 'primitiveunits',
	'r', 'radius', 'refx', 'refy', 'result', 'role', 'rotate', 'rx', 'ry',
	'scale', 'seed', 'shape-rendering', 'slope', 'spacing', 'specularconstant',
	'specularexponent', 'spreadmethod', 'stddeviation', 'stitchtiles',
	'stop-color', 'stop-opacity', 'stroke', 'stroke-dasharray',
	'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin',
	'stroke-miterlimit', 'stroke-opacity', 'stroke-width', 'style', 'surfacescale',
	'tabindex', 'tablevalues', 'targetx', 'targety', 'text-anchor',
	'text-decoration', 'text-rendering', 'textlength', 'to', 'transform',
	'type', 'values', 'vector-effect', 'viewbox', 'visibility', 'width',
	'word-spacing', 'writing-mode', 'x', 'x1', 'x2', 'xchannelselector',
	'y', 'y1', 'y2', 'ychannelselector', 'z',
]);

const URL_ATTRIBUTES = new Set(['href', 'xlink:href', 'src']);
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';

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
	const edges = countMermaidEdgeTokens(source);
	if (edges > MAX_MERMAID_EDGES) {
		throw new DiagramLimitError(t('diagram.mermaidEdgeLimit'));
	}
}

/** Linear lexical edge count that avoids running an ambiguous regexp on input. */
function countMermaidEdgeTokens(source: string): number {
	let count = 0;
	let i = 0;
	while (i < source.length) {
		const start = i;
		if (source[i] === '<' && (source[i + 1] === '-' || source[i + 1] === '=')) i++;
		const marker = source[i];
		if (marker !== '-' && marker !== '=' && marker !== '.') {
			i = start + 1;
			continue;
		}

		let runEnd = i;
		while (source[runEnd] === marker) runEnd++;
		const runLength = runEnd - i;
		let matched = false;
		if (start !== i) {
			matched = runLength >= 2;
		} else if (marker === '-' && runLength >= 2) {
			matched = source[runEnd] === '>' || source[runEnd] === 'o' || source[runEnd] === 'x';
		} else if (marker === '=' && runLength >= 2) {
			matched = source[runEnd] === '>';
		} else if (marker === '-' && runLength === 1 && source[runEnd] === '.') {
			let dotEnd = runEnd;
			while (source[dotEnd] === '.') dotEnd++;
			matched = source[dotEnd] === '-' && source[dotEnd + 1] === '>';
			if (matched) runEnd = dotEnd + 1;
		}
		if (matched) {
			count++;
			if (count > MAX_MERMAID_EDGES) return count;
			i = Math.max(runEnd + 1, start + 1);
		} else {
			i = start + 1;
		}
	}
	return count;
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
		const elementName = element.localName.toLowerCase();
		if (element !== root && (FORBIDDEN_SVG_ELEMENTS.has(elementName) || !ALLOWED_SVG_ELEMENTS.has(elementName))) {
			element.remove();
			continue;
		}
		for (const attribute of Array.from(element.attributes)) {
			const name = attribute.name.toLowerCase();
			const localName = attribute.localName.toLowerCase();
			const value = attribute.value.trim();
			const decodedValue = decodeCssForSecurity(value);
			if (
				name.startsWith('on') ||
				name === 'srcdoc' ||
				// A fragment-only `href="#shape"` is safe only when the SVG
				// cannot redefine its base URI. XML Base would otherwise turn an
				// apparently local reference into a remote renderer dependency.
				name === 'xml:base' ||
				(attribute.namespaceURI === XML_NAMESPACE && attribute.localName.toLowerCase() === 'base') ||
				// Namespace prefixes are attacker-controlled. Test the local name
				// too so an alias such as `evil:href` bound to XLink cannot evade
				// external-resource removal.
				((URL_ATTRIBUTES.has(name) || URL_ATTRIBUTES.has(localName)) && !value.startsWith('#')) ||
				!isAllowedSvgAttribute(attribute) ||
				(/url\s*\(/i.test(decodedValue) && !/^url\(#[A-Za-z0-9_.:-]+\)$/i.test(decodedValue)) ||
				(name === 'style' && unsafeSvgCss(decodedValue, false))
			) {
				if (attribute.namespaceURI) {
					element.removeAttributeNS(attribute.namespaceURI, attribute.localName);
				} else {
					element.removeAttribute(attribute.name);
				}
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

function isAllowedSvgAttribute(attribute: Attr): boolean {
	const name = attribute.name.toLowerCase();
	const localName = attribute.localName.toLowerCase();
	if (attribute.namespaceURI === XMLNS_NAMESPACE) return true;
	if (attribute.namespaceURI === XML_NAMESPACE) return localName === 'lang' || localName === 'space';
	if (name.startsWith('aria-') || name.startsWith('data-')) return true;
	if (URL_ATTRIBUTES.has(name) || URL_ATTRIBUTES.has(localName)) return true;
	return ALLOWED_SVG_ATTRIBUTES.has(name) || ALLOWED_SVG_ATTRIBUTES.has(localName);
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
