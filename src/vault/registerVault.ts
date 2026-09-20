import * as vscode from 'vscode';
import { dirname } from 'node:path';
import { validateVaultEntryName, noteFileName, validateVaultRelativeNotePath } from './vaultName';
import { VaultEntry, VaultTreeProvider } from './VaultTreeProvider';
import { LinkRewriteService, VaultTransactionConflictError } from './LinkRewriteService';
import { VaultIndex, type VaultIndexRecord } from './VaultIndex';
import { VaultBacklinksProvider, VaultBrokenLinksProvider, VaultTagsProvider } from './KnowledgeTreeProviders';
import { searchVaultWithContext, type VaultSearchResult } from './VaultSearchService';
import type { VaultService } from './VaultService';
import type { BacklinkFilter, BacklinkSort } from './backlinkOrdering';
import { hasExactQuickSwitcherRecord, searchQuickSwitcherRecords } from './quickSwitcher';
import { validatedRecentPaths, vaultStateKey } from './vaultStateKey';
import { isBacklinkFilter, isBacklinkSort, migrateVaultScopedState } from './vaultStateMigration';
import { classifyVaultWorkspace } from './vaultWorkspace';
import { validateOpenIndexedPathArguments, validateSearchTagArgument } from './knowledgeCommandValidation';

export interface VaultRegistration {
	getIndex(): VaultIndex | undefined;
	getService(): VaultService | undefined;
	onDidChangeIndex: vscode.Event<void>;
	getRecentPaths(): readonly string[];
	getTreeRevision(): number;
	getTreePaths(parentPath?: string): Promise<readonly string[]>;
}

