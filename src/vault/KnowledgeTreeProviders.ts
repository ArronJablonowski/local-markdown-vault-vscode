import * as vscode from 'vscode';
import { VaultIndex, type VaultIndexRecord } from './VaultIndex';
import { buildTagTree, type TagTreeNode } from './tagTree';
import { findMentionContext, type MentionContext } from './mentionContext';
import { filterAndSortBacklinks, type BacklinkFilter, type BacklinkSort } from './backlinkOrdering';
import { findBrokenVaultLinksAsync, type BrokenVaultLink } from './brokenLinks';
import { BacklinkResolver } from './backlinkResolution';
import { collectBoundedSearchTokens } from './vaultMetadata';

export class BacklinkItem extends vscode.TreeItem {
	constructor(readonly record: VaultIndexRecord, readonly mentionKind: 'linked' | 'unlinked', context?: MentionContext) {
		super(record.basename, vscode.TreeItemCollapsibleState.None);
		this.description = mentionKind === 'linked'
			? (context ? `${record.path}:${context.line}` : record.path)
			: `${context ? `${record.path}:${context.line}` : record.path} · ${vscode.l10n.t('unlinked mention')}`;
		this.tooltip = context ? `${record.path}:${context.line}\n${context.context}` : record.path;
		this.iconPath = new vscode.ThemeIcon('references');
		this.command = { command: 'mdLivePreview.openIndexedPath', title: vscode.l10n.t('Open backlink'), arguments: [record.path, context?.line] };
		this.contextValue = mentionKind === 'linked' ? 'vaultBacklink' : 'vaultUnlinkedMention';
		this.accessibilityInformation = {
			label: mentionKind === 'linked'
				? vscode.l10n.t('Linked mention in {0}, line {1}', record.path, context?.line ?? 1)
				: vscode.l10n.t('Unlinked mention in {0}, line {1}', record.path, context?.line ?? 1),
		};
	}
}

export class VaultBacklinksProvider implements vscode.TreeDataProvider<BacklinkItem>, vscode.Disposable {
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.emitter.event;
	private index: VaultIndex | undefined;
	private indexListener: vscode.Disposable | undefined;
	private activePath: string | undefined;
	private filter: BacklinkFilter = 'all';
	private sort: BacklinkSort = 'linkedFirst';
	private generation = 0;

	setFilter(filter: BacklinkFilter): void { this.filter = filter; this.refresh(); }
	setSort(sort: BacklinkSort): void { this.sort = sort; this.refresh(); }
	getFilter(): BacklinkFilter { return this.filter; }
	getSort(): BacklinkSort { return this.sort; }

	setIndex(index: VaultIndex | undefined): void {
		this.indexListener?.dispose();
		this.index = index;
		this.indexListener = index?.onDidChange(() => this.refresh());
		this.refresh();
	}

	setActiveUri(uri: vscode.Uri | undefined): void {
		const next = uri && this.index?.vault.relativePath(uri);
		if (next === this.activePath) return;
		this.activePath = next;
		this.refresh();
	}

	getTreeItem(item: BacklinkItem): vscode.TreeItem { return item; }

