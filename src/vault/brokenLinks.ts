import { posix } from 'node:path';
import { wikiHeadingSlug } from './LinkResolver';
import type { VaultIndexRecord } from './VaultIndex';
import type { VaultLink } from './vaultMetadata';

export interface BrokenVaultLink {
	sourcePath: string;
	target: string;
	line: number;
	kind: VaultLink['kind'];
	reason: 'missing' | 'ambiguous' | 'fragment';
}

interface ResolutionIndex {
	filesystemKey: (value: string) => string;
	byPath: ReadonlyMap<string, VaultIndexRecord>;
	wikiPaths: ReadonlyMap<string, ReadonlySet<VaultIndexRecord>>;
	wikiBasenames: ReadonlyMap<string, ReadonlySet<VaultIndexRecord>>;
	wikiAliases: ReadonlyMap<string, ReadonlySet<VaultIndexRecord>>;
}

/** Resolves indexed note links locally and returns only unresolved targets/fragments. */
export function findBrokenVaultLinks(
	records: readonly VaultIndexRecord[],
	filesystemCaseInsensitive = process.platform !== 'linux',
	limit = 500,
): BrokenVaultLink[] {
	const resolution = createResolutionIndex(records, filesystemCaseInsensitive);
	const results: BrokenVaultLink[] = [];
	for (const source of records) {
		for (const link of source.links) {
			if (results.length >= limit) return results;
			const broken = inspectLink(source, link, resolution);
			if (broken) results.push(broken);
		}
	}
	return results;
}

/** UI form that yields between bounded link batches so a large vault cannot monopolize the extension host. */
export async function findBrokenVaultLinksAsync(
	records: readonly VaultIndexRecord[],
	filesystemCaseInsensitive = process.platform !== 'linux',
	limit = 500,
	isCancelled: () => boolean = () => false,
): Promise<BrokenVaultLink[]> {
	if (isCancelled()) return [];
	const resolution = createResolutionIndex(records, filesystemCaseInsensitive);
	const results: BrokenVaultLink[] = [];
	let processed = 0;
	for (const source of records) {
		if (isCancelled()) return [];
		for (const link of source.links) {
			if (isCancelled()) return [];
			if (results.length >= limit) return results;
			const broken = inspectLink(source, link, resolution);
			if (broken) results.push(broken);
			if (++processed % 250 === 0) {
				await new Promise<void>((resolve) => setTimeout(resolve, 0));
				if (isCancelled()) return [];
			}
		}
	}
	return results;
}

function createResolutionIndex(records: readonly VaultIndexRecord[], filesystemCaseInsensitive: boolean): ResolutionIndex {
	const filesystemKey = (value: string) => filesystemCaseInsensitive ? value.toLocaleLowerCase() : value;
	const byPath = new Map(records.map((record) => [filesystemKey(stripExtension(normalize(record.path))), record]));
	const wikiPaths = new Map<string, Set<VaultIndexRecord>>();
	const wikiBasenames = new Map<string, Set<VaultIndexRecord>>();
	const wikiAliases = new Map<string, Set<VaultIndexRecord>>();
	for (const record of records) {
		addCandidate(wikiPaths, wikiKey(stripExtension(normalize(record.path))), record);
		addCandidate(wikiBasenames, wikiKey(record.basename), record);
		for (const alias of record.aliases) addCandidate(wikiAliases, wikiKey(alias), record);
	}
	return { filesystemKey, byPath, wikiPaths, wikiBasenames, wikiAliases };
}

function inspectLink(source: VaultIndexRecord, link: VaultLink, resolution: ResolutionIndex): BrokenVaultLink | undefined {
	const candidates = resolveCandidates(source, link, resolution);
	if (candidates === undefined) return undefined;
	const target = displayTarget(link);
	if (candidates.length === 0) return { sourcePath: source.path, target, line: link.line, kind: link.kind, reason: 'missing' };
	if (candidates.length > 1) return { sourcePath: source.path, target, line: link.line, kind: link.kind, reason: 'ambiguous' };
	if (link.fragment && !fragmentExists(candidates[0], link.fragment)) {
		return { sourcePath: source.path, target, line: link.line, kind: link.kind, reason: 'fragment' };
	}
	return undefined;
}

function resolveCandidates(
	source: VaultIndexRecord,
	link: VaultLink,
	resolution: ResolutionIndex,
): VaultIndexRecord[] | undefined {
	const decoded = safeDecode(link.target.split('?')[0]).replace(/\\/g, '/').trim();
	if (!decoded) return [source];
	const extension = posix.extname(decoded).toLocaleLowerCase();
	// The note index cannot prove whether a non-Markdown attachment exists.
	if (extension && extension !== '.md' && extension !== '.markdown') return undefined;
	if (link.kind === 'wikilink' || link.kind === 'wikiEmbed') {
		// Match the editor's Obsidian-style resolver: exact vault paths take
		// precedence over basenames, which take precedence over aliases. Each tier
		// remains case-insensitive regardless of filesystem semantics.
		const wanted = wikiKey(stripExtension(normalize(decoded)));
		const exactPaths = resolution.wikiPaths.get(wanted);
		if (exactPaths?.size) return [...exactPaths];
		const basenames = resolution.wikiBasenames.get(wanted);
		if (basenames?.size) return [...basenames];
		return [...(resolution.wikiAliases.get(wanted) ?? [])];
	}
	const resolved = decoded.startsWith('/')
		? normalize(decoded.slice(1))
		: normalize(posix.join(posix.dirname(source.path), decoded));
	const exact = resolution.byPath.get(resolution.filesystemKey(stripExtension(resolved)));
	return exact ? [exact] : [];
}

function fragmentExists(record: VaultIndexRecord, fragment: string): boolean {
	const normalized = fragment.startsWith('#^') ? fragment.slice(1) : fragment;
	if (normalized.startsWith('^')) return record.blockIds.includes(normalized.slice(1));
	if (!normalized.startsWith('#')) return true;
	const wanted = wikiHeadingSlug(normalized.slice(1));
	return record.headings.some((heading) => wikiHeadingSlug(heading.text) === wanted);
}

function displayTarget(link: VaultLink): string {
	return `${link.target || '(current note)'}${link.fragment ?? ''}`;
}

function addCandidate(map: Map<string, Set<VaultIndexRecord>>, key: string, record: VaultIndexRecord): void {
	const records = map.get(key) ?? new Set<VaultIndexRecord>();
	records.add(record);
	map.set(key, records);
}

function wikiKey(value: string): string { return value.toLocaleLowerCase(); }

function stripExtension(value: string): string { return value.replace(/\.(?:md|markdown)$/i, ''); }
function normalize(value: string): string { return posix.normalize(value.replace(/\\/g, '/').replace(/^\.\//, '')).replace(/^\.\//, ''); }
function safeDecode(value: string): string { try { return decodeURIComponent(value); } catch { return value; } }
