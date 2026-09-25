let enabled = false;
const listeners = new Set<() => void>();

/** Display-only preference; changing it must never rebuild an active cell draft. */
export function setStickyTableHeaders(value: boolean): void {
	if (typeof value !== 'boolean') return;
	if (typeof document !== 'undefined') document.body.classList.toggle('mlp-sticky-table-headers', value);
	if (enabled === value) return;
	enabled = value;
	for (const listener of [...listeners]) listener();
}

export function stickyTableHeadersEnabled(): boolean { return enabled; }

/** Each mounted table removes its subscription when CodeMirror destroys its DOM. */
export function onStickyTableHeadersChange(listener: () => void): () => void {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}