	async getChildren(): Promise<BacklinkItem[]> {
		const index = this.index;
		const activePath = this.activePath;
		const generation = this.generation;
		if (!index || !activePath) return [];
		const active = index.get(activePath);
		if (!active) return [];
		const records = index.all();
		const resolver = new BacklinkResolver(records);
		// Tokens only shortlist unlinked mentions; the body read below verifies literal word edges.
		const mentionTokens = collectBoundedSearchTokens([active.basename, ...active.aliases]);
		const matches: Array<{ record: VaultIndexRecord; linked: boolean }> = [];
		let processedLinks = 0;
		let processedRecords = 0;
		for (const record of records) {
			if (generation !== this.generation) return [];
			if (record.path === activePath) continue;
			let linked = false;
			for (const link of record.links) {
				linked = resolver.targetsPath(record.path, link, activePath);
				if (++processedLinks % 250 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
				if (generation !== this.generation) return [];
				if (linked) break;
			}
			if (linked || mentionTokens.some((token) => record.searchTokens.includes(token))) {
				matches.push({ record, linked });
			}
			if (++processedRecords % 250 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
			if (generation !== this.generation) return [];
		}
		if (generation !== this.generation) return [];
		// Bound snippet reads after prioritizing real links; backlink lists are not full-vault search.
		matches
			.sort((a, b) => Number(b.linked) - Number(a.linked) || a.record.path.localeCompare(b.record.path))
			.splice(200);
		const items: Array<{ record: VaultIndexRecord; linked: boolean; context?: MentionContext } | undefined> = new Array(matches.length);
		let cursor = 0;
		const worker = async (): Promise<void> => {
			while (cursor < matches.length) {
				if (generation !== this.generation) return;
				const position = cursor++;
				const { record, linked } = matches[position];
				const text = await index.readText(record.path);
				if (generation !== this.generation) return;
				const context = text ? findMentionContext(text, [active.basename, ...active.aliases]) : undefined;
				if (linked || context) items[position] = { record, linked, ...(context ? { context } : {}) };
			}
		};
		await Promise.all(Array.from({ length: Math.min(8, matches.length) }, () => worker()));
		if (generation !== this.generation) return [];
		return filterAndSortBacklinks(
			items.filter((item): item is { record: VaultIndexRecord; linked: boolean; context?: MentionContext } => Boolean(item)),
			this.filter,
			this.sort,
		).map(({ record, linked, context }) => new BacklinkItem(record, linked ? 'linked' : 'unlinked', context));
	}

	refresh(): void { this.generation++; this.emitter.fire(); }
	dispose(): void { this.indexListener?.dispose(); this.emitter.dispose(); }
}

export class TagItem extends vscode.TreeItem {
	constructor(readonly node: TagTreeNode, root: boolean) {
		super(root ? `#${node.segment}` : node.segment, node.children.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
		const tag = node.path;
		this.description = String(node.count);
		this.iconPath = new vscode.ThemeIcon('tag');
		this.command = { command: 'mdLivePreview.searchTag', title: vscode.l10n.t('Search tag'), arguments: [tag] };
		this.contextValue = 'vaultTag';
		this.accessibilityInformation = { label: vscode.l10n.t('Tag {0}, {1} note(s)', tag, node.count) };
	}
}

export class VaultTagsProvider implements vscode.TreeDataProvider<TagItem>, vscode.Disposable {
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.emitter.event;
	private index: VaultIndex | undefined;
	private indexListener: vscode.Disposable | undefined;

	setIndex(index: VaultIndex | undefined): void {
		this.indexListener?.dispose();
		this.index = index;
		this.indexListener = index?.onDidChange(() => this.emitter.fire());
		this.emitter.fire();
	}

	getTreeItem(item: TagItem): vscode.TreeItem { return item; }

	getChildren(parent?: TagItem): TagItem[] {
		const nodes = parent?.node.children ?? buildTagTree(this.index?.all() ?? []);
		return nodes.map((node) => new TagItem(node, !parent));
	}

	dispose(): void { this.indexListener?.dispose(); this.emitter.dispose(); }
}

export class BrokenLinkItem extends vscode.TreeItem {
	constructor(readonly link: BrokenVaultLink) {
		super(link.target, vscode.TreeItemCollapsibleState.None);
		const reasons: Record<BrokenVaultLink['reason'], string> = {
			missing: vscode.l10n.t('missing target'),
			ambiguous: vscode.l10n.t('ambiguous target'),
			fragment: vscode.l10n.t('missing heading or block'),
		};
		this.description = `${link.sourcePath}:${link.line} · ${reasons[link.reason]}`;
		this.tooltip = `${link.sourcePath}:${link.line}\n${link.target}\n${reasons[link.reason]}`;
		this.iconPath = new vscode.ThemeIcon('warning');
		this.contextValue = 'vaultBrokenLink';
		this.command = {
			command: 'mdLivePreview.openIndexedPath',
			title: vscode.l10n.t('Open broken link source'),
			arguments: [link.sourcePath, link.line],
		};
		this.accessibilityInformation = {
			label: vscode.l10n.t(
				'Broken link {0}, {1}, in {2}, line {3}',
				link.target,
				reasons[link.reason],
				link.sourcePath,
				link.line,
			),
		};
	}
}

export class VaultBrokenLinksProvider implements vscode.TreeDataProvider<BrokenLinkItem>, vscode.Disposable {
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.emitter.event;
	private index: VaultIndex | undefined;
	private indexListener: vscode.Disposable | undefined;
	private generation = 0;

	setIndex(index: VaultIndex | undefined): void {
		this.indexListener?.dispose();
		this.index = index;
		this.indexListener = index?.onDidChange(() => this.refresh());
		this.refresh();
	}

	getTreeItem(item: BrokenLinkItem): vscode.TreeItem { return item; }
	async getChildren(): Promise<BrokenLinkItem[]> {
		const index = this.index;
		// Index changes invalidate the whole asynchronous result, including already checked links.
		const generation = this.generation;
		const links = await findBrokenVaultLinksAsync(
			index?.all() ?? [],
			process.platform !== 'linux',
			500,
			() => generation !== this.generation || index !== this.index,
		);
		return generation === this.generation && index === this.index
			? links.map((link) => new BrokenLinkItem(link))
			: [];
	}
	private refresh(): void { this.generation++; this.emitter.fire(); }
	dispose(): void { this.indexListener?.dispose(); this.emitter.dispose(); }
}
