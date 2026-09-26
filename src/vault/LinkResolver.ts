import type { VaultNoteSummary } from '../shared/messages';

export interface ParsedWikiLink {
	target: string;
	fragment: string;
	alias: string;
}

export const MAX_WIKI_ALIAS_LENGTH = 512;

/** Whether an alias can be represented unambiguously inside `[[target|alias]]`. */
export function isSafeWikiAlias(alias: string): boolean {
	return alias.length > 0 && alias.length <= MAX_WIKI_ALIAS_LENGTH && alias.trim() === alias &&
		!/[\[\]|\u0000-\u001f\u007f]/.test(alias);
}

export type WikiLinkResolution =
	| { kind: 'resolved'; note: VaultNoteSummary }
	| { kind: 'ambiguous'; notes: VaultNoteSummary[] }
	| { kind: 'unresolved' };

export function parseWikiLinkBody(body: string): ParsedWikiLink | undefined {
	if (!body || body.length > 4096 || /[\u0000-\u001f\u007f]/.test(body)) return undefined;
	const aliasAt = body.indexOf('|');
	const targetAndFragment = (aliasAt < 0 ? body : body.slice(0, aliasAt)).trim();
	const separator = targetAndFragment.search(/[#^]/);
	return {
		target: (separator < 0 ? targetAndFragment : targetAndFragment.slice(0, separator)).trim(),
		fragment: separator < 0 ? '' : targetAndFragment.slice(separator),
		alias: aliasAt < 0 ? '' : body.slice(aliasAt + 1).trim(),
	};
}

/** Resolve path, then basename, then alias; ambiguity at a higher tier never falls through. */
export function resolveWikiLinkSummary(target: string, notes: readonly VaultNoteSummary[]): WikiLinkResolution {
	if (!target) return { kind: 'unresolved' };
	const normalized = normalizeTarget(target);
	const exactPaths = notes.filter((note) => normalizeTarget(note.path) === normalized);
	if (exactPaths.length === 1) return { kind: 'resolved', note: exactPaths[0] };
	if (exactPaths.length > 1) return { kind: 'ambiguous', notes: exactPaths };
	const basenames = notes.filter((note) => note.basename.toLocaleLowerCase() === normalized);
	if (basenames.length === 1) return { kind: 'resolved', note: basenames[0] };
	if (basenames.length > 1) return { kind: 'ambiguous', notes: basenames };
	const aliases = notes.filter((note) => note.aliases.some((alias) => alias.toLocaleLowerCase() === normalized));
	if (aliases.length === 1) return { kind: 'resolved', note: aliases[0] };
	if (aliases.length > 1) return { kind: 'ambiguous', notes: aliases };
	return { kind: 'unresolved' };
}

export function wikiHeadingSlug(value: string): string {
	return value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

function normalizeTarget(value: string): string {
	return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\.(?:md|markdown)$/i, '').toLocaleLowerCase();
}