export async function registerVault(context: vscode.ExtensionContext): Promise<VaultRegistration> {
	const provider = new VaultTreeProvider();
	await provider.initialize();
	let treeRevision = 0;
	const treeRevisionListener = provider.onDidChangeTreeData(() => treeRevision++);
	context.subscriptions.push(treeRevisionListener);
	let index = provider.service ? new VaultIndex(provider.service, context) : undefined;
	if (index) {
		try { await index.initialize(); }
		catch (error) {
			showIndexWarning(error);
		}
		await migrateVaultScopedState(index.id, index.legacyIds, context.workspaceState);
		await pruneRecent(index, context);
	}
	let recentWrite: Promise<void> = Promise.resolve();
	let exclusionRefresh: Promise<void> = Promise.resolve();
	let workspaceRefresh: Promise<void> = Promise.resolve();
	let vaultGeneration = 0;
	const activeVaultPickers = new Set<vscode.QuickPick<vscode.QuickPickItem>>();
	const trackVaultPicker = <T extends vscode.QuickPickItem>(picker: vscode.QuickPick<T>): (() => void) => {
		const tracked = picker as vscode.QuickPick<vscode.QuickPickItem>;
		activeVaultPickers.add(tracked);
		return () => activeVaultPickers.delete(tracked);
	};
	const closeVaultPickers = () => {
		for (const picker of activeVaultPickers) {
			picker.hide();
			picker.dispose();
		}
		activeVaultPickers.clear();
	};
	context.subscriptions.push({
		dispose: () => {
			vaultGeneration++;
			closeVaultPickers();
		},
	});
	let suppressRecentTracking = false;
	const queueActiveNote = () => {
		if (suppressRecentTracking) return;
		recentWrite = recentWrite.catch(() => undefined).then(() => recordActiveNote(index, context));
	};
	queueActiveNote();
	const indexChanged = new vscode.EventEmitter<void>();
	let indexListener = index?.onDidChange(() => indexChanged.fire());
	let indexFailureListener = index?.onDidFail((error) => {
		if (index) void pruneRecent(index, context);
		showIndexWarning(error);
	});
	context.subscriptions.push({ dispose: () => index?.dispose() });
	context.subscriptions.push(indexChanged, {
		dispose: () => {
			indexListener?.dispose();
			indexFailureListener?.dispose();
		},
	});
	const backlinksProvider = new VaultBacklinksProvider();
	loadBacklinkPreferences(backlinksProvider, index, context);
	const tagsProvider = new VaultTagsProvider();
	const brokenLinksProvider = new VaultBrokenLinksProvider();
	backlinksProvider.setIndex(index);
	tagsProvider.setIndex(index);
	brokenLinksProvider.setIndex(index);
	backlinksProvider.setActiveUri(activeFileUri());
	context.subscriptions.push(
		backlinksProvider,
		tagsProvider,
		brokenLinksProvider,
		vscode.window.createTreeView('mdLivePreview.backlinks', { treeDataProvider: backlinksProvider }),
		vscode.window.createTreeView('mdLivePreview.tags', { treeDataProvider: tagsProvider }),
		vscode.window.createTreeView('mdLivePreview.brokenLinks', { treeDataProvider: brokenLinksProvider }),
	);
	const dragAndDropController = new VaultDragAndDropController(provider);
	const tree = vscode.window.createTreeView<VaultEntry>('mdLivePreview.vault', {
		treeDataProvider: provider as vscode.TreeDataProvider<VaultEntry>,
		dragAndDropController,
		canSelectMany: true,
		showCollapseAll: true,
	});
	context.subscriptions.push(provider, tree, dragAndDropController);
	const updateContext = async () => {
		await vscode.commands.executeCommand('setContext', 'mdLivePreview.vaultAvailable', Boolean(provider.service));
	};
	await updateContext();

	const selectedParent = async (entry?: unknown): Promise<{ service: VaultService; parent: vscode.Uri } | undefined> => {
		const service = provider.service;
		if (!service) return undefined;
		if (entry === undefined) return { service, parent: service.rootUri };
		const resolved = await resolveCommandEntry(provider, entry);
		if (!resolved || provider.service !== service) return undefined;
		return {
			service,
			parent: resolved.fileType & vscode.FileType.Directory ? resolved.uri : resolved.parentUri,
		};
	};

	const requireTrusted = (): boolean => {
		if (vscode.workspace.isTrusted) return true;
		void vscode.window.showWarningMessage(vscode.l10n.t('Trust this workspace to change Document Vault files.'));
		return false;
	};

	context.subscriptions.push(
		vscode.commands.registerCommand('mdLivePreview.quickSwitcher', async () => {
			const targetIndex = index;
			const generation = vaultGeneration;
			if (targetIndex) await showQuickSwitcher(
				targetIndex,
				provider,
				context,
				() => generation === vaultGeneration && targetIndex === index,
				trackVaultPicker,
			);
		}),
		vscode.commands.registerCommand('mdLivePreview.vaultSearch', async () => {
			const targetIndex = index;
			const generation = vaultGeneration;
			if (targetIndex) await showVaultSearch(
				targetIndex,
				context,
				'',
				() => generation === vaultGeneration && targetIndex === index,
				trackVaultPicker,
			);
		}),
		vscode.commands.registerCommand('mdLivePreview.vault.rebuildIndex', async () => {
			const targetIndex = index;
			const generation = vaultGeneration;
			if (!targetIndex) return;
			suppressRecentTracking = true;
			let rebuilt = false;
			try {
				await recentWrite.catch(() => undefined);
				if (generation !== vaultGeneration || targetIndex !== index) return;
				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: vscode.l10n.t('Rebuilding Document Vault index…'),
					cancellable: true,
				}, async (_progress, userCancellation) => {
					const cancellation = new vscode.CancellationTokenSource();
					if (userCancellation.isCancellationRequested) cancellation.cancel();
					const userListener = userCancellation.onCancellationRequested(() => cancellation.cancel());
					const workspaceListener = vscode.workspace.onDidChangeWorkspaceFolders(() => cancellation.cancel());
					try {
						if (generation !== vaultGeneration || targetIndex !== index) throw new vscode.CancellationError();
						await context.workspaceState.update(recentKey(targetIndex), undefined);
						if (cancellation.token.isCancellationRequested || generation !== vaultGeneration || targetIndex !== index) {
							throw new vscode.CancellationError();
						}
						await targetIndex.reset(cancellation.token);
						if (cancellation.token.isCancellationRequested || generation !== vaultGeneration || targetIndex !== index) {
							throw new vscode.CancellationError();
						}
						rebuilt = true;
					} finally {
						workspaceListener.dispose();
						userListener.dispose();
						cancellation.dispose();
					}
				});
			} catch (error) {
				if (!(error instanceof vscode.CancellationError)) throw error;
			} finally {
				suppressRecentTracking = false;
			}
			if (generation !== vaultGeneration || targetIndex !== index) return;
			if (rebuilt) announceVaultCompletion(vscode.l10n.t('Document Vault index rebuilt.'));
			else vscode.window.setStatusBarMessage(vscode.l10n.t('Document Vault index rebuild canceled.'), 3_000);
		}),
		vscode.commands.registerCommand('mdLivePreview.openIndexedPath', async (path: unknown, line?: unknown) => {
			const targetIndex = index;
			const request = validateOpenIndexedPathArguments(path, line);
			const record = request && targetIndex?.get(request.path);
			if (targetIndex && record) await openIndexedRecord(
				targetIndex,
				record,
				context,
				request.line,
				() => targetIndex === index,
			);
		}),
		vscode.commands.registerCommand('mdLivePreview.searchTag', async (tag: unknown) => {
			const targetIndex = index;
			const generation = vaultGeneration;
			const requestedTag = validateSearchTagArgument(tag);
			const exists = requestedTag && targetIndex?.all().some((record) =>
				record.tags.some((indexedTag) => indexedTag === requestedTag || indexedTag.startsWith(`${requestedTag}/`)),
			);
			if (targetIndex && requestedTag && exists) await showVaultSearch(
				targetIndex,
				context,
				`tag:${requestedTag}`,
				() => generation === vaultGeneration && targetIndex === index,
				trackVaultPicker,
			);
		}),
		vscode.commands.registerCommand('mdLivePreview.backlinks.filter', async () => {
			const targetIndex = index;
			if (!targetIndex) return;
			const choices: Array<vscode.QuickPickItem & { value: BacklinkFilter }> = [
				{ label: vscode.l10n.t('All mentions'), value: 'all' },
				{ label: vscode.l10n.t('Linked mentions only'), value: 'linked' },
				{ label: vscode.l10n.t('Unlinked mentions only'), value: 'unlinked' },
			];
			const selected = await vscode.window.showQuickPick(choices, {
				title: vscode.l10n.t('Filter Backlinks'),
				placeHolder: choices.find((choice) => choice.value === backlinksProvider.getFilter())?.label,
			});
			if (!selected || targetIndex !== index) return;
			backlinksProvider.setFilter(selected.value);
			await context.workspaceState.update(vaultStateKey(targetIndex.id, 'backlinks.filter'), selected.value);
		}),
		vscode.commands.registerCommand('mdLivePreview.backlinks.sort', async () => {
			const targetIndex = index;
			if (!targetIndex) return;
			const choices: Array<vscode.QuickPickItem & { value: BacklinkSort }> = [
				{ label: vscode.l10n.t('Linked mentions first'), value: 'linkedFirst' },
				{ label: vscode.l10n.t('Path'), value: 'path' },
				{ label: vscode.l10n.t('Recently modified'), value: 'modifiedNewest' },
			];
			const selected = await vscode.window.showQuickPick(choices, {
				title: vscode.l10n.t('Sort Backlinks'),
				placeHolder: choices.find((choice) => choice.value === backlinksProvider.getSort())?.label,
			});
			if (!selected || targetIndex !== index) return;
			backlinksProvider.setSort(selected.value);
			await context.workspaceState.update(vaultStateKey(targetIndex.id, 'backlinks.sort'), selected.value);
		}),
		vscode.commands.registerCommand('mdLivePreview.vault.refresh', () => provider.refresh()),
		vscode.commands.registerCommand('mdLivePreview.vault.expandAll', async () => {
			const service = provider.service;
			if (!service) return;
			const queue = (await provider.getChildren()).filter((node): node is VaultEntry => node instanceof VaultEntry);
			if (provider.service !== service) return;
			let visited = 0;
			while (queue.length && visited < 10_000) {
				if (provider.service !== service) return;
				const entry = queue.shift()!;
				visited++;
				if (!(entry.fileType & vscode.FileType.Directory) || entry.fileType & vscode.FileType.SymbolicLink) continue;
				await tree.reveal(entry, { expand: true, focus: false, select: false });
				if (provider.service !== service) return;
				const children = await provider.getChildren(entry);
				if (provider.service !== service) return;
				queue.push(...children.filter((node): node is VaultEntry => node instanceof VaultEntry));
			}
		}),
		vscode.commands.registerCommand('mdLivePreview.vault.collapseAll', async () => {
			await vscode.commands.executeCommand('workbench.actions.treeView.mdLivePreview.vault.collapseAll');
		}),
		vscode.commands.registerCommand('mdLivePreview.vault.open', async (entry: unknown) => {
			const service = provider.service;
			const item = await resolveCommandEntry(provider, entry);
			if (!item || !service || provider.service !== service) return;
			try {
				// Tree items are discovered lexically so a symlink remains visible and
				// can be renamed or moved as a link. Opening follows the target, so it
				// requires the stronger canonical containment check first.
				await service.assertRegularFileInside(item.uri);
				if (provider.service !== service) return;
				await vscode.commands.executeCommand('vscode.open', item.uri);
			} catch {
				if (provider.service === service) void vscode.window.showWarningMessage(vscode.l10n.t('The vault item could not be opened securely.'));
			}
		}),
		vscode.commands.registerCommand('mdLivePreview.vault.newNote', async (entry?: unknown) => {
			if (!requireTrusted()) return;
			const selected = await selectedParent(entry);
			if (!selected) return;
			const { parent, service } = selected;
			const name = await vscode.window.showInputBox({
				title: vscode.l10n.t('New note'),
				prompt: vscode.l10n.t('Name for the Markdown note'),
				validateInput: (value) => localizeVaultValidation(validateVaultEntryName(noteFileName(value))),
			});
			if (!name || provider.service !== service || !vscode.workspace.isTrusted) return;
			try {
				const uri = await service.createNote(
					parent,
					name,
					() => provider.service === service && vscode.workspace.isTrusted,
				);
				if (provider.service !== service || !vscode.workspace.isTrusted) return;
				provider.refresh();
				await vscode.commands.executeCommand('vscode.open', uri);
				announceVaultCompletion(vscode.l10n.t('Note "{0}" created.', service.relativePath(uri) ?? name));
			} catch (error) {
				if (provider.service === service) void vscode.window.showErrorMessage(safeError(error, vscode.l10n.t('Could not create the note.')));
			}
		}),
		vscode.commands.registerCommand('mdLivePreview.vault.newFolder', async (entry?: unknown) => {
			if (!requireTrusted()) return;
			const selected = await selectedParent(entry);
			if (!selected) return;
			const { parent, service } = selected;
			const name = await vscode.window.showInputBox({
				title: vscode.l10n.t('New folder'),
				validateInput: (value) => localizeVaultValidation(validateVaultEntryName(value)),
			});
			if (!name || provider.service !== service || !vscode.workspace.isTrusted) return;
			try {
				const uri = await service.createFolder(
					parent,
					name,
					() => provider.service === service && vscode.workspace.isTrusted,
				);
				if (provider.service !== service || !vscode.workspace.isTrusted) return;
				provider.refresh();
				announceVaultCompletion(vscode.l10n.t('Folder "{0}" created.', service.relativePath(uri) ?? name));
			} catch (error) {
				if (provider.service === service) void vscode.window.showErrorMessage(safeError(error, vscode.l10n.t('Could not create the folder.')));
			}
		}),
		vscode.commands.registerCommand('mdLivePreview.vault.rename', async (entry?: unknown) => {
			if (!requireTrusted()) return;
			const service = provider.service;
			const item = await resolveCommandEntry(provider, entry === undefined ? tree.selection[0] : entry);
			if (!item || !service || provider.service !== service) return;
			const currentName = basenameLabel(item.uri);
			const name = await vscode.window.showInputBox({
				title: vscode.l10n.t('Rename vault item'),
				value: currentName,
				valueSelection: item.fileType & vscode.FileType.Directory
					? [0, currentName.length]
					: [0, Math.max(0, currentName.lastIndexOf('.'))],
				validateInput: (value) => localizeVaultValidation(validateVaultEntryName(value)),
			});
			if (!name || name === currentName || provider.service !== service || !vscode.workspace.isTrusted) return;
			try {
				await service.assertMutationSource(item.uri, Boolean(item.fileType & vscode.FileType.SymbolicLink));
				const destination = await service.moveDestination(item.uri, item.parentUri, name);
				const applied = await new LinkRewriteService(service, {
					isCurrent: () => provider.service === service && vscode.workspace.isTrusted,
				}).renameOrMove(
					item.uri,
					destination,
					Boolean(item.fileType & vscode.FileType.Directory),
				);
				if (!applied) throw new Error('The workspace rejected the rename.');
				if (provider.service !== service) return;
				provider.refresh();
				announceVaultCompletion(vscode.l10n.t('Renamed to "{0}".', service.relativePath(destination) ?? name));
			} catch (error) {
				if (provider.service === service) void vscode.window.showErrorMessage(safeError(error, vscode.l10n.t('Could not rename the vault item.')));
			}
		}),
		vscode.commands.registerCommand('mdLivePreview.vault.move', async (entry?: unknown, selected?: unknown) => {
			if (!requireTrusted()) return;
			const items = await resolveCommandEntries(provider, entry, selected, tree.selection);
			if (items.length === 0 || !provider.service) return;
			try {
				const parent = await pickMoveDestination(provider, items);
				if (!parent) return;
				const moved = await moveVaultEntries(provider, items, parent);
				if (moved > 0) announceVaultCompletion(vscode.l10n.t('{0} vault item(s) moved.', moved));
			} catch (error) {
				void vscode.window.showErrorMessage(safeError(error, vscode.l10n.t('Could not move the vault item.')));
			}
		}),
		vscode.commands.registerCommand('mdLivePreview.vault.delete', async (entry?: unknown, selected?: unknown) => {
			if (!requireTrusted()) return;
			const service = provider.service;
			if (!service) return;
			const items = await resolveCommandEntries(provider, entry, selected, tree.selection);
			if (items.length === 0 || provider.service !== service) return;
			if (items.length !== 1) {
				void vscode.window.showWarningMessage(vscode.l10n.t('Move one vault item to trash at a time to avoid partial operations.'));
				return;
			}
			const item = items[0];
			try {
				await service.assertMutationSource(item.uri, Boolean(item.fileType & vscode.FileType.SymbolicLink));
			} catch (error) {
				void vscode.window.showErrorMessage(safeError(error, vscode.l10n.t('The item could not be moved to trash. No permanent delete was attempted.')));
				return;
			}
			const label = service.relativePath(item.uri) ?? basenameLabel(item.uri);
			let prompt = vscode.l10n.t('Move "{0}" to the operating system trash?', label);
			if ((item.fileType & vscode.FileType.Directory) && !(item.fileType & vscode.FileType.SymbolicLink)) {
				try {
					const contents = await service.countDescendants(item.uri);
					if (provider.service !== service) return;
					if (contents.count > 0) prompt = contents.truncated
						? vscode.l10n.t('Move folder "{0}" and at least {1} contained items to the operating system trash?', label, contents.count)
						: vscode.l10n.t('Move folder "{0}" and its {1} contained item(s) to the operating system trash?', label, contents.count);
				} catch {
					void vscode.window.showErrorMessage(vscode.l10n.t('The folder contents could not be verified, so nothing was deleted.'));
					return;
				}
			}
			const confirm = await vscode.window.showWarningMessage(
				prompt,
				{ modal: true },
				vscode.l10n.t('Move to Trash'),
			);
			if (confirm !== vscode.l10n.t('Move to Trash') || provider.service !== service || !vscode.workspace.isTrusted) return;
			try {
				await service.moveToTrash(
					item.uri,
					Boolean(item.fileType & vscode.FileType.SymbolicLink),
					() => provider.service === service && vscode.workspace.isTrusted,
				);
				if (provider.service !== service) return;
				provider.refresh();
				announceVaultCompletion(vscode.l10n.t('Moved "{0}" to Trash.', label));
			} catch {
				if (provider.service === service) void vscode.window.showErrorMessage(vscode.l10n.t('The item could not be moved to trash. No permanent delete was attempted.'));
			}
		}),
		vscode.commands.registerCommand('mdLivePreview.vault.copyRelativePath', async (entry?: unknown) => {
			const service = provider.service;
			const item = await resolveCommandEntry(provider, entry === undefined ? tree.selection[0] : entry);
			if (!item || !service || provider.service !== service) return;
			const relative = service.relativePath(item.uri);
			if (relative !== undefined && provider.service === service) await vscode.env.clipboard.writeText(relative);
		}),
		vscode.commands.registerCommand('mdLivePreview.vault.revealInOS', async (entry?: unknown) => {
			const service = provider.service;
			const item = await resolveCommandEntry(provider, entry === undefined ? tree.selection[0] : entry);
			if (!item || !service || provider.service !== service) return;
			try {
				await service.assertMutationSource(item.uri, Boolean(item.fileType & vscode.FileType.SymbolicLink));
				if (provider.service !== service) return;
				await vscode.commands.executeCommand('revealFileInOS', item.uri);
			} catch {
				if (provider.service === service) void vscode.window.showWarningMessage(vscode.l10n.t('The vault item could not be revealed securely.'));
			}
		}),
	);

	const revealActive = async () => {
		const service = provider.service;
		if (!service || !vscode.workspace.getConfiguration('mdLivePreview.vault', service.rootUri).get<boolean>('autoReveal', true)) return;
		const uri = activeFileUri();
		const entry = uri && await provider.entryForUri(uri);
		if (entry) {
			try {
				await tree.reveal(entry, { select: true, focus: false, expand: true });
			} catch {
				// The file may have been moved or deleted between the active-tab event
				// and tree resolution. A watcher refresh will converge the view; this
				// benign race must not become an unhandled extension-host rejection.
			}
		}
	};

	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			const generation = ++vaultGeneration;
			closeVaultPickers();
			indexListener?.dispose();
			indexFailureListener?.dispose();
			index?.dispose();
			index = undefined;
			indexListener = undefined;
			indexFailureListener = undefined;
			const classification = classifyVaultWorkspace(vscode.workspace.workspaceFolders);
			provider.invalidate(classification.available ? 'noWorkspace' : classification.reason);
			indexChanged.fire();
			backlinksProvider.setIndex(undefined);
			loadBacklinkPreferences(backlinksProvider, undefined, context);
			tagsProvider.setIndex(undefined);
			brokenLinksProvider.setIndex(undefined);
			backlinksProvider.setActiveUri(activeFileUri());
			void updateContext();

			workspaceRefresh = workspaceRefresh.catch(() => undefined).then(async () => {
				if (generation !== vaultGeneration) return;
				await provider.initialize(() => generation === vaultGeneration);
				if (generation !== vaultGeneration) {
					provider.invalidate();
					return;
				}
				const nextIndex = provider.service ? new VaultIndex(provider.service, context) : undefined;
				if (nextIndex) {
					try { await nextIndex.initialize(); }
					catch (error) {
						showIndexWarning(error);
					}
					if (generation !== vaultGeneration) {
						nextIndex.dispose();
						provider.invalidate();
						return;
					}
					await migrateVaultScopedState(nextIndex.id, nextIndex.legacyIds, context.workspaceState);
					await pruneRecent(nextIndex, context);
				}
				if (generation !== vaultGeneration) {
					nextIndex?.dispose();
					provider.invalidate();
					return;
				}
				index = nextIndex;
				indexListener = index?.onDidChange(() => indexChanged.fire());
				indexFailureListener = index?.onDidFail((error) => {
					if (index) void pruneRecent(index, context);
					showIndexWarning(error);
				});
				indexChanged.fire();
				backlinksProvider.setIndex(index);
				loadBacklinkPreferences(backlinksProvider, index, context);
				tagsProvider.setIndex(index);
				brokenLinksProvider.setIndex(index);
				backlinksProvider.setActiveUri(activeFileUri());
				await updateContext();
				queueActiveNote();
			}).catch((error) => {
				if (generation === vaultGeneration) showIndexWarning(error);
			});
		}),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('mdLivePreview.vault')) provider.refresh();
			if (event.affectsConfiguration('mdLivePreview.vault.exclude')) {
				// Serialize exclusion rebuilds. A rapid settings edit must not let an
				// older generation prune recent history against a half-rebuilt index.
				exclusionRefresh = exclusionRefresh.catch(() => undefined).then(async () => {
					const targetIndex = index;
					if (!targetIndex) return;
					try {
						await targetIndex.rebuild();
						if (targetIndex === index) await pruneRecent(targetIndex, context);
					} catch (error) {
						if (targetIndex === index) await pruneRecent(targetIndex, context);
						showIndexWarning(error);
					}
				});
			}
		}),
		vscode.window.onDidChangeActiveTextEditor(() => {
			void revealActive();
			backlinksProvider.setActiveUri(activeFileUri());
			queueActiveNote();
		}),
		vscode.window.tabGroups.onDidChangeTabs(() => {
			void revealActive();
			backlinksProvider.setActiveUri(activeFileUri());
			queueActiveNote();
		}),
		vscode.window.tabGroups.onDidChangeTabGroups(queueActiveNote),
	);
	return {
		getIndex: () => index,
		getService: () => provider.service,
		onDidChangeIndex: indexChanged.event,
		getRecentPaths: () => index ? context.workspaceState.get<string[]>(recentKey(index), []) : [],
		getTreeRevision: () => treeRevision,
		getTreePaths: async (parentPath = '') => {
			const service = provider.service;
			if (!service) return [];
			const parent = parentPath
				? new VaultEntry(
					service.uriForRelative(parentPath),
					vscode.FileType.Directory,
					vscode.Uri.file(dirname(service.uriForRelative(parentPath).fsPath)),
					parentPath,
				)
				: undefined;
			return (await provider.getChildren(parent))
				.filter((entry): entry is VaultEntry => entry instanceof VaultEntry)
				.map((entry) => entry.vaultPath);
		},
	};
}

