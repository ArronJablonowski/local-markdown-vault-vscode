import { EditorState, Transaction, type AnnotationType } from '@codemirror/state';
import { blockDecorationsField } from './blockDecorations';

/** Correct Chromium's selected first character after typing over a block widget. */
export function createBlockReplacementSelectionGuard(remoteChange: AnnotationType<boolean>) {
	return EditorState.transactionFilter.of(transaction => {
		if (transaction.annotation(Transaction.userEvent) !== 'input.type' || transaction.annotation(remoteChange)
			|| !transaction.docChanged || transaction.startState.selection.ranges.length !== 1
			|| transaction.newSelection.ranges.length !== 1) return transaction;
		const before = transaction.startState.selection.main;
		const after = transaction.newSelection.main;
		if (before.empty || after.empty) return transaction;
		let changes = 0;
		let replacedSelection = false;
		transaction.changes.iterChanges((from, to, fromNew, toNew) => {
			changes++;
			replacedSelection = from === before.from && to === before.to && fromNew < toNew
				&& after.from === fromNew && after.to === toNew;
		});
		if (changes !== 1 || !replacedSelection) return transaction;
		let containsBlock = false;
		transaction.startState.field(blockDecorationsField, false)?.between(before.from, before.to, (from, to) => {
			if (from < to && from >= before.from && to <= before.to) { containsBlock = true; return false; }
		});
		if (!containsBlock) return transaction;
		// Keep the accepted change, effects, and all annotations. Only an ordinary
		// exact selection replacement gets a caret; IME and formatting keep theirs.
		return [transaction, { selection: { anchor: after.to }, sequential: true }];
	});
}
