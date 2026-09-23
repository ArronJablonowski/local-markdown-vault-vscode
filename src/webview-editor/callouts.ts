export interface ParsedCallout {
	type: string;
	title: string;
	collapsed: boolean;
	markerOffset: number;
}

const TYPE_ALIASES: Record<string, string> = {
	notes: 'note',
	summary: 'abstract',
	tldr: 'abstract',
	hint: 'tip',
	important: 'tip',
	check: 'success',
	done: 'success',
	help: 'question',
	faq: 'question',
	caution: 'warning',
	attention: 'warning',
	fail: 'failure',
	missing: 'failure',
	error: 'danger',
	cite: 'quote',
};

const TYPE_ICONS: Readonly<Record<string, string>> = {
	note: '✎',
	abstract: '▤',
	info: 'ⓘ',
	todo: '⊙',
	tip: '♨',
	success: '✓',
	question: '?',
	warning: '⚠',
	failure: '✕',
	danger: '⚡',
	bug: '◉',
	example: '≡',
	quote: '❝',
};

export function calloutIcon(type: string): string {
	return TYPE_ICONS[type] ?? '◆';
}

/** Fixed local geometry only: Markdown never supplies SVG markup or attributes. */
export function createCalloutOutlineIcon(type: string): SVGSVGElement | undefined {
	const paths = type === 'abstract'
		? ['M8 3h8l4 4v14H4V3h4', 'M14 3v6h6', 'M8 13h8', 'M8 17h8']
		: type === 'warning'
			? ['M12 3 2 21h20L12 3Z', 'M12 9v5', 'M12 17v.1']
			: undefined;
	if (!paths) return undefined;
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
		'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) {
		svg.setAttribute(name, value);
	}
	for (const d of paths) {
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', d);
		svg.append(path);
	}
	return svg;
}

/** Parses the callout marker belonging to one particular blockquote depth. */
export function parseCalloutHeader(rawLine: string, blockquoteDepth: number): ParsedCallout | undefined {
	const match = /^[ \t]*((?:>[ \t]*)+)\[!([A-Za-z0-9_-]{1,32})\]([+-])?[ \t]*(.*)$/.exec(rawLine);
	if (!match) return undefined;
	const markerDepth = [...match[1]].filter((character) => character === '>').length;
	if (markerDepth !== blockquoteDepth) return undefined;
	const authoredType = match[2].toLocaleLowerCase();
	const type = TYPE_ALIASES[authoredType] ?? authoredType;
	const title = match[4].trim() || type.charAt(0).toLocaleUpperCase() + type.slice(1);
	return {
		type,
		title,
		collapsed: match[3] === '-',
		markerOffset: rawLine.indexOf('[!'),
	};
}
