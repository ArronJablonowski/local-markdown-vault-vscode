import type { EditorState, StateEffect } from '@codemirror/state';
import { foldedRanges, syntaxTree, unfoldEffect } from '@codemirror/language';

/** Explicit source reveal must not inherit a fold from an earlier block type. */
export function sourceBlockUnfoldEffects(state: EditorState, position: number): StateEffect<unknown>[] {
	const tree = syntaxTree(state);
	// Replacements inside quotes/lists can begin before the actual syntax node.
	// Probe the same line's final character, never a neighboring source block.
	for (const [probe, bias] of [[position, 1], [state.doc.lineAt(position).to, -1]] as const) {
		let node = tree.resolveInner(probe, bias);
		while (node.parent && !/^(?:FencedCode|CodeBlock|HTMLBlock|Table)$/.test(node.name)) node = node.parent;
		if (!/^(?:FencedCode|CodeBlock|HTMLBlock|Table)$/.test(node.name)) continue;
		const effects: StateEffect<unknown>[] = [];
		foldedRanges(state).between(node.from, node.to, (from, to) => {
			if (from < node.to && to > node.from) effects.push(unfoldEffect.of({ from, to }));
		});
		return effects;
	}
	return [];
}