interface VaultQuickPickItem extends vscode.QuickPickItem {
	record?: VaultIndexRecord;
	createName?: string;
	matchLine?: number;
}

async function showQuickSwitcher(
	index: VaultIndex,
	provider: VaultTreeProvider,
	context: vscode.ExtensionContext,
	isCurrent: () => boolean,
	trackPicker: <T extends vscode.QuickPickItem>(picker: vscode.QuickPick<T>) => () => void,
): Promise<void> {
	// Quick Switcher is an index-backed user action, so an unsaved alias or note
	// title must win even when the command lands inside the document debounce.
	await index.flushDocumentUpdates();
	if (!isCurrent()) return;
	const picker = vscode.window.createQuickPick<VaultQuickPickItem>();
	const untrack = trackPicker(picker);
	picker.title = vscode.l10n.t('Quick Switcher');
	picker.placeholder = vscode.l10n.t('Type a note name or path');
	picker.matchOnDescription = true;
	picker.matchOnDetail = true;
	const update = () => {
		const query = picker.value.trim();
		const allRecords = index.all();
		const records = query ? searchQuickSwitcherRecords(allRecords, query, 100) : recentRecords(index, context);
		const items: VaultQuickPickItem[] = records.map((record) => recordItem(record, Boolean(query)));
		if (vscode.workspace.isTrusted && query && !validateVaultRelativeNotePath(query) &&
			!hasExactQuickSwitcherRecord(allRecords, query)) {
			items.push({ label: `$(new-file) ${vscode.l10n.t('Create "{0}"', query)}`, createName: query });
		}
		picker.items = items;
	};
	const indexSubscription = index.onDidChange(update);
	picker.onDidChangeValue(update);
	picker.onDidAccept(async () => {
		if (!isCurrent()) return picker.hide();
		const selected = picker.selectedItems[0];
		if (!selected) return;
		picker.hide();
		if (selected.record) {
			await openIndexedRecord(index, selected.record, context, undefined, isCurrent);
			return;
		}
		const service = provider.service;
		if (selected.createName && vscode.workspace.isTrusted && service && isCurrent()) {
			const error = validateVaultRelativeNotePath(selected.createName);
			if (error) {
				void vscode.window.showErrorMessage(localizeVaultValidation(error) ?? vscode.l10n.t('Enter a valid vault item name.'));
				return;
			}
			try {
				const uri = await service.createNoteAtRelativePath(
					selected.createName,
					() => isCurrent() && provider.service === service && vscode.workspace.isTrusted,
				);
				if (!isCurrent() || provider.service !== service || !vscode.workspace.isTrusted) return;
				await vscode.commands.executeCommand('vscode.open', uri);
				announceVaultCompletion(vscode.l10n.t(
					'Note "{0}" created.',
					service.relativePath(uri) ?? selected.createName,
				));
			} catch (error) {
				void vscode.window.showErrorMessage(safeError(error, vscode.l10n.t('Could not create the note.')));
			}
		}
	});
	picker.onDidHide(() => {
		indexSubscription.dispose();
		untrack();
		picker.dispose();
	});
	update();
	picker.show();
}

