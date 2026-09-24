// Widget inputs are outside CodeMirror's document until committed. Give save,
// tab-switch, and synchronization boundaries a way to settle the focused input.
interface DraftHandlers {
	commit: () => void;
	text: () => string | undefined;
	snapshot?: () => string | undefined;
}
const drafts = new WeakMap<HTMLElement, DraftHandlers>();
let onDraftInput: (() => void) | undefined;
let onUncommittedDraft: ((text: string) => void) | undefined;

export function setActiveDraftInputHandler(handler: () => void): void {
	onDraftInput = handler;
}

export function notifyActiveDraftChanged(): void {
	onDraftInput?.();
}

export function setUncommittedDraftHandler(handler: (text: string) => void): void {
	onUncommittedDraft = handler;
}

/** Preserve invalid field text before focus/redraw can orphan its input. */
export function preserveUncommittedDraft(text: string): void {
	onUncommittedDraft?.(text);
}

export function registerActiveDraft(
	element: HTMLElement,
	commit: () => void,
	text: () => string | undefined,
	snapshot?: () => string | undefined,
): void {
	if (!drafts.has(element)) element.addEventListener('input', () => onDraftInput?.());
	drafts.set(element, { commit, text, snapshot });
}

/** Reconstruct a focused field without committing it or replacing its DOM. */
export function readActiveDraftSnapshot(): { documentText?: string; residualText?: string } | undefined {
	const active = document.activeElement;
	if (!(active instanceof HTMLElement)) return undefined;
	const draft = drafts.get(active);
	if (!draft) return undefined;
	const documentText = draft.snapshot?.();
	if (documentText !== undefined) return { documentText };
	const residualText = draft.text();
	return residualText === undefined ? undefined : { residualText };
}

export function commitActiveDraft(): string | undefined {
	const active = document.activeElement;
	if (!(active instanceof HTMLElement)) return undefined;
	const draft = drafts.get(active);
	if (!draft) return undefined;
	draft.commit();
	// Invalid typed property values cannot be inserted into typed YAML, but must
	// still be retained as recovery text before their input is replaced.
	return draft.text();
}
