/** Whether an authored Markdown image target names raw draw.io XML. */
export function isDrawioPath(src: string): boolean {
	// `.drawio.svg` and `.drawio.png` are real image exports and must stay on
	// the inert image path. Only raw XML formats need privileged host reads.
	const path = src.split(/[?#]/, 1)[0].toLowerCase();
	return path.endsWith('.drawio') || path.endsWith('.dio') || path.endsWith('.drawio.xml');
}