async function showVaultSearch(
	index: VaultIndex,
	context: vscode.ExtensionContext,
	initialValue: string,
	isCurrent: () => boolean,
	trackPicker: <T extends vscode.QuickPickItem>(picker: vscode.QuickPick<T>) => () => void,
): Promise<void> {
	const picker = vscode.window.createQuickPick<VaultQuickPickItem>();
	const untrack = trackPicker(picker);
	picker.title = vscode.l10n.t('Search Document Vault');
	picker.placeholder = vscode.l10n.t('Search note names, aliases, headings, tags, and indexed terms');
	picker.matchOnDescription = true;
	picker.matchOnDetail = true;
	picker.value = initialValue;
	let generation = 0;
	let closed = false;
	let activeSearch: AbortController | undefined;
	// Keep at most one search generation active. Aborting prevents the old
	// generation from scheduling further file reads; serializing generations
	// also prevents slow local reads from accumulating eight more workers on
	// every keystroke in a large vault.
	let searchQueue: Promise<void> = Promise.resolve();
	const update = async () => {
		const current = ++generation;
		activeSearch?.abort();
		const controller = new AbortController();
		activeSearch = controller;
		picker.busy = true;
		const query = picker.value;
		let results: VaultSearchResult[] = [];
		const queued = searchQueue.then(async () => {
			results = await searchVaultWithContext(index, query, 50, controller.signal);
		});
		searchQueue = queued.catch(() => undefined);
		try {
			try {
				await queued;
			} catch {
				// A note may disappear or become unreadable while a query is in
				// flight. Keep the picker usable and avoid surfacing provider paths.
				results = [];
			}
			if (closed || !isCurrent() || controller.signal.aborted || current !== generation) return;
			picker.items = results.map(searchResultItem);
		} finally {
			if (!closed && current === generation) picker.busy = false;
		}
	};
	picker.onDidChangeValue(() => void update());
	picker.onDidAccept(async () => {
		if (!isCurrent()) return picker.hide();
		const selected = picker.selectedItems[0];
		const record = selected?.record;
		if (!record) return;
		picker.hide();
		await openIndexedRecord(index, record, context, selected.matchLine, isCurrent);
	});
	picker.onDidHide(() => {
		closed = true;
		activeSearch?.abort();
		untrack();
		picker.dispose();
	});
	void update();
	picker.show();
}

