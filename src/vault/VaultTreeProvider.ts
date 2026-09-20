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

export class VaultTreeProvider implements vscode.TreeDataProvider<VaultNode>, vscode.Disposable {
	private readonly changeEmitter = new vscode.EventEmitter<VaultNode | undefined | null>();
	readonly onDidChangeTreeData = this.changeEmitter.event;
	private resolution: VaultResolution = { available: false, reason: 'noWorkspace' };
	private watcher: vscode.FileSystemWatcher | undefined;

	async initialize(isCurrent: () => boolean = () => true): Promise<void> {
		const resolution = await VaultService.resolve();
		if (!isCurrent()) return;
		this.resolution = resolution;
		this.watcher?.dispose();
		this.watcher = undefined;
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
		this.resolution = { available: false, reason };
		this.refresh();
	}

	get service(): VaultService | undefined {
		return this.resolution.available ? this.resolution.service : undefined;
	}

	refresh(element?: VaultNode): void {
		this.changeEmitter.fire(element);
	}

	private refreshParent(uri: vscode.Uri): void {
		if (!this.resolution.available) return this.refresh();
		const parent = vscode.Uri.file(dirname(uri.fsPath));
		if (parent.toString() === this.resolution.service.rootUri.toString()) return this.refresh();
		const relative = this.resolution.service.relativePath(parent);
		if (relative === undefined) return this.refresh();
		this.refresh(new VaultEntry(parent, vscode.FileType.Directory, vscode.Uri.file(dirname(parent.fsPath)), relative));
	}

	getTreeItem(element: VaultNode): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: VaultNode): Promise<VaultNode[]> {
		if (!this.resolution.available) return element ? [] : [new VaultUnavailableItem(this.resolution.reason)];
		if (element instanceof VaultUnavailableItem) return [];
		const parent = element instanceof VaultEntry ? element.uri : this.resolution.service.rootUri;
		if (element instanceof VaultEntry && (element.fileType & vscode.FileType.SymbolicLink)) return [];
		let entries: readonly (readonly [string, vscode.FileType])[];
		try {
			entries = await this.resolution.service.readDirectoryInside(parent);
		} catch {
			return [];
		}
		const exclude = vscode.workspace.getConfiguration('mdLivePreview.vault', this.resolution.service.rootUri).get<string[]>('exclude', []);
		const parentPath = this.resolution.service.relativePath(parent) ?? '';
		const isExcluded = compileVaultExclusions(exclude);
		const visible = entries.filter(([name]) => !isExcluded(parentPath ? `${parentPath}/${name}` : name));
		const nodes = visible.map(([name, type]) => {
			const path = parentPath ? `${parentPath}/${name}` : name;
			return new VaultEntry(vscode.Uri.joinPath(parent, name), type, parent, path);
		});
		return this.sort(nodes);
	}

	getParent(element: VaultNode): VaultNode | undefined {
		if (!(element instanceof VaultEntry) || !this.resolution.available) return undefined;
		if (element.parentUri.toString() === this.resolution.service.rootUri.toString()) return undefined;
		const path = this.resolution.service.relativePath(element.parentUri);
		return path === undefined ? undefined : new VaultEntry(
			element.parentUri,
			vscode.FileType.Directory,
			vscode.Uri.file(dirname(element.parentUri.fsPath)),
			path,
		);
	}

	async entryForUri(uri: vscode.Uri): Promise<VaultEntry | undefined> {
		if (!this.resolution.available) return undefined;
		let canonical: vscode.Uri;
		try {
			canonical = await this.resolution.service.canonicalExistingUri(uri);
		} catch {
			return undefined;
		}
		const path = this.resolution.service.relativePath(canonical);
		const exclude = vscode.workspace.getConfiguration('mdLivePreview.vault', this.resolution.service.rootUri).get<string[]>('exclude', []);
		if (path === undefined || !path || isVaultPathExcluded(path, exclude)) return undefined;
		return new VaultEntry(canonical, vscode.FileType.File, vscode.Uri.file(dirname(canonical.fsPath)), path);
	}

	private async sort(nodes: VaultEntry[]): Promise<VaultEntry[]> {
		if (!this.resolution.available) return nodes;
		const order = vscode.workspace.getConfiguration('mdLivePreview.vault', this.resolution.service.rootUri).get<string>('sortOrder', 'nameAsc');
		const direction = order.endsWith('Desc') || order.endsWith('Newest') ? -1 : 1;
		if (order.startsWith('name')) {
			return nodes.sort((a, b) => folderFirst(a, b) || direction * basename(a.uri.fsPath).localeCompare(basename(b.uri.fsPath), undefined, { numeric: true, sensitivity: 'base' }));
		}
		const service = this.resolution.service;
		const stats = new Map<string, { created: number; modified: number }>();
		await Promise.all(nodes.map(async (node) => {
			try {
				const stat = await service.statEntryInside(node.uri);
				stats.set(node.uri.toString(), { created: stat.birthtimeMs, modified: stat.mtimeMs });
			} catch { /* item changed while sorting */ }
		}));
		const created = order.startsWith('created');
		return nodes.sort((a, b) => folderFirst(a, b) || direction * (((stats.get(a.uri.toString())?.[created ? 'created' : 'modified']) ?? 0) - ((stats.get(b.uri.toString())?.[created ? 'created' : 'modified']) ?? 0)));
	}

	dispose(): void {
		this.watcher?.dispose();
		this.changeEmitter.dispose();
	}
}

function folderFirst(a: VaultEntry, b: VaultEntry): number {
	return Number(Boolean(b.fileType & vscode.FileType.Directory)) - Number(Boolean(a.fileType & vscode.FileType.Directory));
}
