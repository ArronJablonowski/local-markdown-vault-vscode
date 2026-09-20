import { stripNetworkedCss } from './cssAdapter';

/**
 * Adapts a Markdown-preview theme for an isolated sidebar thumbnail. The same
 * fail-closed policy used by the editor runs first; a rejected stylesheet does
 * not get a weaker rendering path merely because it is shown as a preview.
 */
export function prepareSidebarPreviewCss(css: string): string {
	const safe = stripNetworkedCss(css);
	if (!safe) return '';
	let out = '';
	let depth = 0;
	let prelude = '';
	const remap = (selector: string) => selector.replace(
		/\bbody\b((?:\.[-\w]+)*)/g,
		(_match, classes: string) => classes ? `:host(${classes})` : ':host',
	);
	for (let index = 0; index < safe.length; index++) {
		const character = safe[index];
		if (character === '{') {
			if (depth === 0) {
				out += remap(prelude);
				prelude = '';
			}
			out += character;
			depth++;
		} else if (character === '}') {
			depth = Math.max(0, depth - 1);
			out += character;
		} else if (depth === 0) {
			prelude += character;
		} else {
			out += character;
		}
	}
	return out + remap(prelude);
}
