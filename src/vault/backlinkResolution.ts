import { posix } from 'node:path';
import type { VaultIndexRecord } from './VaultIndex';
import type { VaultLink } from './vaultMetadata';

/**
 * Resolves one indexed outgoing link against a particular backlink target.
 * Wiki basenames and aliases count only when they identify exactly one note;
 * an ambiguous link must not appear as a backlink on every possible target.
 */
export class BacklinkResolver {
	private readonly paths = new Map<string, Set<string>>();
	private readonly basenames = new Map<string, Set<string>>();
	private readonly aliases = new Map<string, Set<string>>();
	private readonly filesystemKey: (value: string) => string;

	constructor(records: readonly VaultIndexRecord[], filesystemCaseInsensitive = process.platform !== 'linux') {
		this.filesystemKey = filesystemCaseInsensitive ? (value) => value.toLocaleLowerCase() : (value) => value;
		for (const record of records) {
			// Obsidian-style wikilinks are case-insensitive even when the backing
			// filesystem is not. Ordinary Markdown paths below retain filesystem
			// case semantics because VS Code ultimately opens that exact path.
			const path = wikiKey(stripExtension(normalize(record.path)));
			add(this.paths, path, path);
			add(this.basenames, wikiKey(record.basename), path);
			for (const alias of record.aliases) add(this.aliases, wikiKey(alias), path);
		}
	}

	targetsPath(sourcePath: string, link: VaultLink, activePath: string): boolean {
		const decoded = safeDecode(link.target.split('?')[0]).replace(/\\/g, '/').trim();
		if (!decoded) return false;

		if (link.kind === 'wikilink' || link.kind === 'wikiEmbed') {
			const active = wikiKey(stripExtension(normalize(activePath)));
			const wanted = wikiKey(stripExtension(normalize(decoded.replace(/^\//, ''))));
			const exactPaths = this.paths.get(wanted);
			const candidates = exactPaths?.size
				? new Set(exactPaths)
				: !decoded.includes('/') && this.basenames.get(wanted)?.size
					? new Set(this.basenames.get(wanted))
					: !decoded.includes('/')
						? new Set(this.aliases.get(wanted))
						: new Set<string>();
			return candidates.size === 1 && candidates.has(active);
		}

		const resolved = decoded.startsWith('/')
			? normalize(decoded.slice(1))
			: normalize(posix.join(posix.dirname(sourcePath), decoded));
		return this.filesystemKey(stripExtension(resolved)) === this.filesystemKey(stripExtension(normalize(activePath)));
	}
}

/** Convenience form for isolated callers and unit tests. */
export function indexedLinkTargetsPath(
	sourcePath: string,
	link: VaultLink,
	activePath: string,
	records: readonly VaultIndexRecord[],
	caseInsensitive = process.platform !== 'linux',
): boolean {
	return new BacklinkResolver(records, caseInsensitive).targetsPath(sourcePath, link, activePath);
}

function add(map: Map<string, Set<string>>, key: string, path: string): void {
	const values = map.get(key) ?? new Set<string>();
	values.add(path);
	map.set(key, values);
}

function wikiKey(value: string): string {
	return value.toLocaleLowerCase();
}

function stripExtension(value: string): string {
	return value.replace(/\.(?:md|markdown)$/i, '');
}

function normalize(value: string): string {
	return posix.normalize(value.replace(/\\/g, '/').replace(/^\.\//, '')).replace(/^\.\//, '');
}

function safeDecode(value: string): string {
	try { return decodeURIComponent(value); } catch { return value; }
}