function searchResultItem(result: VaultSearchResult): VaultQuickPickItem {
	const context = [result.heading, result.context].filter(Boolean).join(' › ');
	return {
		label: `$(markdown) ${result.record.basename}`,
		description: result.line ? `${result.record.path}:${result.line}` : result.record.path,
		detail: context || undefined,
		// The extension query engine has already evaluated structured filters such
		// as tag:, task:, and property:. VS Code's secondary fuzzy filter cannot
		// infer those matches from the rendered label and would otherwise hide
		// valid results whose metadata is not repeated in the picker row.
		alwaysShow: true,
		record: result.record,
		matchLine: result.line,
	};
}

function recordItem(record: VaultIndexRecord, alwaysShow = false): VaultQuickPickItem {
	return {
		label: `$(markdown) ${record.basename}`,
		description: record.path,
		detail: [
			record.aliases.length ? vscode.l10n.t('Aliases: {0}', record.aliases.join(', ')) : '',
			record.tags.length ? vscode.l10n.t('Tags: {0}', record.tags.map((tag) => `#${tag}`).join(' ')) : '',
		].filter(Boolean).join(' · '),
		record,
		alwaysShow,
	};
}

async function openIndexedRecord(
	index: VaultIndex,
	record: VaultIndexRecord,
	context: vscode.ExtensionContext,
	line?: number,
	isCurrent: () => boolean = () => true,
): Promise<void> {
	if (!isCurrent()) return;
	const uri = index.vault.uriForRelative(record.path);
	try {
		await index.vault.assertRegularFileInside(uri);
		if (!isCurrent()) return;
		await vscode.commands.executeCommand('vscode.open', uri);
		if (!isCurrent()) return;
		await rememberRecent(index, record.path, context);
		if (line !== undefined && isCurrent()) await vscode.commands.executeCommand('revealLine', { lineNumber: line - 1, at: 'center' });
	} catch {
		if (isCurrent()) void vscode.window.showWarningMessage(vscode.l10n.t('The indexed note could not be opened securely.'));
	}
}

