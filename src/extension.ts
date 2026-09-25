import * as vscode from 'vscode';
import { MarkdownLivePreviewProvider } from './editor/MarkdownLivePreviewProvider';
import { StyleManagerViewProvider } from './sidebar/StyleManagerViewProvider';
import { StyleStore } from './sidebar/styleStore';
import { OutlineViewProvider } from './sidebar/OutlineViewProvider';
import { getCodeTokenizationRunCount, setGrammarRoot } from './editor/shikiHost';
import { registerVault, VaultDragAndDropController } from './vault/registerVault';
import { VaultEntry, VaultTreeProvider } from './vault/VaultTreeProvider';
import { LinkRewriteService } from './vault/LinkRewriteService';
import type { VaultIndexRecord } from './vault/VaultIndex';
import { searchVaultWithContext, type VaultSearchResult } from './vault/VaultSearchService';
import { diagnosticEvent, initializeDiagnostics } from './diagnostics';
import { caseRenameCoordinatorFor, disposeCaseRenameCoordinators, executeCaseAwareRedo } from './vault/CaseRenameCoordinator';
import { createVaultNoteSummary, isCanonicalVaultNoteIdentity } from './shared/vaultNoteSummary';
import { openDefaultVaultWhenNeeded } from './vault/defaultVault';
import { DEFAULT_EDITOR_SETTING, editorViewType, normalizeDefaultEditorSetting } from './shared/editorOpenPolicy';
import { registerNativeMarkdownCompatibility } from './editor/nativeMarkdownCompatibility';
import { createMarkdownPreviewSupport, type MarkdownPreviewApi } from './editor/markdownPreviewSupport';

interface DevelopmentApi extends MarkdownPreviewApi {
	getDragDropTestTypes(): { VaultEntry: typeof VaultEntry; VaultTreeProvider: typeof VaultTreeProvider; VaultDragAndDropController: typeof VaultDragAndDropController };
	getVaultService(): ReturnType<Awaited<ReturnType<typeof registerVault>>['getService']>;
	getVaultRecentPaths(): readonly string[];
	getVaultIndexRecords(): readonly VaultIndexRecord[];
	getVaultStorageIdentity(): { id: string; canonicalRootUri: string; legacyIds: readonly string[] } | undefined;
	getVaultCacheUri(): vscode.Uri | undefined;
	flushVaultIndexCache(): Promise<void>;
	cancelVaultIndexRebuild(): Promise<void>;
	getCodeTokenizationRunCount(): number;
	getVaultTreeRevision(): number;
	getVaultTreeTitle(): string;
	getVaultTreePaths(parentPath?: string): Promise<readonly string[]>;
	searchVault(query: string, limit?: number): Promise<readonly VaultSearchResult[]>;
	renameOrMoveMany(requests: Parameters<LinkRewriteService['renameOrMoveMany']>[0]): Promise<boolean>;
	renameOrMoveManyWithRejectedCommit(requests: Parameters<LinkRewriteService['renameOrMoveMany']>[0]): Promise<boolean>;
	renameOrMoveManyWithStaleGeneration(requests: Parameters<LinkRewriteService['renameOrMoveMany']>[0]): Promise<boolean>;
	renameOrMoveManyBeforeCheck(
		requests: Parameters<LinkRewriteService['renameOrMoveMany']>[0],
		beforePreconditionCheck: () => Thenable<void>,
	): Promise<boolean>;
	renameOrMoveManyBeforeCaseStage(
		requests: Parameters<LinkRewriteService['renameOrMoveMany']>[0],
		beforeCaseRenameStage: () => Thenable<void>,
	): Promise<boolean>;
	renameOrMoveManyWithStaleCaseStage(requests: Parameters<LinkRewriteService['renameOrMoveMany']>[0]): Promise<boolean>;
	settleCaseRenameTransactions(): Promise<void>;
}

function getActiveMarkdownUri(): vscode.Uri | undefined {
	if (vscode.window.activeTextEditor?.document.languageId === 'markdown') {
		return vscode.window.activeTextEditor.document.uri;
	}
	const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
	if (input instanceof vscode.TabInputText) {
		return input.uri;
	}
	return undefined;
}

function getActiveCustomEditorUri(): vscode.Uri | undefined {
	const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
	if (input instanceof vscode.TabInputCustom) {
		return input.uri;
	}
	return undefined;
}

