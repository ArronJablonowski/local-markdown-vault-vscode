import { wikiHeadingSlug } from '../vault/LinkResolver';

/** Finds an Obsidian-compatible heading or block fragment in Markdown text. */
export function findMarkdownAnchorLine(text: string, fragment: string): number | undefined {
	if (fragment.startsWith('#')) {
		const wanted = wikiHeadingSlug(fragment.slice(1));
		if (!wanted) return undefined;
		const lines = text.split(/\r?\n/);
		for (let index = 0; index < lines.length; index++) {
			const atx = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(lines[index])?.[1];
			if (atx && wikiHeadingSlug(atx) === wanted) return index + 1;
			if (index + 1 < lines.length && lines[index].trim() && /^[ \t]{0,3}(?:=+|-+)[ \t]*$/.test(lines[index + 1]) &&
				wikiHeadingSlug(lines[index].trim()) === wanted) return index + 1;
		}
		return undefined;
	}
	if (fragment.startsWith('^')) {
		const id = fragment.slice(1);
		if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(id)) return undefined;
		const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const lines = text.split(/\r?\n/);
		const pattern = new RegExp(`(?:^|\\s)\\^${escaped}(?:\\s|$)`);
		const index = lines.findIndex((line) => pattern.test(line));
		return index < 0 ? undefined : index + 1;
	}
	return undefined;
}
