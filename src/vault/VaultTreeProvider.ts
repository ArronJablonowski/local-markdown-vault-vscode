import * as vscode from 'vscode';
import { basename, dirname } from 'node:path';
import { VaultService, type VaultResolution, type VaultUnavailableReason } from './VaultService';
import { compileVaultExclusions, isVaultPathExcluded } from './vaultExclusions';

export class VaultEntry extends vscode.TreeItem {
	constructor(
		readonly uri: vscode.Uri,
		readonly fileType: vscode.FileType,
		readonly parentUri: vscode.Uri,
		readonly vaultPath: string,
	) {
		const folder = Boolean(fileType & vscode.FileType.Directory);
		const symlink = Boolean(fileType & vscode.FileType.SymbolicLink);
		super(uri, folder && !symlink ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
		this.id = uri.toString();
		this.resourceUri = uri;
		this.contextValue = symlink ? 'vaultSymlink' : folder ? 'vaultFolder' : 'vaultFile';
		this.tooltip = vaultPath;
		this.accessibilityInformation = {
			label: symlink
				? vscode.l10n.t('Symbolic link: {0}', vaultPath)
				: folder
					? vscode.l10n.t('Folder: {0}', vaultPath)
					: vscode.l10n.t('File: {0}', vaultPath),
		};
		if (!folder) this.command = { command: 'mdLivePreview.vault.open', title: vscode.l10n.t('Open'), arguments: [this] };
	}
}

class VaultUnavailableItem extends vscode.TreeItem {
	constructor(reason: VaultUnavailableReason) {
		const labels: Record<VaultUnavailableReason, string> = {
			noWorkspace: vscode.l10n.t('Open a local folder to use Document Vault'),
			multipleWorkspaces: vscode.l10n.t('Document Vault supports one workspace folder'),
			nonLocalWorkspace: vscode.l10n.t('Document Vault supports local folders only'),
		};
		super(labels[reason], vscode.TreeItemCollapsibleState.None);
		this.contextValue = 'vaultUnavailable';
		this.iconPath = new vscode.ThemeIcon('info');
	}
}

type VaultNode = VaultEntry | VaultUnavailableItem;
interface RevealGuard {
	isCurrent: () => boolean;
	entries: Set<VaultEntry>;
}

export class VaultTreeProvider implements vscode.TreeDataProvider<VaultNode>, vscode.Disposable {
	private static readonly SETTLED_REFRESH_DELAY_MS = 50;
	private readonly changeEmitter = new vscode.EventEmitter<VaultNode | undefined | null>();
	readonly onDidChangeTreeData = this.changeEmitter.event;
	private resolution: VaultResolution = { available: false, reason: 'noWorkspace' };
	private watcher: vscode.FileSystemWatcher | undefined;
	private settledRefreshTimer: ReturnType<typeof setTimeout> | undefined;
	private generation = 0;
	private readonly revealGuards = new WeakMap<VaultEntry, RevealGuard>();

	/** Guard request-only clones while VS Code waits for its tree refresh. */
	async revealWhileCurrent(entry: VaultEntry, isCurrent: () => boolean, reveal: (entry: VaultEntry) => PromiseLike<unknown>): Promise<void> {
		const guard: RevealGuard = { isCurrent, entries: new Set() };
		const clone = this.guardRevealEntry(new VaultEntry(entry.uri, entry.fileType, entry.parentUri, entry.vaultPath), guard);
		try {
			this.assertRevealCurrent(clone);
			await reveal(clone);
		} finally {
			// The host may retain a resolved item. Never leave a stale cancellation
			// predicate on an item after this one passive request has completed.
			for (const item of guard.entries) this.revealGuards.delete(item);
		}
	}

	private guardRevealEntry(entry: VaultEntry, guard: RevealGuard): VaultEntry {
		this.revealGuards.set(entry, guard);
		guard.entries.add(entry);
		return entry;
	}

