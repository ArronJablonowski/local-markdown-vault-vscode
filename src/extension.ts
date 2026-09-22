import * as vscode from 'vscode';
import { MarkdownLivePreviewProvider } from './editor/MarkdownLivePreviewProvider';
import { StyleManagerViewProvider } from './sidebar/StyleManagerViewProvider';
import { StyleStore } from './sidebar/styleStore';
import { OutlineViewProvider } from './sidebar/OutlineViewProvider';
import { getCodeTokenizationRunCount, setGrammarRoot } from './editor/shikiHost';
import { registerVault } from './vault/registerVault';
import { LinkRewriteService } from './vault/LinkRewriteService';
import type { VaultIndexRecord } from './vault/VaultIndex';
import { searchVaultWithContext, type VaultSearchResult } from './vault/VaultSearchService';
import { diagnosticEvent, initializeDiagnostics } from './diagnostics';
import { caseRenameCoordinatorFor, disposeCaseRenameCoordinators, executeCaseAwareRedo } from './vault/CaseRenameCoordinator';
import { createVaultNoteSummary, isCanonicalVaultNoteIdentity } from './shared/vaultNoteSummary';
import { openDefaultVaultWhenNeeded } from './vault/defaultVault';
import { DEFAULT_EDITOR_SETTING, editorViewType, normalizeDefaultEditorSetting } from './shared/editorOpenPolicy';

interface DevelopmentApi {
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

// Files the user explicitly asked to view as plain source through Open Source,
// exempted from the auto-reopen-as-Live-Preview watcher below until closed or
// reopened in Live Preview again. Keyed by `Uri#toString()`.
const sourceOverrideUris = new Set<string>();

// URIs currently being converted to their configured Markdown editor.
// `onDidChangeTabs` can report the same tab open in both its `opened` and
// `changed` batches, which without this guard would race two overlapping
// `vscode.openWith` calls for the same file and could leave two tabs open.
const reopeningUris = new Set<string>();

/**
 * Whether VS Code considers this tab's document to be Markdown. Prefers the
 * document's actual language mode over the filename: a file recognized as
 * Markdown (via the user's own `files.associations`, for instance) is still
 * picked up even when its name doesn't literally end in ".md" — e.g. a
 * duplicate download renamed by some tool to "note.md(1)". Falls back to the
 * filename check only when no matching open document is found yet (the tab
 * may not have one tracked at the very first `opened` event).
 */
function isMarkdownTab(input: vscode.TabInputText): boolean {
	const uriKey = input.uri.toString();
	const openDoc = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uriKey);
	if (openDoc) return openDoc.languageId === 'markdown';
	return /\.(?:md|markdown)$/i.test(input.uri.path);
}

// Short, bounded backoff for configured-editor retries below — covers
// two distinct failure modes seen from third-party callers (AI chat panels,
// other extensions' "open this file" links) that this extension can't inspect
// or fix directly: (1) the document's language mode hasn't been assigned yet
// at the moment its tab first appears, so `isMarkdownTab` misses a file that
// *is* genuinely Markdown; (2) `vscode.openWith` itself intermittently rejects
// right after such a caller's own open call, before VS Code has finished
// settling that tab. Both are transient by nature — a short retry recovers
// them without any visible flicker, where giving up immediately would leave
// the file stuck showing as plain/raw text with no further trigger to fix it.
const REOPEN_RETRY_DELAYS_MS = [150, 500, 1500];

/**
 * Some ways of opening a `.md` file (e.g. `vscode.window.showTextDocument`,
 * used by many extensions — including AI chat panels — to open a referenced
 * file) bypass `workbench.editorAssociations` entirely and always land in the
 * plain text editor. This watches every tab as it opens/changes and reopens
 * any such file in the explicitly configured Markdown view, reusing the same
 * tab/column so no split is created.
 */
async function maybeReopenAsConfiguredEditor(tab: vscode.Tab, attempt = 0): Promise<void> {
	// Delayed retries must not resurrect a closed tab or override a view the
	// user selected while VS Code was settling the original open operation.
	if (!tab.group.tabs.includes(tab)) return;
	const input = tab.input;
	if (!(input instanceof vscode.TabInputText)) return;
	const configured = vscode.workspace.getConfiguration('mdLivePreview', input.uri).get<string>('defaultEditor', DEFAULT_EDITOR_SETTING);
	const viewType = editorViewType(configured);
	if (!viewType || viewType === 'default') return;
	const uriKey = input.uri.toString();
	if (sourceOverrideUris.has(uriKey)) return;
	if (reopeningUris.has(uriKey)) return;

	const retry = () => {
		if (attempt >= REOPEN_RETRY_DELAYS_MS.length) return;
		setTimeout(() => void maybeReopenAsConfiguredEditor(tab, attempt + 1), REOPEN_RETRY_DELAYS_MS[attempt]);
	};

	if (!isMarkdownTab(input)) {
		retry();
		return;
	}

	reopeningUris.add(uriKey);
	try {
		await vscode.commands.executeCommand(
			'vscode.openWith',
			input.uri,
			viewType,
			{ viewColumn: tab.group.viewColumn, preview: tab.isPreview, preserveFocus: !tab.isActive },
		);
		// VS Code owns replacement of the originating tab. Never close matching
		// source tabs in other groups: they may be intentional split views.
	} catch {
		// `openWith` rejected (e.g. the tab hadn't fully settled yet) — the file
		// is still sitting there as plain text with nothing else queued to
		// retrigger this watcher, so retry ourselves rather than leaving it stuck.
		reopeningUris.delete(uriKey);
		retry();
		return;
	}
	reopeningUris.delete(uriKey);
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

export async function activate(context: vscode.ExtensionContext): Promise<DevelopmentApi | undefined> {
	// Never replace a workspace the user chose. In an empty window, create the
	// local default vault and stop because vscode.openFolder reloads this host.
	if (await openDefaultVaultWhenNeeded()) return undefined;
	context.subscriptions.push({ dispose: disposeCaseRenameCoordinators });
	initializeDiagnostics(context);
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
	context.subscriptions.push(providerDisposable);
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
			sourceOverrideUris.delete(uri.toString());
			const viewColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
			await vscode.commands.executeCommand('vscode.openWith', uri, MarkdownLivePreviewProvider.viewType, viewColumn);
		}),
		vscode.commands.registerCommand('mdLivePreview.openWithSource', async () => {
			const uri = getActiveCustomEditorUri();
			if (!uri) return;
			sourceOverrideUris.add(uri.toString());
			const viewColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
			await vscode.commands.executeCommand('vscode.openWith', uri, 'default', viewColumn);
		}),
		vscode.commands.registerCommand('mdLivePreview.newStyle', async () => {
			return styleManagerProvider.createNewStyle();
		}),
	);

	context.subscriptions.push(
		vscode.workspace.onDidCloseTextDocument((doc) => {
			sourceOverrideUris.delete(doc.uri.toString());
		}),
		vscode.window.tabGroups.onDidChangeTabs((e) => {
			// Only enforce the configured default for newly opened tabs. A `changed`
			// event is also how VS Code reports an explicit "Reopen Editor With…"
			// choice. Reprocessing those events immediately replaced a user-selected
			// Text Editor with the configured Markdown Editor.
			for (const tab of e.opened) {
				void maybeReopenAsConfiguredEditor(tab);
			}
		}),
	);

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
	// no public API and cannot use it to bypass command trust checks.
	if (context.extensionMode !== vscode.ExtensionMode.Production) {
		return {
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
	return undefined;
}

export function deactivate(): void {
	// All resources are registered on context.subscriptions and disposed by VS Code automatically.
}