async function syncDefaultEditorAssociation(): Promise<void> {
	const config = vscode.workspace.getConfiguration('mdLivePreview');
	const configured = config.get<string>('defaultEditor', DEFAULT_EDITOR_SETTING);
	const mode = normalizeDefaultEditorSetting(configured);
	// Earlier builds stored `default` while labeling it Markdown Editor. Preserve
	// that user choice and replace the obsolete value with its correct name.
	if (configured === 'default') {
		await config.update('defaultEditor', 'markdownEditor', vscode.ConfigurationTarget.Global);
	}
	const rootConfig = vscode.workspace.getConfiguration();
	const associations = {
		// Do not promote unrelated workspace associations into user settings.
		...(rootConfig.inspect<Record<string, string>>('workbench.editorAssociations')?.globalValue ?? {}),
	};

	const viewType = editorViewType(mode);
	if (viewType) {
		associations['*.md'] = viewType;
		associations['*.markdown'] = viewType;
	} else {
		delete associations['*.md'];
		delete associations['*.markdown'];
	}

	await rootConfig.update('workbench.editorAssociations', associations, vscode.ConfigurationTarget.Global);
}

let flushPendingSaves: (() => Promise<void>) | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<MarkdownPreviewApi | DevelopmentApi | undefined> {
	// Never replace a workspace the user chose. In an empty window, create the
	// local default vault and stop because vscode.openFolder reloads this host.
	if (await openDefaultVaultWhenNeeded()) return undefined;
	context.subscriptions.push({ dispose: disposeCaseRenameCoordinators });
	initializeDiagnostics(context);
	const markdownPreviewSupport = createMarkdownPreviewSupport();
	context.subscriptions.push(markdownPreviewSupport);
	const markdownPreviewApi: MarkdownPreviewApi = { extendMarkdownIt: markdownPreviewSupport.extendMarkdownIt };
	diagnosticEvent('extension.activate', { mode: vscode.ExtensionMode[context.extensionMode] ?? context.extensionMode });
	// Syntax grammars are read from disk on first use rather than bundled (see
	// shikiHost.ts); this is the only place that knows where the extension was
	// installed to.
	setGrammarRoot(context.extensionPath);
	let livePreviewProvider: MarkdownLivePreviewProvider | undefined;
	const vaultRegistration = await registerVault(context, {
		revealOpenedLine: (uri, line) => livePreviewProvider?.jumpToDocument(uri, line) ?? false,
	});

	const styleStore = new StyleStore(context);
	await styleStore.initialize();

	const { disposable: providerDisposable, provider } = MarkdownLivePreviewProvider.register(
		context,
		() => styleStore.getCombinedCssSync(),
		() => vaultRegistration.getIndex()?.all()
			.filter((record) => isCanonicalVaultNoteIdentity(record.path, record.basename))
			.map(createVaultNoteSummary) ?? [],
	);
	livePreviewProvider = provider;
	flushPendingSaves = () => provider.flushPendingSaves();
	context.subscriptions.push(providerDisposable);
	context.subscriptions.push(registerNativeMarkdownCompatibility());
	context.subscriptions.push(styleStore.onDidChange(() => provider.broadcastCssChanged()));
	context.subscriptions.push(vaultRegistration.onDidChangeIndex(() => provider.broadcastVaultNotesChanged()));

	const styleManagerProvider = new StyleManagerViewProvider(context, styleStore);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(StyleManagerViewProvider.viewType, styleManagerProvider),
	);

	const outlineProvider = new OutlineViewProvider(context, provider);
	context.subscriptions.push(vscode.window.registerWebviewViewProvider(OutlineViewProvider.viewType, outlineProvider));

	context.subscriptions.push(
		vscode.commands.registerCommand('mdLivePreview.caseAwareRedo', () => executeCaseAwareRedo(
			() => vscode.commands.executeCommand('redo'),
		)),
		vscode.commands.registerCommand('mdLivePreview.openWithLivePreview', async () => {
			const uri = getActiveMarkdownUri();
			if (!uri) return;
			const viewColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
			await vscode.commands.executeCommand('vscode.openWith', uri, MarkdownLivePreviewProvider.viewType, viewColumn);
		}),
		vscode.commands.registerCommand('mdLivePreview.openWithSource', async () => {
			const uri = getActiveCustomEditorUri();
			if (!uri) return;
			const viewColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
			await vscode.commands.executeCommand('vscode.openWith', uri, 'default', viewColumn);
		}),
		vscode.commands.registerCommand('mdLivePreview.newStyle', async () => {
			return styleManagerProvider.createNewStyle();
		}),
	);

	// Defaults belong in editor associations and our explicit vault-open policy.
	// Tab events do not reveal whether an open was a deliberate mode switch.
	// Reopening text tabs here races VS Code's Text Editor picker and overrides
	// explicit source opens (including intentional source splits).

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('mdLivePreview.defaultEditor')) {
				void syncDefaultEditorAssociation();
			}
			if (
				e.affectsConfiguration('mdLivePreview.remoteMedia') ||
				e.affectsConfiguration('mdLivePreview.diagramRendering')
			) {
				provider.reloadSecurityPolicy();
			}
		}),
		vscode.workspace.onDidGrantWorkspaceTrust(() => {
			provider.reloadSecurityPolicy();
			styleManagerProvider.refreshSecurityPolicy();
		}),
	);
	await syncDefaultEditorAssociation();
	// Filesystem transaction tests need the live service from the real extension
	// host. Keep this seam out of installed builds; production consumers receive
	// only VS Code's Markdown renderer hook, never services or test operations.
	if (context.extensionMode !== vscode.ExtensionMode.Production) {
		return {
			...markdownPreviewApi,
			getDragDropTestTypes: () => ({ VaultEntry, VaultTreeProvider, VaultDragAndDropController }),
			getVaultService: () => vaultRegistration.getService(),
			getVaultRecentPaths: () => vaultRegistration.getRecentPaths(),
			getVaultIndexRecords: () => vaultRegistration.getIndex()?.all() ?? [],
			getVaultStorageIdentity: () => {
				const index = vaultRegistration.getIndex();
				return index ? {
					id: index.id,
					canonicalRootUri: index.vault.canonicalRootUri.toString(),
					legacyIds: index.legacyIds,
				} : undefined;
			},
			getVaultCacheUri: () => vaultRegistration.getIndex()?.cacheUri,
			flushVaultIndexCache: async () => {
				const index = vaultRegistration.getIndex();
				if (!index) throw new Error('Document Vault is unavailable.');
				await index.flushCache();
			},
			cancelVaultIndexRebuild: async () => {
				const index = vaultRegistration.getIndex();
				if (!index) throw new Error('Document Vault is unavailable.');
				const cancellation = new vscode.CancellationTokenSource();
				cancellation.cancel();
				try { await index.reset(cancellation.token); }
				catch (error) {
					if (!(error instanceof vscode.CancellationError)) throw error;
				} finally {
					cancellation.dispose();
				}
			},
			getCodeTokenizationRunCount,
			getVaultTreeRevision: () => vaultRegistration.getTreeRevision(),
			getVaultTreeTitle: () => vaultRegistration.getTreeTitle(),
			getVaultTreePaths: (parentPath) => vaultRegistration.getTreePaths(parentPath),
			searchVault: async (query, limit) => {
				const index = vaultRegistration.getIndex();
				return index ? searchVaultWithContext(index, query, limit) : [];
			},
				renameOrMoveMany: async (requests) => {
					const service = vaultRegistration.getService();
					if (!service) throw new Error('Document Vault is unavailable.');
					return new LinkRewriteService(service).renameOrMoveMany(requests);
				},
				renameOrMoveManyWithRejectedCommit: async (requests) => {
					const service = vaultRegistration.getService();
					if (!service) throw new Error('Document Vault is unavailable.');
					return new LinkRewriteService(service, { applyEdit: async () => false }).renameOrMoveMany(requests);
				},
				renameOrMoveManyWithStaleGeneration: async (requests) => {
					const service = vaultRegistration.getService();
					if (!service) throw new Error('Document Vault is unavailable.');
					let current = true;
					return new LinkRewriteService(service, {
						isCurrent: () => current,
						beforePreconditionCheck: async () => { current = false; },
					}).renameOrMoveMany(requests);
				},
				renameOrMoveManyBeforeCheck: async (requests, beforePreconditionCheck) => {
					const service = vaultRegistration.getService();
					if (!service) throw new Error('Document Vault is unavailable.');
					return new LinkRewriteService(service, { beforePreconditionCheck }).renameOrMoveMany(requests);
				},
				renameOrMoveManyBeforeCaseStage: async (requests, beforeCaseRenameStage) => {
					const service = vaultRegistration.getService();
					if (!service) throw new Error('Document Vault is unavailable.');
					return new LinkRewriteService(service, { beforeCaseRenameStage }).renameOrMoveMany(requests);
				},
				renameOrMoveManyWithStaleCaseStage: async (requests) => {
					const service = vaultRegistration.getService();
					if (!service) throw new Error('Document Vault is unavailable.');
					let current = true;
					return new LinkRewriteService(service, {
						isCurrent: () => current,
						beforeCaseRenameStage: async () => { current = false; },
					}).renameOrMoveMany(requests);
				},
				settleCaseRenameTransactions: async () => {
					const service = vaultRegistration.getService();
					if (!service) throw new Error('Document Vault is unavailable.');
					await caseRenameCoordinatorFor(service).settle();
				},
			};
	}
	return markdownPreviewApi;
}

export async function deactivate(): Promise<void> {
	// Cooperate with orderly reload/quit before VS Code disposes subscriptions.
	// Forced termination/power loss can still interrupt IPC or storage writes.
	await flushPendingSaves?.();
	flushPendingSaves = undefined;
}