	private assertRevealCurrent(entry: VaultNode): void {
		const guard = entry instanceof VaultEntry ? this.revealGuards.get(entry) : undefined;
		if (guard && !guard.isCurrent()) throw new vscode.CancellationError();
	}

	async initialize(isCurrent: () => boolean = () => true): Promise<void> {
		const resolution = await VaultService.resolve();
		if (!isCurrent()) return;
		this.resolution = resolution;
		this.watcher?.dispose();
		this.watcher = undefined;
		this.clearSettledRefresh();
		if (this.resolution.available) {
			this.watcher = vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(this.resolution.service.rootUri, '**/*'),
			);
			this.watcher.onDidCreate((uri) => this.refreshParent(uri));
			this.watcher.onDidChange((uri) => this.refreshParent(uri));
			this.watcher.onDidDelete((uri) => this.refreshParent(uri));
		}
		this.refresh();
	}

	/**
	 * Synchronously drops filesystem authority before an asynchronous workspace
	 * reconfiguration begins. Commands must observe no service during that gap.
	 */
	invalidate(reason: VaultUnavailableReason = 'noWorkspace'): void {
		this.watcher?.dispose();
		this.watcher = undefined;
		this.clearSettledRefresh();
		this.resolution = { available: false, reason };
		this.refresh();
	}

	get service(): VaultService | undefined {
		return this.resolution.available ? this.resolution.service : undefined;
	}

	refresh(element?: VaultNode): void {
		this.generation++;
		this.changeEmitter.fire(element);
	}

	private refreshParent(uri: vscode.Uri): void {
		if (!this.resolution.available) return this.refresh();
		const parent = vscode.Uri.file(dirname(uri.fsPath));
		if (parent.toString() === this.resolution.service.rootUri.toString()) {
			this.refresh();
			this.scheduleSettledRefresh();
			return;
		}
		const relative = this.resolution.service.relativePath(parent);
		if (relative === undefined) {
			this.refresh();
			this.scheduleSettledRefresh();
			return;
		}
		this.refresh(new VaultEntry(parent, vscode.FileType.Directory, vscode.Uri.file(dirname(parent.fsPath)), relative));
		this.scheduleSettledRefresh();
	}

	/**
	 * Native filesystem providers can coalesce a folder rename into incomplete
	 * create/delete batches. Keep the first targeted refresh immediate, then do
	 * one inexpensive full-tree refresh after the event burst has settled.
	 */
	private scheduleSettledRefresh(): void {
		this.clearSettledRefresh();
		this.settledRefreshTimer = setTimeout(() => {
			this.settledRefreshTimer = undefined;
			this.refresh();
		}, VaultTreeProvider.SETTLED_REFRESH_DELAY_MS);
	}

	private clearSettledRefresh(): void {
		if (this.settledRefreshTimer !== undefined) clearTimeout(this.settledRefreshTimer);
		this.settledRefreshTimer = undefined;
	}

	getTreeItem(element: VaultNode): vscode.TreeItem {
		this.assertRevealCurrent(element);
		return element;
	}

	async getChildren(element?: VaultNode): Promise<VaultNode[]> {
		const resolution = this.resolution;
		// A refreshed tree must not publish children returned by an older directory read.
		const generation = this.generation;
		if (!resolution.available) return element ? [] : [new VaultUnavailableItem(resolution.reason)];
		if (element instanceof VaultUnavailableItem) return [];
		const service = resolution.service;
		const parent = element instanceof VaultEntry ? element.uri : service.rootUri;
		if (element instanceof VaultEntry && (element.fileType & vscode.FileType.SymbolicLink)) return [];
		let entries: readonly (readonly [string, vscode.FileType])[];
		try {
			entries = await service.readDirectoryInside(parent);
		} catch {
			return [];
		}
		if (generation !== this.generation || this.service !== service) return [];
		const exclude = vscode.workspace.getConfiguration('mdLivePreview.vault', service.rootUri).get<string[]>('exclude', []);
		const parentPath = service.relativePath(parent);
		if (parentPath === undefined) return [];
		const isExcluded = compileVaultExclusions(exclude);
		const visible = entries.filter(([name]) => !isExcluded(parentPath ? `${parentPath}/${name}` : name));
		const nodes = visible.map(([name, type]) => {
			const path = parentPath ? `${parentPath}/${name}` : name;
			return new VaultEntry(vscode.Uri.joinPath(parent, name), type, parent, path);
		});
		return this.sort(nodes, service, generation);
	}

