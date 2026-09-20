import { posix } from 'node:path';
import { markdownCodeRanges } from '../shared/markdownCodeRanges';

export interface VaultMove {
	oldPath: string;
	newPath: string;
	isFolder: boolean;
	/** Shortest unambiguous wikilink target after the transaction. */
	wikiTarget?: string;
}

export interface LinkReplacement {
	from: number;
	to: number;
	text: string;
}

/**
 * Computes conservative link edits for one Markdown document. The caller owns
 * filesystem changes; this function is deliberately pure so the complete move
 * and every text replacement can be submitted as one VS Code WorkspaceEdit.
 */
export function linkReplacementsForMove(
	text: string,
	sourcePath: string,
	move: VaultMove,
): LinkReplacement[] {
	const oldSource = normalizePath(sourcePath);
	const newSource = mapMovedPath(oldSource, move);
	const ignored = markdownCodeRanges(text);
	const replacements: LinkReplacement[] = [];

	// Inline Markdown links and images. Reference definitions use the same
	// destination form but are handled separately below.
	const markdownLink = /(!?\[[^\]\n]*\]\(\s*)(<[^>\n]+>|[^\s)]+)([^)\n]*\))/g;
	for (const match of text.matchAll(markdownLink)) {
		const start = (match.index ?? 0) + match[1].length;
		if (isIgnored(start, ignored) || isEscaped(text, match.index ?? 0)) continue;
		const destination = match[2];
		const wrapped = destination.startsWith('<') && destination.endsWith('>');
		const raw = wrapped ? destination.slice(1, -1) : destination;
		const rewritten = rewriteMarkdownDestination(raw, oldSource, newSource, move);
		if (rewritten && rewritten !== raw) {
			replacements.push({ from: start, to: start + destination.length, text: wrapped ? `<${rewritten}>` : rewritten });
		}
	}

	const referenceLink = /(^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*)(<[^>\n]+>|\S+)/gm;
	for (const match of text.matchAll(referenceLink)) {
		const start = (match.index ?? 0) + match[1].length;
		if (isIgnored(start, ignored)) continue;
		const destination = match[2];
		const wrapped = destination.startsWith('<') && destination.endsWith('>');
		const raw = wrapped ? destination.slice(1, -1) : destination;
		const rewritten = rewriteMarkdownDestination(raw, oldSource, newSource, move);
		if (rewritten && rewritten !== raw) {
			replacements.push({ from: start, to: start + destination.length, text: wrapped ? `<${rewritten}>` : rewritten });
		}
	}

	const wikiLink = /!?\[\[([^\]\n]+)\]\]/g;
	for (const match of text.matchAll(wikiLink)) {
		const start = (match.index ?? 0) + match[0].indexOf(match[1]);
		if (isIgnored(start, ignored) || isEscaped(text, match.index ?? 0)) continue;
		const body = match[1];
		const separator = firstSeparator(body);
		const target = separator < 0 ? body : body.slice(0, separator);
		const suffix = separator < 0 ? '' : body.slice(separator);
		const rewritten = rewriteWikiTarget(target, move);
		if (rewritten && rewritten !== target) {
			replacements.push({ from: start, to: start + body.length, text: rewritten + suffix });
		}
	}

	return replacements.sort((a, b) => b.from - a.from);
}

/**
 * Rewrites a document for a set of independent moves and returns the final
 * source path as well. Callers use this for multi-selection drag/drop, where
 * links and every filesystem rename must land in one WorkspaceEdit.
 *
 * Move chains are rejected by the transaction planner, so applying the moves
 * in order cannot accidentally rewrite the output of one move as the input of
 * another.
 */
export function rewriteLinksForMoves(
	text: string,
	sourcePath: string,
	moves: readonly VaultMove[],
): { text: string; sourcePath: string } {
	let rewrittenText = text;
	let rewrittenSource = sourcePath;
	for (const move of moves) {
		for (const replacement of linkReplacementsForMove(rewrittenText, rewrittenSource, move)) {
			rewrittenText = rewrittenText.slice(0, replacement.from) + replacement.text + rewrittenText.slice(replacement.to);
		}
		rewrittenSource = mapMovedPath(rewrittenSource, move);
	}
	return { text: rewrittenText, sourcePath: rewrittenSource };
}