function recentKey(index: VaultIndex): string {
	return vaultStateKey(index.id, 'recent');
}

function loadBacklinkPreferences(
	provider: VaultBacklinksProvider,
	index: VaultIndex | undefined,
	context: vscode.ExtensionContext,
): void {
	const filter = index
		? context.workspaceState.get<unknown>(vaultStateKey(index.id, 'backlinks.filter'))
		: undefined;
	const sort = index
		? context.workspaceState.get<unknown>(vaultStateKey(index.id, 'backlinks.sort'))
		: undefined;
	provider.setFilter(isBacklinkFilter(filter) ? filter : 'all');
	provider.setSort(isBacklinkSort(sort) ? sort : 'linkedFirst');
}

function recentRecords(index: VaultIndex, context: vscode.ExtensionContext): VaultIndexRecord[] {
	const recent = validatedRecentPaths(context.workspaceState.get<unknown>(recentKey(index)));
	const records = recent.map((path) => index.get(path)).filter((record): record is VaultIndexRecord => Boolean(record));
	const seen = new Set(records.map((record) => record.path));
	for (const record of index.all().sort((a, b) => b.mtime - a.mtime)) {
		if (!seen.has(record.path)) records.push(record);
	}
	return records.slice(0, 100);
}

async function rememberRecent(index: VaultIndex, path: string, context: vscode.ExtensionContext): Promise<void> {
	const recent = validatedRecentPaths(context.workspaceState.get<unknown>(recentKey(index)));
	await context.workspaceState.update(recentKey(index), [path, ...recent.filter((item) => item !== path)].slice(0, 100));
}

async function pruneRecent(index: VaultIndex, context: vscode.ExtensionContext): Promise<void> {
	const key = recentKey(index);
	const stored = context.workspaceState.get<unknown>(key);
	const recent = validatedRecentPaths(stored);
	const filtered = recent.filter((path) => Boolean(index.get(path)));
	if (stored !== undefined && (!Array.isArray(stored) || filtered.length !== stored.length || filtered.some((path, position) => path !== stored[position]))) {
		await context.workspaceState.update(key, filtered);
	}
}

async function recordActiveNote(index: VaultIndex | undefined, context: vscode.ExtensionContext): Promise<void> {
	if (!index) return;
	const uri = activeFileUri();
	const path = uri && index.vault.relativePath(uri);
	if (path && index.get(path) && /\.(?:md|markdown)$/i.test(path)) await rememberRecent(index, path, context);
}

const VAULT_TREE_MIME = 'application/vnd.code.tree.mdlivepreview.vault';

interface VaultFolderQuickPickItem extends vscode.QuickPickItem {
	uri: vscode.Uri;
}

