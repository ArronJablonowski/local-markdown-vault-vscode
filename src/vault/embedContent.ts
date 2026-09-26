import { wikiHeadingSlug } from './LinkResolver';

/** Selects the note, heading, or block represented by an Obsidian embed fragment. */
export function extractWikiEmbedContent(text: string, fragment: string): string | undefined {
	const normalized = text.replace(/\r\n?/g, '\n');
	if (!fragment) return stripFrontmatter(normalized).trim();
	const lines = normalized.split('\n');
	if (fragment.startsWith('#')) {
		const wanted = wikiHeadingSlug(fragment.slice(1));
		let start = -1;
		let level = 0;
		for (let index = 0; index < lines.length; index++) {
			const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[index]);
			if (!heading) continue;
			if (start < 0 && wikiHeadingSlug(heading[2]) === wanted) {
				start = index;
				level = heading[1].length;
				continue;
			}
			// Keep nested subsections, stopping only at the next peer or ancestor heading.
			if (start >= 0 && heading[1].length <= level) return lines.slice(start, index).join('\n').trim();
		}
		return start >= 0 ? lines.slice(start).join('\n').trim() : undefined;
	}
	if (fragment.startsWith('^')) {
		const id = fragment.slice(1);
		if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(id)) return undefined;
		const marker = new RegExp(`(?:^|\\s)\\^${escapeRegExp(id)}(?:\\s|$)`);
		const hit = lines.findIndex((line) => marker.test(line));
		if (hit < 0) return undefined;
		let from = hit;
		let to = hit + 1;
		while (from > 0 && lines[from - 1].trim() !== '' && !/^#{1,6}\s/.test(lines[from - 1])) from--;
		while (to < lines.length && lines[to].trim() !== '' && !/^#{1,6}\s/.test(lines[to])) to++;
		return lines.slice(from, to).map((line, index) => index === hit - from ? line.replace(marker, '').trimEnd() : line).join('\n').trim();
	}
	return undefined;
}

function stripFrontmatter(text: string): string {
	if (!text.startsWith('---\n')) return text;
	const end = text.indexOf('\n---', 4);
	if (end < 0) return text;
	const after = end + 4;
	return text.slice(text[after] === '\n' ? after + 1 : after);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