	getParent(element: VaultNode): VaultNode | undefined {
		this.assertRevealCurrent(element);
		if (!(element instanceof VaultEntry) || !this.resolution.available) return undefined;
		if (element.parentUri.toString() === this.resolution.service.rootUri.toString()) return undefined;
		const path = this.resolution.service.relativePath(element.parentUri);
		const parent = path === undefined ? undefined : new VaultEntry(
			element.parentUri,
			vscode.FileType.Directory,
			vscode.Uri.file(dirname(element.parentUri.fsPath)),
			path,
		);
		const guard = this.revealGuards.get(element);
		return parent && guard ? this.guardRevealEntry(parent, guard) : parent;
	}

	async entryForUri(uri: vscode.Uri): Promise<VaultEntry | undefined> {
		const resolution = this.resolution;
		const generation = this.generation;
		if (!resolution.available) return undefined;
		const service = resolution.service;
		let canonical: vscode.Uri;
		try {
			canonical = await service.canonicalExistingUri(uri);
		} catch {
			return undefined;
		}
		if (generation !== this.generation || this.service !== service) return undefined;
		const path = service.relativePath(canonical);
		const exclude = vscode.workspace.getConfiguration('mdLivePreview.vault', service.rootUri).get<string[]>('exclude', []);
		if (path === undefined || !path || isVaultPathExcluded(path, exclude)) return undefined;
		return new VaultEntry(canonical, vscode.FileType.File, vscode.Uri.file(dirname(canonical.fsPath)), path);
	}

	private async sort(nodes: VaultEntry[], service: VaultService, generation: number): Promise<VaultEntry[]> {
		if (generation !== this.generation || this.service !== service) return [];
		const order = vscode.workspace.getConfiguration('mdLivePreview.vault', service.rootUri).get<string>('sortOrder', 'nameAsc');
		const direction = order.endsWith('Desc') || order.endsWith('Newest') ? -1 : 1;
		if (order.startsWith('name')) {
			return nodes.sort((a, b) => folderFirst(a, b) || direction * basename(a.uri.fsPath).localeCompare(basename(b.uri.fsPath), undefined, { numeric: true, sensitivity: 'base' }));
		}
		const stats = new Map<string, { created: number; modified: number }>();
		// Name sorting avoids disk metadata reads; date sorting still uses confined entry checks.
		await Promise.all(nodes.map(async (node) => {
			try {
				const stat = await service.statEntryInside(node.uri);
				stats.set(node.uri.toString(), { created: stat.birthtimeMs, modified: stat.mtimeMs });
			} catch { /* item changed while sorting */ }
		}));
		if (generation !== this.generation || this.service !== service) return [];
		const created = order.startsWith('created');
		return nodes.sort((a, b) => folderFirst(a, b) || direction * (((stats.get(a.uri.toString())?.[created ? 'created' : 'modified']) ?? 0) - ((stats.get(b.uri.toString())?.[created ? 'created' : 'modified']) ?? 0)));
	}

	dispose(): void {
		this.generation++;
		this.clearSettledRefresh();
		this.watcher?.dispose();
		this.changeEmitter.dispose();
	}
}

function folderFirst(a: VaultEntry, b: VaultEntry): number {
	return Number(Boolean(b.fileType & vscode.FileType.Directory)) - Number(Boolean(a.fileType & vscode.FileType.Directory));
}