async function pickMoveDestination(
	provider: VaultTreeProvider,
	sources: readonly VaultEntry[],
): Promise<vscode.Uri | undefined> {
	const service = provider.service;
	if (!service) return undefined;
	const sourceFolders = sources
		.filter((source) => source.fileType & vscode.FileType.Directory)
		.map((source) => service.relativePath(source.uri))
		.filter((path): path is string => path !== undefined);
	const isForbidden = (path: string) => sourceFolders.some((source) => path === source || path.startsWith(`${source}/`));
	const items: VaultFolderQuickPickItem[] = [{
		label: '$(root-folder) /',
		description: vscode.l10n.t('Vault root'),
		uri: service.rootUri,
	}];
	const queue = (await provider.getChildren()).filter((node): node is VaultEntry => node instanceof VaultEntry);
	if (provider.service !== service) return undefined;
	let visited = 0;
	while (queue.length) {
		if (provider.service !== service) return undefined;
		const entry = queue.shift()!;
		if (++visited > 10_000) throw new Error('The vault contains too many items to build a destination list.');
		if (!(entry.fileType & vscode.FileType.Directory) || entry.fileType & vscode.FileType.SymbolicLink) continue;
		const path = service.relativePath(entry.uri);
		if (path === undefined || isForbidden(path)) continue;
		items.push({ label: `$(folder) ${path.split('/').pop()}`, description: path, uri: entry.uri });
		const children = await provider.getChildren(entry);
		if (provider.service !== service) return undefined;
		queue.push(...children.filter((node): node is VaultEntry => node instanceof VaultEntry));
		if (visited % 100 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
	if (provider.service !== service) return undefined;
	const cancellation = new vscode.CancellationTokenSource();
	const workspaceListener = vscode.workspace.onDidChangeWorkspaceFolders(() => cancellation.cancel());
	try {
		const selected = await vscode.window.showQuickPick(items, {
			title: vscode.l10n.t('Move Vault Items'),
			placeHolder: vscode.l10n.t('Select a destination folder'),
			matchOnDescription: true,
		}, cancellation.token);
		return provider.service === service ? selected?.uri : undefined;
	} finally {
		workspaceListener.dispose();
		cancellation.dispose();
	}
}

async function moveVaultEntries(
	provider: VaultTreeProvider,
	sources: readonly VaultEntry[],
	parent: vscode.Uri,
): Promise<number> {
	const service = provider.service;
	if (!service) return 0;
	const unique = [...new Map(sources.map((source) => [source.uri.toString(), source])).values()];
	if (unique.length > 256) throw new Error('At most 256 vault items can be moved at once.');
	const moving = unique.filter((source) => source.parentUri.toString() !== parent.toString());
	if (moving.length === 0) return 0;
	const parentPath = service.relativePath(parent);
	if (parentPath === undefined || moving.some((source) => {
		const sourcePath = service.relativePath(source.uri);
		return sourcePath === undefined || (Boolean(source.fileType & vscode.FileType.Directory)
			&& (parentPath === sourcePath || parentPath.startsWith(`${sourcePath}/`)));
	})) throw new Error('A folder cannot be moved into itself.');
	await Promise.all(moving.map((source) => service.assertMutationSource(
		source.uri,
		Boolean(source.fileType & vscode.FileType.SymbolicLink),
	)));
	const requests = await Promise.all(moving.map(async (source) => ({
		source: source.uri,
		destination: await service.moveDestination(source.uri, parent, basenameLabel(source.uri)),
		isFolder: Boolean(source.fileType & vscode.FileType.Directory),
	})));
	const applied = await new LinkRewriteService(service, {
		isCurrent: () => provider.service === service && vscode.workspace.isTrusted,
	}).renameOrMoveMany(requests);
	if (!applied) throw new Error('The workspace rejected the move.');
	if (provider.service !== service || !vscode.workspace.isTrusted) return 0;
	provider.refresh();
	return moving.length;
}

class VaultDragAndDropController implements vscode.TreeDragAndDropController<VaultEntry>, vscode.Disposable {
	readonly dragMimeTypes = [VAULT_TREE_MIME];
	readonly dropMimeTypes = [VAULT_TREE_MIME];

	constructor(private readonly provider: VaultTreeProvider) {}

	handleDrag(source: readonly VaultEntry[], dataTransfer: vscode.DataTransfer): void {
		dataTransfer.set(VAULT_TREE_MIME, new vscode.DataTransferItem(source));
	}

	async handleDrop(target: VaultEntry | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
		if (!vscode.workspace.isTrusted) {
			void vscode.window.showWarningMessage(vscode.l10n.t('Trust this workspace to move Document Vault files.'));
			return;
		}
		const resolvedTarget = target === undefined ? undefined : await resolveCommandEntry(this.provider, target);
		if (target !== undefined && !resolvedTarget) return;
		const transferred = await resolveCommandEntries(
			this.provider,
			undefined,
			dataTransfer.get(VAULT_TREE_MIME)?.value,
			[],
		);
		if (transferred.length === 0) return;
		const service = this.provider.service;
		if (!service) return;
		const parent = resolvedTarget && resolvedTarget.fileType & vscode.FileType.Directory
			? resolvedTarget.uri
			: resolvedTarget?.parentUri ?? service.rootUri;
		try {
			const moved = await moveVaultEntries(this.provider, transferred, parent);
			if (moved > 0) announceVaultCompletion(vscode.l10n.t('{0} vault item(s) moved.', moved));
		} catch (error) {
			void vscode.window.showErrorMessage(safeError(error, vscode.l10n.t('Could not move the vault item.')));
		}
	}

	dispose(): void {}
}

async function resolveCommandEntries(
	provider: VaultTreeProvider,
	entry: unknown,
	selected: unknown,
	fallback: readonly VaultEntry[],
): Promise<readonly VaultEntry[]> {
	if (selected !== undefined && !Array.isArray(selected)) return [];
	const values = Array.isArray(selected) && selected.length > 0
		? selected
		: entry !== undefined ? [entry] : fallback;
	if (values.length > 256) return [];
	const resolved = await Promise.all(values.map((value) => resolveCommandEntry(provider, value)));
	if (resolved.some((value) => value === undefined)) return [];
	return resolved as VaultEntry[];
}

async function resolveCommandEntry(provider: VaultTreeProvider, value: unknown): Promise<VaultEntry | undefined> {
	const uri = value instanceof VaultEntry
		? value.uri
		: typeof value === 'object' && value !== null && 'uri' in value && value.uri instanceof vscode.Uri
			? value.uri
			: undefined;
	const service = provider.service;
	if (!uri || !service) return undefined;
	try {
		const path = service.relativePath(uri);
		if (!path) return undefined;
		const stat = await service.statEntryInside(uri);
		if (provider.service !== service) return undefined;
		const fileType = stat.isSymbolicLink()
			? vscode.FileType.SymbolicLink
			: stat.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File;
		return new VaultEntry(uri, fileType, vscode.Uri.file(dirname(uri.fsPath)), path);
	} catch {
		return undefined;
	}
}

/**
 * Native information notifications are exposed through VS Code's accessible
 * notification surface. A transient status-bar message alone is easy to miss
 * and is not a reliable live announcement for screen-reader users.
 */
function announceVaultCompletion(message: string): void {
	void vscode.window.showInformationMessage(message);
}

function activeFileUri(): vscode.Uri | undefined {
	if (vscode.window.activeTextEditor) return vscode.window.activeTextEditor.document.uri;
	const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
	if (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) return input.uri;
	return undefined;
}

function basenameLabel(uri: vscode.Uri): string {
	return uri.path.split('/').pop() ?? uri.path;
}

function safeError(error: unknown, fallback: string): string {
	if (error instanceof VaultTransactionConflictError) {
		switch (error.conflictKind) {
		case 'source': return vscode.l10n.t('Source "{0}" changed while the move was being prepared. Try again.', error.affectedPath);
		case 'linkedDocument': return vscode.l10n.t('Linked document "{0}" changed while the move was being prepared. Try again.', error.affectedPath);
		case 'destination': return vscode.l10n.t('Destination "{0}" changed while the move was being prepared. Try again.', error.affectedPath);
		case 'sourceOrDestination': return vscode.l10n.t(
			'Source "{0}" or destination "{1}" changed while the move was being prepared. Try again.',
			error.affectedPath,
			error.secondaryAffectedPath ?? vscode.l10n.t('unknown vault item'),
		);
	}
	}
	const message = error instanceof Error ? error.message : '';
	return localizeVaultError(message) ?? fallback;
}

function showIndexWarning(error: unknown): void {
	const message = error instanceof Error ? error.message : '';
	const localized = message === 'The vault exceeds the 10,000-note indexing limit.'
		? vscode.l10n.t('Document Vault knowledge features are disabled because more than 10,000 non-excluded Markdown notes were found. Reduce the note count or exclusions, then run Rebuild Vault Index.')
		: message === 'The vault exceeds the 128 MiB metadata indexing limit.'
			? vscode.l10n.t('Document Vault knowledge features are disabled because the bounded metadata index exceeded 128 MiB. Exclude unusually large notes, then run Rebuild Vault Index.')
		: message === 'The vault exceeds the 100,000-file Markdown discovery limit.'
			? vscode.l10n.t('Document Vault knowledge features are disabled because more than 100,000 Markdown files were discovered, including excluded files. Reduce the file count, then run Rebuild Vault Index.')
			: vscode.l10n.t('Document Vault indexing failed. Plain Markdown editing remains available.');
	void vscode.window.showWarningMessage(localized);
}

function localizeVaultValidation(message: string | undefined): string | undefined {
	return message ? localizeVaultError(message) ?? vscode.l10n.t('Enter a valid vault item name.') : undefined;
}

/**
 * Only known, content-free errors cross into the UI. Besides keeping paths and
 * arbitrary provider errors private, the explicit cases ensure every visible
 * reason participates in VS Code localization instead of leaking raw English.
 */
function localizeVaultError(message: string): string | undefined {
	switch (message) {
		case 'Enter a name without leading or trailing whitespace.': return vscode.l10n.t('Enter a name without leading or trailing whitespace.');
		case 'The name must not contain path separators.': return vscode.l10n.t('The name must not contain path separators.');
		case 'The name contains a control character.': return vscode.l10n.t('The name contains a control character.');
		case 'The name contains a character that is not portable across supported systems.': return vscode.l10n.t('The name contains a character that is not portable across supported systems.');
		case 'The name must not end with a period or space.': return vscode.l10n.t('The name must not end with a period or space.');
		case 'That name is reserved by Windows.': return vscode.l10n.t('That name is reserved by Windows.');
		case 'The name is longer than 255 bytes.': return vscode.l10n.t('The name is longer than 255 bytes.');
		case 'The destination resolves outside the Document Vault.': return vscode.l10n.t('The destination resolves outside the Document Vault.');
		case 'The destination is outside the Document Vault.': return vscode.l10n.t('The destination is outside the Document Vault.');
		case 'The note path must be relative to the Document Vault.': return vscode.l10n.t('The note path must be relative to the Document Vault.');
		case 'The note path is too deeply nested.': return vscode.l10n.t('The note path is too deeply nested.');
		case 'The item is outside the Document Vault.': return vscode.l10n.t('The item is outside the Document Vault.');
		case 'The item resolves outside the Document Vault.': return vscode.l10n.t('The item resolves outside the Document Vault.');
		case 'The source or destination is outside the Document Vault.': return vscode.l10n.t('The source or destination is outside the Document Vault.');
		case 'The item already has that name.': return vscode.l10n.t('The item already has that name.');
		case 'At most 256 vault items can be moved at once.': return vscode.l10n.t('At most 256 vault items can be moved at once.');
		case 'Every move must remain inside the Document Vault.': return vscode.l10n.t('Every move must remain inside the Document Vault.');
		case 'An item already exists at a destination.': return vscode.l10n.t('An item already exists at a destination.');
		case 'A source changed while the move was being prepared.': return vscode.l10n.t('A source changed while the move was being prepared. Try again.');
		case 'A linked document changed while the move was being prepared.': return vscode.l10n.t('A linked document changed while the move was being prepared. Try again.');
		case 'A destination changed while the move was being prepared.': return vscode.l10n.t('A destination changed while the move was being prepared. Try again.');
		case 'A source or destination changed while the move was being prepared.': return vscode.l10n.t('A source or destination changed while the move was being prepared. Try again.');
		case 'Automatic link updates are limited to 10,000 non-excluded Markdown files.': return vscode.l10n.t('Automatic link updates are limited to 10,000 non-excluded Markdown files.');
		case 'Automatic link updates are disabled when more than 100,000 Markdown files are discovered.': return vscode.l10n.t('Automatic link updates are disabled when more than 100,000 Markdown files are discovered.');
		case 'A Markdown file is too large for a safe automatic link update.': return vscode.l10n.t('A Markdown file is too large for a safe automatic link update.');
		case 'The vault is too large for a safe automatic link update.': return vscode.l10n.t('The vault is too large for a safe automatic link update.');
		case 'The same vault item was selected more than once.': return vscode.l10n.t('The same vault item was selected more than once.');
		case 'Multiple items would have the same destination.': return vscode.l10n.t('Multiple items would have the same destination.');
		case 'A selection cannot contain both a folder and one of its descendants.': return vscode.l10n.t('A selection cannot contain both a folder and one of its descendants.');
		case 'Move chains and moves into selected folders are not supported.': return vscode.l10n.t('Move chains and moves into selected folders are not supported.');
		case 'A folder cannot be moved into itself.': return vscode.l10n.t('A folder cannot be moved into itself.');
		case 'The workspace rejected the rename.': return vscode.l10n.t('The workspace rejected the rename.');
		case 'The workspace rejected the move.': return vscode.l10n.t('The workspace rejected the move.');
		case 'The vault contains too many items to build a destination list.': return vscode.l10n.t('The vault contains too many items to build a destination list.');
		default: return undefined;
	}
}
