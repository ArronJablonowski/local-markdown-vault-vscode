const TEXT_FORMATS = ['text/tab-separated-values', 'text/csv', 'text/plain', 'text/uri-list'] as const;
type ClipboardTextFormat = typeof TEXT_FORMATS[number];

/** Read only known text formats, preferring usable content over empty metadata. */
export function readClipboardText(data: Pick<DataTransfer, 'types' | 'getData'> | null | undefined, mode: 'grid' | 'plain' = 'grid'):
	{ type: ClipboardTextFormat; text: string; hasText: boolean } {
	let emptyType: ClipboardTextFormat | undefined;
	// Four known formats bound lookup work; never inspect HTML, RTF, or files.
	for (const type of TEXT_FORMATS) {
		if (mode === 'plain' && type !== 'text/plain' && type !== 'text/uri-list') continue;
		if (!data?.types.includes(type)) continue;
		emptyType ??= type;
		const text = data.getData(type);
		if (text.length) return { type, text, hasText: true };
	}
	// Keep explicitly empty spreadsheet cells supported when no fallback exists.
	return { type: emptyType ?? 'text/plain', text: '', hasText: emptyType !== undefined };
}
