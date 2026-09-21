export interface ParsedCallout {
	type: string;
	title: string;
	collapsed: boolean;
	markerOffset: number;
}

const TYPE_ALIASES: Record<string, string> = {
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