function rewriteMarkdownDestination(
	destination: string,
	oldSource: string,
	newSource: string,
	move: VaultMove,
): string | undefined {
	const splitAt = firstSeparator(destination, '#', '?');
	const pathPart = splitAt < 0 ? destination : destination.slice(0, splitAt);
	const suffix = splitAt < 0 ? '' : destination.slice(splitAt);
	if (!pathPart || pathPart.startsWith('#') || hasScheme(pathPart) || pathPart.startsWith('//')) return undefined;
	const decoded = safeDecode(pathPart).replace(/\\/g, '/');
	if (decoded.startsWith('//')) return undefined;
	const rootRelative = decoded.startsWith('/');
	const oldTarget = resolveAuthoredVaultPath(oldSource, decoded, rootRelative);
	if (oldTarget === undefined) return undefined;
	const newTarget = mapMovedPath(oldTarget, move);
	if (newTarget === oldTarget && newSource === oldSource) return undefined;
	let output = rootRelative ? `/${newTarget}` : normalizePath(posix.relative(posix.dirname(newSource), newTarget));
	if (!rootRelative && !output) output = `.${posix.extname(newTarget)}`;
	if (pathPart.includes('%')) output = encodeURI(output).replace(/#/g, '%23').replace(/\?/g, '%3F');
	return output + suffix;
}

function resolveAuthoredVaultPath(sourcePath: string, authoredPath: string, rootRelative: boolean): string | undefined {
	// `posix.resolve('/')` silently clamps traversal at the filesystem root. A
	// root-level note linking to `../Old.md` would therefore look identical to an
	// in-vault link to `Old.md` and could be rewritten during a rename. Resolve
	// under a synthetic root instead and reject anything that crosses it.
	const vaultRoot = '/__mdlp_vault__';
	const base = rootRelative ? vaultRoot : posix.join(vaultRoot, posix.dirname(sourcePath));
	const relativeTarget = rootRelative ? authoredPath.replace(/^\/+/, '') : authoredPath;
	const resolved = posix.resolve(base, relativeTarget);
	if (resolved !== vaultRoot && !resolved.startsWith(`${vaultRoot}/`)) return undefined;
	const target = posix.relative(vaultRoot, resolved);
	return target ? normalizePath(target) : undefined;
}

function rewriteWikiTarget(target: string, move: VaultMove): string | undefined {
	const trimmed = target.trim();
	if (!trimmed || hasScheme(trimmed) || trimmed.startsWith('/')) return undefined;
	const oldPath = normalizePath(move.oldPath);
	const newPath = normalizePath(move.newPath);
	const omittedExtension = !posix.extname(trimmed);
	const candidate = normalizePath(trimmed + (omittedExtension ? '.md' : ''));
	const oldComparable = omittedExtension && !move.isFolder && /\.(?:md|markdown)$/i.test(oldPath)
		? oldPath.replace(/\.(?:md|markdown)$/i, '')
		: oldPath;
	const normalizedTarget = normalizePath(trimmed);

	let rewritten: string | undefined;
	if (move.isFolder && isSameOrDescendant(normalizedTarget, oldPath)) {
		rewritten = replacePathPrefix(normalizedTarget, oldPath, newPath);
	} else if (!move.isFolder && (samePath(normalizedTarget, oldComparable) || samePath(candidate, oldPath))) {
		const movedTarget = omittedExtension && /\.(?:md|markdown)$/i.test(newPath)
			? newPath.replace(/\.(?:md|markdown)$/i, '')
			: newPath;
		// A basename-only wikilink remains the shortest valid spelling when a
		// note merely changes folders. When the file name itself changes, retain
		// the basename-only form with the new name.
		rewritten = trimmed.includes('/') ? movedTarget : (move.wikiTarget ?? posix.basename(movedTarget));
	} else if (!move.isFolder && !trimmed.includes('/')) {
		const oldName = oldComparable.split('/').pop();
		if (oldName && samePath(trimmed, oldName)) {
			rewritten = (omittedExtension ? stripMarkdownExtension(newPath) : newPath).split('/').pop();
		}
	}
	if (!rewritten) return undefined;
	return target.replace(trimmed, rewritten);
}

function mapMovedPath(path: string, move: VaultMove): string {
	const normalizedPath = normalizePath(path);
	const oldPath = normalizePath(move.oldPath);
	const newPath = normalizePath(move.newPath);
	if (samePath(normalizedPath, oldPath)) return newPath;
	if (move.isFolder && isSameOrDescendant(normalizedPath, oldPath)) {
		return replacePathPrefix(normalizedPath, oldPath, newPath);
	}
	return normalizedPath;
}

function isIgnored(position: number, ranges: readonly (readonly [number, number])[]): boolean {
	return ranges.some(([from, to]) => position >= from && position < to);
}

function isEscaped(text: string, position: number): boolean {
	let slashes = 0;
	for (let cursor = position - 1; cursor >= 0 && text[cursor] === '\\'; cursor--) slashes++;
	return slashes % 2 === 1;
}

function normalizePath(value: string): string {
	return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function stripMarkdownExtension(path: string): string {
	return path.replace(/\.(?:md|markdown)$/i, '');
}

/** Filesystems may report canonically equivalent names in NFC or NFD form. */
function samePath(left: string, right: string): boolean {
	return left.normalize('NFC') === right.normalize('NFC');
}

function isSameOrDescendant(path: string, parent: string): boolean {
	const pathParts = path.split('/');
	const parentParts = parent.split('/');
	return pathParts.length >= parentParts.length && parentParts.every((part, index) => samePath(pathParts[index], part));
}

function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
	const suffix = path.split('/').slice(oldPrefix.split('/').length);
	return [...newPrefix.split('/'), ...suffix].join('/');
}

function hasScheme(value: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function safeDecode(value: string): string {
	try { return decodeURIComponent(value); } catch { return value; }
}

function firstSeparator(value: string, ...separators: string[]): number {
	const candidates = (separators.length ? separators : ['#', '|'])
		.map((separator) => value.indexOf(separator))
		.filter((index) => index >= 0);
	return candidates.length ? Math.min(...candidates) : -1;
}
