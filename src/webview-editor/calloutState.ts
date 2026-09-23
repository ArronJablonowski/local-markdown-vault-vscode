import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { parseCalloutHeader } from './callouts';

export const toggleCallout = StateEffect.define<{ from: number; collapsed: boolean }>();
export const calloutState = StateField.define<ReadonlyMap<number, boolean>>({
	create: () => new Map(),
	update(value, tr) {
		if (!tr.docChanged && !tr.effects.some(effect => effect.is(toggleCallout))) return value;
		const next = new Map<number, boolean>();
		for (const [from, collapsed] of value) {
			const mapped = tr.changes.mapPos(from, 1);
			const oldHeader = tr.startState.doc.lineAt(from).text.match(/\[![A-Za-z0-9_-]{1,32}\]([+-])?/);
			const newHeader = tr.newDoc.lineAt(mapped).text.match(/\[![A-Za-z0-9_-]{1,32}\]([+-])?/);
			// An explicit source change to the fold marker supersedes a UI toggle.
			if (oldHeader?.[1] !== newHeader?.[1]) continue;
			if (mapped <= tr.newDoc.length && tr.newDoc.lineAt(mapped).from === mapped
				&& /^[ \t]*(?:>[ \t]*)+\[!/.test(tr.newDoc.lineAt(mapped).text)) next.set(mapped, collapsed);
		}
		for (const effect of tr.effects) if (effect.is(toggleCallout)) next.set(effect.value.from, effect.value.collapsed);
		return next;
	},
});

export function calloutForNode(state: EditorState, node: SyntaxNode) {
	if (node.name !== 'Blockquote') return undefined;
	let depth = 0;
	for (let ancestor: SyntaxNode | null = node; ancestor; ancestor = ancestor.parent) if (ancestor.name === 'Blockquote') depth++;
	const line = state.doc.lineAt(node.from);
	const parsed = parseCalloutHeader(line.text, depth);
	if (!parsed) return undefined;
	return { ...parsed, from: line.from, to: node.to,
		collapsed: state.field(calloutState, false)?.get(line.from) ?? parsed.collapsed };
}

export function containingCallouts(state: EditorState, node: SyntaxNode) {
	const result: NonNullable<ReturnType<typeof calloutForNode>>[] = [];
	for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
		const callout = calloutForNode(state, ancestor);
		if (callout) result.push(callout);
	}
	return result;
}
