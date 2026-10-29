import { StateEffect, StateField } from '@codemirror/state';

export interface HtmlDisclosureSnapshot {
	from: number;
	source: string;
	open: readonly number[];
}

export const rememberHtmlDisclosures = StateEffect.define<HtmlDisclosureSnapshot>();

/** Presentation state survives virtualized widget removal without editing the file. */
export const htmlDisclosureState = StateField.define<ReadonlyMap<number, HtmlDisclosureSnapshot>>({
	create: () => new Map(),
	update(value, tr) {
		if (!tr.docChanged && !tr.effects.some(effect => effect.is(rememberHtmlDisclosures))) return value;
		const next = new Map<number, HtmlDisclosureSnapshot>();
		for (const snapshot of value.values()) {
			const from = tr.changes.mapPos(snapshot.from, 1);
			const to = tr.changes.mapPos(snapshot.from + snapshot.source.length, -1);
			// A source rewrite invalidates ordinal detail positions; never restore onto other content.
			if (to - from === snapshot.source.length && tr.newDoc.sliceString(from, to) === snapshot.source) {
				next.set(from, { ...snapshot, from });
			}
		}
		for (const effect of tr.effects) if (effect.is(rememberHtmlDisclosures)) {
			const snapshot = effect.value;
			if (!Number.isSafeInteger(snapshot.from) || snapshot.from < 0 || snapshot.source.length > 100_000
				|| snapshot.from + snapshot.source.length > tr.newDoc.length || snapshot.open.length > 2_000
				|| snapshot.open.some(index => !Number.isSafeInteger(index) || index < 0 || index >= 2_000)
				|| tr.newDoc.sliceString(snapshot.from, snapshot.from + snapshot.source.length) !== snapshot.source) continue;
			if (!snapshot.open.length) next.delete(snapshot.from);
			else next.set(snapshot.from, snapshot);
		}
		// A long-lived editor cannot accumulate unbounded presentation history.
		while (next.size > 1_000) next.delete(next.keys().next().value!);
		return next;
	},
});
