import { basename, extname } from 'node:path';
import { parseFrontmatterYaml } from '../webview-editor/frontmatterSecurity';
import { markdownCodeRanges } from '../shared/markdownCodeRanges';
import { isSafeWikiAlias } from './LinkResolver';

export const MAX_INDEX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_INDEX_ENTRIES_PER_FIELD = 10_000;
export const MAX_METADATA_PARSE_MS = 250;
export const MAX_INDEX_HEADING_TEXT_LENGTH = 4096;
export const MAX_INDEX_ALIASES = 100;
export const MAX_INDEX_TAG_LENGTH = 512;
export const MAX_INDEX_TASK_TEXT_LENGTH = 4096;
export const MAX_INDEX_LINK_TARGET_LENGTH = 4096;
export const MAX_INDEX_LINK_FRAGMENT_LENGTH = 4096;
export const MAX_INDEX_SEARCH_TOKEN_LENGTH = 256;

export interface MetadataParseOptions {
	timeBudgetMs?: number;
	now?: () => number;
}

export interface VaultHeading {
	level: number;
	text: string;
	line: number;
}

export interface VaultLink {
	kind: 'markdown' | 'markdownEmbed' | 'wikilink' | 'wikiEmbed';
	target: string;
	fragment?: string;
	line: number;
}

export interface VaultTask {
	completed: boolean;
	text: string;
	line: number;
}

export interface VaultMetadata {
	path: string;
	basename: string;
	headings: VaultHeading[];
	blockIds: string[];
	aliases: string[];
	tags: string[];
	properties: Readonly<Record<string, unknown>>;
	links: VaultLink[];
	tasks: VaultTask[];
	searchTokens: string[];
}

