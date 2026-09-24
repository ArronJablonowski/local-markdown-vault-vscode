/** Escape cell source without creating row breaks or extra GFM columns. */
export function escapeTableCellSource(text: string): string {
	let escapedPipeAt = -1;
	// Tokenize whole backslash runs, rather than repeatedly searching backward
	// from each pipe. This is linear even for a long run with no following pipe.
	return text.replace(/\\+|\r\n?|\n|\|/g, (token: string, offset: number) => {
		if (token[0] === '\\') {
			escapedPipeAt = token.length % 2 === 1 ? offset + token.length : -1;
			return token;
		}
		if (token === '|') return offset === escapedPipeAt ? token : '\\|';
		return ' ';
	});
}
