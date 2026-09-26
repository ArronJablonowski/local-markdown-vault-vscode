import { syntaxTree } from '@codemirror/language';
import type { EditorState, Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

const TAG_RE = /(^|[\s([>{,;])#([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)/gu;

export function findInlineTags(state: EditorState, from: number, to: number): Array<{ from: number; to: number; tag: string }> {
	const results: Array<{ from: number; to: number; tag: string }> = [];
	const firstLine = state.doc.lineAt(from).number;
	const lastLine = state.doc.lineAt(to).number;
	for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber++) {
		const line = state.doc.line(lineNumber);
		if (/^\s{0,3}#{1,6}(?:\s|$)/.test(line.text)) continue;
		for (const match of line.text.matchAll(TAG_RE)) {
			const tag = match[2];
			// Keep numeric fragments such as #123 as plain text rather than tags.
			if (!/[\p{L}_-]/u.test(tag)) continue;
			const hashOffset = (match.index ?? 0) + match[1].length;
			const tagFrom = line.from + hashOffset;
			const tagTo = tagFrom + tag.length + 1;
			if (tagTo <= from || tagFrom >= to || isCode(state, tagFrom)) continue;
			results.push({ from: tagFrom, to: tagTo, tag });
		}
	}
	return results;
}

function isCode(state: EditorState, position: number): boolean {
	let node = syntaxTree(state).resolveInner(position, 1);
	while (node) {
		if (node.name === 'InlineCode' || node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'URL') return true;
		node = node.parent!;
	}
	return false;
}

function buildDecorations(view: EditorView): DecorationSet {
	const ranges: Range<Decoration>[] = [];
	for (const visible of view.visibleRanges) {
		for (const tag of findInlineTags(view.state, visible.from, visible.to)) {
			ranges.push(Decoration.mark({ class: 'mlp-tag', attributes: { 'data-tag': tag.tag } }).range(tag.from, tag.to));
		}
	}
	return Decoration.set(ranges, true);
}

export const tagDecorations = ViewPlugin.fromClass(class {
	decorations: DecorationSet;
	constructor(view: EditorView) { this.decorations = buildDecorations(view); }
	update(update: ViewUpdate) {
		if (update.docChanged || update.viewportChanged) this.decorations = buildDecorations(update.view);
	}
}, { decorations: (plugin) => plugin.decorations });
