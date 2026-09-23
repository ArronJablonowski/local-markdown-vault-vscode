import { StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import katex from 'katex';
import DOMPurify from 'dompurify';
import { cursorTouchesRange } from './cmUtils';
import { t } from '../shared/i18n';
import { syntaxTree } from '@codemirror/language';
import { containingCallouts, toggleCallout } from './calloutState';

const MAX_INLINE_MATH_CHARS = 8 * 1024;
const MAX_BLOCK_MATH_CHARS = 64 * 1024;
const MAX_MATH_EXPRESSIONS = 1_000;

export interface MathRange {
	from: number;
	to: number;
	source: string;
	display: boolean;
}

export function findMathRanges(text: string): MathRange[] {
	const ignored = codeRanges(text);
	const ranges: MathRange[] = [];
	const blockPattern = /^[ \t]*\$\$[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\$\$[ \t]*$/gm;
	for (const match of text.matchAll(blockPattern)) {
		const from = match.index ?? 0;
		if (inside(from, ignored) || match[1].length > MAX_BLOCK_MATH_CHARS) continue;
		ranges.push({ from, to: from + match[0].length, source: match[1], display: true });
		if (ranges.length >= MAX_MATH_EXPRESSIONS) return ranges;
	}
	const blockRanges = ranges.map(({ from, to }) => [from, to] as const);
	const quotedBlocks = /^([ \t]*(?:>[ \t]?)+)\$\$[ \t]*\r?\n([\s\S]*?)\r?\n\1\$\$[ \t]*$/gm;
	for (const match of text.matchAll(quotedBlocks)) {
		const from = match.index ?? 0;
		if (inside(from, ignored) || match[2].length > MAX_BLOCK_MATH_CHARS) continue;
		const lines = match[2].split(/\r?\n/);
		if (!lines.every(line => line.startsWith(match[1]))) continue;
		const to = from + match[0].length;
		ranges.push({ from, to, source: lines.map(line => line.slice(match[1].length)).join('\n'), display: true });
		blockRanges.push([from, to]);
		if (ranges.length >= MAX_MATH_EXPRESSIONS) return ranges;
	}
	for (const range of findInlineMathRanges(text)) {
		if (inside(range.from, ignored) || inside(range.from, blockRanges)) continue;
		ranges.push(range);
		if (ranges.length >= MAX_MATH_EXPRESSIONS) break;
	}
	return ranges.sort((a, b) => a.from - b.from);
}

/**
 * Finds inline dollar spans in one pass. Keeping this scanner linear prevents a
 * long run of escaped characters with no valid closer from becoming a ReDoS
 * input to the editor's render-on-every-change path.
 */
function findInlineMathRanges(text: string): MathRange[] {
	const ranges: MathRange[] = [];
	let i = 0;
	while (i < text.length && ranges.length < MAX_MATH_EXPRESSIONS) {
		if (
			text[i] !== '$' ||
			(i > 0 && (text[i - 1] === '\\' || text[i - 1] === '$')) ||
			text[i + 1] === '$' ||
			text[i + 1] === undefined ||
			/\s/.test(text[i + 1])
		) {
			i++;
			continue;
		}

		const from = i;
		let cursor = i + 1;
		while (cursor < text.length && text[cursor] !== '\n' && text[cursor] !== '\r') {
			if (text[cursor] === '\\') {
				cursor += Math.min(2, text.length - cursor);
				continue;
			}
			if (text[cursor] === '$') break;
			cursor++;
		}

		if (text[cursor] === '$') {
			const source = text.slice(from + 1, cursor);
			// A dollar immediately before a digit starts a price, not a math
			// closer: "$75–$85" must remain literal. Numeric math like "$2$"
			// remains valid because its closing dollar is not followed by a digit.
			const validCloser = (
				text[cursor + 1] !== '$' &&
				!/[0-9]/.test(text[cursor + 1] ?? '') &&
				source.length <= MAX_INLINE_MATH_CHARS &&
				source.length > 0 &&
				!/^\s|\s$/.test(source)
			);
			if (validCloser) {
				ranges.push({ from, to: cursor + 1, source, display: false });
			}
			// An invalid closer may be the opener of real math later on the
			// same line. Reconsider it without rescanning the rejected span.
			i = validCloser ? cursor + 1 : cursor;
		} else {
			i = from + 1;
		}
	}
	return ranges;
}

class MathWidget extends WidgetType {
	constructor(private readonly source: string, private readonly display: boolean, private readonly calloutType?: string) { super(); }
	eq(other: MathWidget): boolean { return this.source === other.source && this.display === other.display && this.calloutType === other.calloutType; }
	toDOM(): HTMLElement {
		const container = document.createElement(this.display ? 'div' : 'span');
		container.className = this.display ? 'mlp-math mlp-math-block' : 'mlp-math mlp-math-inline';
		if (this.display && this.calloutType) container.classList.add('mlp-callout-block', 'mlp-line-callout', `mlp-callout-${this.calloutType}`);
		try {
			const generated = katex.renderToString(this.source, {
				displayMode: this.display,
				output: 'mathml',
				throwOnError: true,
				strict: 'error',
				trust: false,
				maxExpand: 1_000,
				maxSize: 20,
			});
			container.innerHTML = DOMPurify.sanitize(generated, {
				USE_PROFILES: { mathMl: true },
				FORBID_TAGS: ['annotation', 'script', 'style'],
				FORBID_ATTR: ['href', 'src', 'style'],
			});
		} catch {
			container.classList.add('mlp-math-error');
			container.textContent = t('math.invalid');
			container.setAttribute('role', 'status');
		}
		return container;
	}
}

const mathRangeCache = new WeakMap<EditorState, MathRange[]>();
export function renderableMathRanges(state: EditorState): MathRange[] {
	const cached = mathRangeCache.get(state);
	if (cached) return cached;
	const ranges = findMathRanges(state.doc.toString()).filter(range => {
		if (cursorTouchesRange(state, range.from, range.to)) return false;
		const node = syntaxTree(state).resolveInner(range.from, 1);
		if (containingCallouts(state, node).some(callout => callout.collapsed)) return false;
		for (let ancestor: typeof node | null = node; ancestor; ancestor = ancestor.parent) {
			if (['FencedCode', 'CodeBlock', 'InlineCode', 'Table'].includes(ancestor.name)) return false;
		}
		return true;
	});
	mathRangeCache.set(state, ranges);
	return ranges;
}

function buildMathDecorations(state: EditorState): DecorationSet {
	const decorations: Range<Decoration>[] = [];
	for (const range of renderableMathRanges(state)) {
		const context = containingCallouts(state, syntaxTree(state).resolveInner(range.from, 1))[0];
		decorations.push(Decoration.replace({
			widget: new MathWidget(range.source, range.display, context?.type),
			...(range.display ? { block: true } : {}),
		}).range(range.from, range.to));
	}
	return Decoration.set(decorations, true);
}

export const mathDecorationsField = StateField.define<DecorationSet>({
	create: buildMathDecorations,
	update(value, transaction) {
		return transaction.docChanged || transaction.selection || transaction.effects.some(effect => effect.is(toggleCallout)) ? buildMathDecorations(transaction.state) : value;
	},
	provide: (field) => EditorView.decorations.from(field),
});

function codeRanges(text: string): Array<readonly [number, number]> {
	const ranges: Array<readonly [number, number]> = [];
	let fenceStart = -1;
	let fenceMarker = '';
	let offset = 0;
	for (const line of text.split(/(?<=\n)/)) {
		const marker = /^[ \t]*(?:>[ \t]?)*(`{3,}|~{3,})/.exec(line)?.[1];
		if (marker && fenceStart < 0) { fenceStart = offset; fenceMarker = marker[0]; }
		else if (marker && fenceStart >= 0 && marker[0] === fenceMarker) {
			ranges.push([fenceStart, offset + line.length]);
			fenceStart = -1;
		}
		if (fenceStart < 0) {
			for (const code of line.matchAll(/`+[^`\n]*`+/g)) {
				ranges.push([offset + (code.index ?? 0), offset + (code.index ?? 0) + code[0].length]);
			}
		}
		offset += line.length;
	}
	if (fenceStart >= 0) ranges.push([fenceStart, text.length]);
	return ranges;
}

function inside(position: number, ranges: readonly (readonly [number, number])[]): boolean {
	return ranges.some(([from, to]) => position >= from && position < to);
}
