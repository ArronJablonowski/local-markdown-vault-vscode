import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { parseCalloutHeader } from './callouts';

export const toggleCallout = StateEffect.define<{ from: number; collapsed: boolean }>();
// Fold overrides are editor state; clicking a callout never rewrites its saved marker.
export const calloutState = StateField.define<ReadonlyMap<number, boolean>>({
	create: () => new Map(),
	update(value, tr) {
		const revealSearch = Boolean(tr.selection && tr.isUserEvent('select.search'));
		if (!tr.docChanged && !revealSearch && !tr.effects.some(effect => effect.is(toggleCallout))) return value;
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
		// A Find result must be visible even when its containing callout was
		// collapsed. Expand the UI state (not the saved +/- marker), just as
		// ordinary folded source expands when a search navigates into it.
		if (revealSearch) for (const range of tr.newSelection.ranges) {
			syntaxTree(tr.state).iterate({ from: range.from, to: range.to, enter(node) {
				if (node.name !== 'Blockquote') return;
				const line = tr.newDoc.lineAt(node.from);
				if (range.to <= line.to || range.from >= node.to) return;
				let depth = 0;
				for (let ancestor: SyntaxNode | null = node.node; ancestor; ancestor = ancestor.parent) if (ancestor.name === 'Blockquote') depth++;
				const callout = parseCalloutHeader(line.text, depth);
				if (callout && (next.get(line.from) ?? callout.collapsed)) next.set(line.from, false);
			} });
		}
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
