import type { VaultMove } from './linkRewrite';

/** Rejects selections that cannot be committed as independent filesystem moves. */
export function assertIndependentMoves(moves: readonly VaultMove[], caseInsensitive = process.platform !== 'linux'): void {
	const key = (path: string) => {
		const normalized = path.replace(/\\/g, '/').normalize('NFC');
		return caseInsensitive ? normalized.toLocaleLowerCase() : normalized;
	};
	const sources = new Set<string>();
	const destinations = new Set<string>();
	for (const move of moves) {
		const sourceKey = key(move.oldPath);
		const destinationKey = key(move.newPath);
		if (sources.has(sourceKey)) throw new Error('The same vault item was selected more than once.');
		if (destinations.has(destinationKey)) throw new Error('Multiple items would have the same destination.');
		sources.add(sourceKey);
		destinations.add(destinationKey);
	}
	for (let index = 0; index < moves.length; index++) {
		for (let other = 0; other < moves.length; other++) {
			if (index === other) continue;
			const source = key(moves[index].oldPath);
			const otherSource = key(moves[other].oldPath);
			const destination = key(moves[index].newPath);
			if (moves[other].isFolder && source.startsWith(`${otherSource}/`)) {
				throw new Error('A selection cannot contain both a folder and one of its descendants.');
			}
			if (destination === otherSource || destination.startsWith(`${otherSource}/`)) {
				throw new Error('Move chains and moves into selected folders are not supported.');
			}
		}
	}
}

/** Produces one smallest contiguous edit that transforms `original` into `rewritten`. */
export function minimalTextReplacement(
	original: string,
	rewritten: string,
): { from: number; to: number; text: string } | undefined {
	if (original === rewritten) return undefined;
	// Preserve unchanged edges so the workspace edit does not replace an entire open note.
	let from = 0;
	while (from < original.length && from < rewritten.length && original[from] === rewritten[from]) from++;
	let originalEnd = original.length;
	let rewrittenEnd = rewritten.length;
	while (originalEnd > from && rewrittenEnd > from && original[originalEnd - 1] === rewritten[rewrittenEnd - 1]) {
		originalEnd--;
		rewrittenEnd--;
	}
	return { from, to: originalEnd, text: rewritten.slice(from, rewrittenEnd) };
}

/** Adds the shortest post-transaction wikilink spelling for moved Markdown files. */
export function assignWikiTargets(
	moves: readonly VaultMove[],
	markdownPaths: readonly string[],
	_caseInsensitive = process.platform !== 'linux',
): VaultMove[] {
	const finalPaths = markdownPaths.map((path) => moves.reduce((current, move) => mapMovedPath(current, move), path));
	// Wikilink resolution is case-insensitive even on a case-sensitive volume.
	const key = (value: string) => value.normalize('NFC').toLocaleLowerCase();
	const originalPaths = new Map<string, string[]>();
	const originalBasenames = new Map<string, string[]>();
	for (const path of markdownPaths) {
		const withoutExtension = stripMarkdownExtension(path);
		const basename = withoutExtension.split('/').pop() ?? withoutExtension;
		const pathMatches = originalPaths.get(key(withoutExtension)) ?? [];
		pathMatches.push(path);
		originalPaths.set(key(withoutExtension), pathMatches);
		const basenameMatches = originalBasenames.get(key(basename)) ?? [];
		basenameMatches.push(path);
		originalBasenames.set(key(basename), basenameMatches);
	}
	const basenameCounts = new Map<string, number>();
	for (const path of finalPaths) {
		const basename = stripMarkdownExtension(path).split('/').pop() ?? path;
		basenameCounts.set(key(basename), (basenameCounts.get(key(basename)) ?? 0) + 1);
	}
	return moves.map((move) => {
		if (move.isFolder || !/\.(?:md|markdown)$/i.test(move.newPath)) return { ...move };
		const withoutExtension = stripMarkdownExtension(move.newPath);
		const basename = withoutExtension.split('/').pop() ?? withoutExtension;
		const oldBasename = stripMarkdownExtension(move.oldPath).split('/').pop() ?? move.oldPath;
		// Match LinkResolver's exact root-path precedence before basename lookup.
		const sourceMatches = originalPaths.get(key(oldBasename)) ?? originalBasenames.get(key(oldBasename)) ?? [];
		return {
			...move,
			wikiTarget: basenameCounts.get(key(basename)) === 1 ? basename : withoutExtension,
			wikiSourceBasename: sourceMatches.length === 1 && key(sourceMatches[0]) === key(move.oldPath),
		};
	});
}

function mapMovedPath(path: string, move: VaultMove): string {
	const pathParts = path.split('/');
	const oldParts = move.oldPath.split('/');
	const matchesPrefix = pathParts.length >= oldParts.length &&
		oldParts.every((part, index) => part.normalize('NFC') === pathParts[index].normalize('NFC'));
	if (matchesPrefix && pathParts.length === oldParts.length) return move.newPath;
	if (move.isFolder && matchesPrefix) return [...move.newPath.split('/'), ...pathParts.slice(oldParts.length)].join('/');
	return path;
}

function stripMarkdownExtension(path: string): string {
	return path.replace(/\.(?:md|markdown)$/i, '');
}