export function extractVaultMetadata(path: string, text: string, options: MetadataParseOptions = {}): VaultMetadata {
	if (new TextEncoder().encode(text).byteLength > MAX_INDEX_FILE_BYTES) {
		throw new Error('Markdown file exceeds the metadata indexing limit.');
	}
	const now = options.now ?? (() => performance.now());
	const budget = options.timeBudgetMs ?? MAX_METADATA_PARSE_MS;
	if (!Number.isFinite(budget) || budget <= 0) throw new Error('Markdown metadata parsing exceeded its time limit.');
	const deadline = now() + budget;
	let operations = 0;
	const checkBudget = (force = false) => {
		if ((force || ++operations % 64 === 0) && now() > deadline) {
			throw new Error('Markdown metadata parsing exceeded its time limit.');
		}
	};
	const frontmatter = readFrontmatter(text);
	const propertyValues = safeProperties(frontmatter?.source);
	checkBudget(true);
	const aliases = stringValues(propertyValues.aliases ?? propertyValues.alias)
		.filter(isSafeWikiAlias)
		.slice(0, MAX_INDEX_ALIASES);
	const propertyTags = stringValues(propertyValues.tags ?? propertyValues.tag)
		.map(normalizeTag)
		.filter(isBoundedTag);
	const searchable = maskCode(text, frontmatter?.end ?? 0, checkBudget);
	const lineStarts = buildLineStarts(searchable);
	const headings: VaultHeading[] = [];
	const blockIds = new Set<string>();
	const tags = new Set<string>(propertyTags);
	const links: VaultLink[] = [];
	const tasks: VaultTask[] = [];

	let lineNumber = 0;
	for (const line of searchable.split(/\r?\n/)) {
		checkBudget();
		lineNumber++;
		const heading = /^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
		if (heading && headings.length < MAX_INDEX_ENTRIES_PER_FIELD) {
			const headingText = heading[2].trim();
			if (headingText.length <= MAX_INDEX_HEADING_TEXT_LENGTH) {
				headings.push({ level: heading[1].length, text: headingText, line: lineNumber });
			}
		}
		const task = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[([ xX])\][ \t]+(.+)$/.exec(line);
		if (task && tasks.length < MAX_INDEX_ENTRIES_PER_FIELD) {
			const taskText = task[2].trim();
			if (taskText.length <= MAX_INDEX_TASK_TEXT_LENGTH) {
				tasks.push({ completed: task[1].toLocaleLowerCase() === 'x', text: taskText, line: lineNumber });
			}
		}
		for (const block of line.matchAll(/(?:^|\s)\^([A-Za-z0-9][A-Za-z0-9-]{0,127})(?=\s|$)/g)) {
			if (blockIds.size < MAX_INDEX_ENTRIES_PER_FIELD) blockIds.add(block[1]);
		}
		for (const tag of line.matchAll(/(^|[\s(\[{>])#([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)/gu)) {
			const normalized = normalizeTag(tag[2]);
			if (tags.size < MAX_INDEX_ENTRIES_PER_FIELD && isBoundedTag(normalized)) tags.add(normalized);
		}
	}

	// A new opening bracket cannot belong to these simple link forms. Exclude
	// it so long unmatched bracket runs cannot trigger quadratic backtracking
	// before the cooperative parsing budget gets a chance to run.
	for (const match of searchable.matchAll(/(!?)\[\[([^\[\]\n]+)\]\]/g)) {
		checkBudget();
		if (links.length >= MAX_INDEX_ENTRIES_PER_FIELD) break;
		const body = match[2];
		const aliasAt = body.indexOf('|');
		const targetAndFragment = aliasAt < 0 ? body : body.slice(0, aliasAt);
		const hashAt = targetAndFragment.search(/[#^]/);
		const target = (hashAt < 0 ? targetAndFragment : targetAndFragment.slice(0, hashAt)).trim();
		const fragment = hashAt < 0 ? undefined : targetAndFragment.slice(hashAt);
		if (!target || target.length > MAX_INDEX_LINK_TARGET_LENGTH || (fragment?.length ?? 0) > MAX_INDEX_LINK_FRAGMENT_LENGTH) continue;
		links.push({
			kind: match[1] ? 'wikiEmbed' : 'wikilink',
			target,
			line: lineAtOffset(lineStarts, match.index ?? 0),
			...(fragment === undefined ? {} : { fragment }),
		});
	}
	for (const match of searchable.matchAll(/!?\[[^\[\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))/g)) {
		checkBudget();
		if (links.length >= MAX_INDEX_ENTRIES_PER_FIELD) break;
		const raw = (match[1] ?? match[2] ?? '').trim();
		if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) continue;
		const hashAt = raw.indexOf('#');
		const target = hashAt < 0 ? raw : raw.slice(0, hashAt);
		const fragment = hashAt < 0 ? undefined : raw.slice(hashAt);
		if (target.length > MAX_INDEX_LINK_TARGET_LENGTH || (fragment?.length ?? 0) > MAX_INDEX_LINK_FRAGMENT_LENGTH) continue;
		links.push({
			kind: match[0].startsWith('!') ? 'markdownEmbed' : 'markdown',
			target,
			line: lineAtOffset(lineStarts, match.index ?? 0),
			...(fragment === undefined ? {} : { fragment }),
		});
	}

	const noteName = basename(path, extname(path));
	const searchTokens = collectBoundedSearchTokens(
		[noteName, path, ...aliases, ...headings.map((heading) => heading.text), ...tags, searchable],
		checkBudget,
	);
	checkBudget(true);
	return {
		path,
		basename: noteName,
		headings,
		blockIds: [...blockIds],
		aliases,
		tags: [...tags].sort((a, b) => a.localeCompare(b)),
		// The persistent and live index retain property names only. Arbitrary
		// frontmatter values may contain credentials or private note content;
		// value filters are verified on demand against the authoritative file.
		properties: Object.fromEntries(Object.keys(propertyValues).map((key) => [key, null])),
		links,
		tasks,
		searchTokens,
	};
}

/** Parses bounded frontmatter values for one on-demand operation only. */
export function extractVaultPropertyValues(text: string): Readonly<Record<string, unknown>> {
	return safeProperties(readFrontmatter(text)?.source);
}

/** Extracts bounded unique terms without first allocating a vault-record-sized joined string. */
export function collectBoundedSearchTokens(sources: Iterable<string>, checkBudget?: () => void): string[] {
	const tokens = new Set<string>();
	for (const source of sources) {
		// Single-character terms are valid Obsidian note names and aliases. Keep
		// them in the bounded index so names such as "A", "R", and "C++" can
		// reach the exact unlinked-mention verifier. The verifier still checks the
		// complete literal with Unicode-aware boundaries, so this broader token is
		// only a candidate hint and cannot create a false backlink.
		for (const match of source.toLocaleLowerCase().matchAll(/[\p{L}\p{N}_-]+/gu)) {
			checkBudget?.();
			const token = match[0];
			if (token.length <= MAX_INDEX_SEARCH_TOKEN_LENGTH) tokens.add(token);
			if (tokens.size >= MAX_INDEX_ENTRIES_PER_FIELD) return [...tokens];
		}
	}
	return [...tokens];
}

function buildLineStarts(text: string): number[] {
	const starts = [0];
	for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) starts.push(index + 1);
	return starts;
}

function lineAtOffset(starts: readonly number[], offset: number): number {
	let low = 0;
	let high = starts.length;
	while (low + 1 < high) {
		const middle = (low + high) >>> 1;
		if (starts[middle] <= offset) low = middle;
		else high = middle;
	}
	return low + 1;
}

function readFrontmatter(text: string): { source: string; end: number } | undefined {
	if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return undefined;
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
	return match ? { source: match[1], end: match[0].length } : undefined;
}

function safeProperties(source: string | undefined): Readonly<Record<string, unknown>> {
	if (source === undefined) return {};
	try {
		const parsed = parseFrontmatterYaml(source);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
	} catch {
		return {};
	}
}

function stringValues(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === 'string');
}

function normalizeTag(value: string): string {
	return value.trim().replace(/^#/, '').toLocaleLowerCase();
}

function isBoundedTag(value: string): boolean {
	return value.length > 0 && value.length <= MAX_INDEX_TAG_LENGTH;
}

function maskCode(text: string, frontmatterEnd: number, checkBudget: () => void): string {
	// Every parser offset below is a JavaScript UTF-16 code-unit offset. Using
	// `[...text]` here produced Unicode code points instead, so an astral
	// character (for example an emoji) shifted every later mask position and
	// could expose code-like links or tags to the metadata index.
	const chars = text.split('');
	for (let index = 0; index < frontmatterEnd; index++) {
		if (index % 1024 === 0) checkBudget();
		if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' ';
	}
	for (const [relativeFrom, relativeTo] of markdownCodeRanges(text.slice(frontmatterEnd))) {
		const from = frontmatterEnd + relativeFrom;
		const to = frontmatterEnd + relativeTo;
		for (let index = from; index < to; index++) {
			if (index % 1024 === 0) checkBudget();
			if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' ';
		}
	}
	return chars.join('');
}
