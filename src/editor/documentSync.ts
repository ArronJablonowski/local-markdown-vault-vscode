import * as vscode from 'vscode';
import { EDITOR_PROTOCOL_VERSION, type EditorToHostMessage, type HostToEditorMessage, type PastedImagePayload, type RemoteMediaPolicy, type TextChange, type VaultNoteSummary } from '../shared/messages';
import { resolveAttachmentFolder } from '../shared/attachmentPath';
import { pickCodeTheme, tokenizeDocument } from './shikiHost';
import { extensionForMimeType, generateImageFileName, hasRasterImageSignature, hasSafeRasterImageDimensions, rasterMimeTypeForPath } from '../shared/imageAssets';
import { resolveLinkTarget } from '../shared/linkTarget';
import { isPathInside } from '../shared/pathContainment';
import { MAX_EDITOR_DOCUMENT_BYTES, MAX_PASTED_IMAGE_BYTES, MAX_PASTED_IMAGE_COUNT, MAX_PASTED_IMAGE_OPERATION_BYTES, validateEditorToHostMessage, validateHostToEditorMessage } from '../shared/messageValidation';
import { isCanonicalPathInside } from './canonicalContainment';
import { relative } from 'node:path';
import { VaultService, type CreatedVaultFile } from '../vault/VaultService';
import { parseWikiLinkBody, resolveWikiLinkSummary, wikiHeadingSlug } from '../vault/LinkResolver';
import { extractWikiEmbedContent } from '../vault/embedContent';
import { chunkVaultNoteSummaries } from '../shared/vaultNoteSummary';
import { findMarkdownAnchorLine } from '../shared/markdownAnchor';
import { diagnosticEventRateLimited } from '../diagnostics';
import { resolveWorkspaceRemoteMediaPolicy } from '../shared/securitySettings';
import { localWorkspaceVaultRoot } from './workspaceVault';
import { RequestLimiter } from '../shared/requestLimiter';
import { applyNormalizedTextChanges, createLineEndingMap, normalizeInsertedLineEndings, normalizeLineEndingsForWebview } from '../shared/lineEndings';
import { isOpenOnlyAttachmentTarget } from '../shared/openOnlyAttachment';
import { isDrawioPath } from '../shared/drawioPath';
import { executeCaseAwareRedo } from '../vault/CaseRenameCoordinator';
import { BoundedSerialQueue } from '../shared/boundedSerialQueue';
import { PendingLineNavigation } from './pendingLineNavigation';
import { TokenBucketRateLimiter } from '../shared/tokenBucketRateLimiter';
import { openConfiguredVaultResource } from './configuredDocumentOpen';

/**
 * Largest `.drawio` file that will be read and parsed.
 *
 * A hand-drawn diagram is a few hundred kilobytes at most; well past that the
 * file is either machine-generated or not a diagram, and parsing it would lock
 * up the webview's single thread with nothing useful to show at the end.
 */
const MAX_DRAWIO_BYTES = 5 * 1024 * 1024;
const MAX_WIKI_EMBED_BYTES = 1024 * 1024;
const MAX_LOCAL_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Whether `target` sits inside the `dir` tree.
 *
 * Compared over `fsPath` rather than the URI string so that percent-encoding
 * differences (a space as `%20` on one side and a literal space on the other)
 * cannot make an inside path look outside. Case-insensitivity follows the
 * platform: only Windows treats `C:\Notes` and `c:\notes` as one folder.
 */
function isInside(dir: vscode.Uri, target: vscode.Uri): boolean {
	if (dir.scheme !== target.scheme || dir.authority !== target.authority) return false;
	return isPathInside(dir.fsPath, target.fsPath, process.platform === 'win32');
}

/**
 * Re-checks containment after the OS resolves symlinks. Lexical `..` checks are
 * necessary but insufficient: `vault/assets -> /tmp` looks inside the vault as
 * text while a write through it lands outside. Privileged file operations are
 * local-only and fail closed when either canonical path cannot be established.
 */
async function isCanonicallyInside(dir: vscode.Uri, target: vscode.Uri): Promise<boolean> {
	if (dir.scheme !== 'file' || target.scheme !== 'file') return false;
	return isCanonicalPathInside(dir.fsPath, target.fsPath);
}

const REHIGHLIGHT_DEBOUNCE_MS = 150;
const MAX_QUEUED_MUTATION_BATCHES = 64;
const MAX_CONCURRENT_LOCAL_IMAGE_READS = 4;
const MAX_CONCURRENT_DRAWIO_READS = 4;
const MAX_CONCURRENT_EMBED_READS = 8;
const MAX_CONCURRENT_LINK_OPENS = 1;
const LINK_OPEN_BURST = 4;
const LINK_OPEN_REFILL_MS = 1_000;

/**
 * Owns the sync relationship between one vscode.TextDocument and one webview panel
 * showing it. All edits from the webview are applied via WorkspaceEdit so that
 * VS Code's native undo/redo stack stays the single source of truth (CM6's own
 * history extension is intentionally not used in the webview).
 */
export class DocumentSyncSession {
	private disposables: vscode.Disposable[] = [];
	private lastAppliedVersion: number;
	// True for the entire span of an applyEdit() call, including the synchronous
	// onDidChangeTextDocument dispatch that happens *inside* workspace.applyEdit()
	// before its promise resolves. Without this, handleDocumentChanged sees that
	// echo before lastAppliedVersion has been bumped and mistakes our own edit for
	// an external one, re-sending it to the webview on top of text that already
	// has it — corrupting later offset math and losing/duplicating characters.
	private applyingLocalEdit = false;
	private rehighlightTimer: ReturnType<typeof setTimeout> | undefined;
	private rehighlightGeneration = 0;
	// Serializes text edits, attachment batches, and undo/redo so one mutation
	// cannot race a prior operation before document.version and offsets settle.
	private readonly mutationQueue = new BoundedSerialQueue(MAX_QUEUED_MUTATION_BATCHES);
	private visible: boolean;
	private needsFullSync = false;
	private needsRehighlight = false;
	private pendingCss = false;
	private pendingVaultNotes = false;
	private readonly pendingLineNavigation = new PendingLineNavigation();
	private readyReceived = false;
	private vaultNotesGeneration = 0;
	private disposed = false;
	private closing = false;
	private readonly resyncRateLimiter = new TokenBucketRateLimiter(4, 1000);
	private readonly recoveryLimiter = new RequestLimiter(2);
	private clipboardWritePending = false;
	private readonly clipboardRateLimiter = new TokenBucketRateLimiter(4, 1_000);
	private readonly localImageLimiter = new RequestLimiter(MAX_CONCURRENT_LOCAL_IMAGE_READS);
	private readonly drawioLimiter = new RequestLimiter(MAX_CONCURRENT_DRAWIO_READS);
	private readonly referencedDrawioFiles = new Set<string>();
	private drawioRefreshTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly embedLimiter = new RequestLimiter(MAX_CONCURRENT_EMBED_READS);
	private readonly linkLimiter = new RequestLimiter(MAX_CONCURRENT_LINK_OPENS);
	private readonly linkRateLimiter = new TokenBucketRateLimiter(LINK_OPEN_BURST, LINK_OPEN_REFILL_MS);
	/** Raw VS Code text corresponding to the last protocol snapshot/version. */
	private documentText: string;
	// A single replaceable snapshot, not one full-document allocation per queued
	// keystroke. Captured before blur/close because iframe teardown can skip them.
	private pendingDraft?: Extract<EditorToHostMessage, { type: 'draftSnapshot' }>;
	private draftFlushQueued = false;
	private closeOperation?: Promise<void>;

	constructor(
		private document: vscode.TextDocument,
		private readonly webviewPanel: vscode.WebviewPanel,
		private readonly getCss: () => string,
		private readonly getVaultNotes: () => VaultNoteSummary[],
		private readonly revealOpenedLine?: (uri: vscode.Uri, line: number) => boolean,
		private readonly settleAutoSave?: () => Promise<void>,
		private readonly preserveDraft?: (text: string) => Promise<void>,
		private readonly saveExplicitly?: () => Promise<void>,
	) {
		this.lastAppliedVersion = document.version;
		this.documentText = document.getText();
		this.visible = webviewPanel.visible;
		const diagramRoot = localWorkspaceVaultRoot(document.uri);
		if (diagramRoot?.scheme === 'file') {
			const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(diagramRoot, '**/*'));
			const refresh = (uri: vscode.Uri) => {
				if (this.disposed || !this.readyReceived || !vscode.workspace.isTrusted ||
					!this.referencedDrawioFiles.has(uri.toString())) return;
				if (this.drawioRefreshTimer) clearTimeout(this.drawioRefreshTimer);
				this.drawioRefreshTimer = setTimeout(() => {
					this.drawioRefreshTimer = undefined;
					if (!this.disposed && vscode.workspace.isTrusted) this.post({ type: 'invalidateDrawioFiles' });
				}, 150);
			};
			this.disposables.push(watcher, watcher.onDidChange(refresh), watcher.onDidCreate(refresh), watcher.onDidDelete(refresh));
		}
		this.disposables.push(vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('mdLivePreview.showWhitespace', this.document.uri) && this.readyReceived) {
				this.sendWhitespaceSetting();
			}
			if (event.affectsConfiguration('mdLivePreview.codeTheme', this.document.uri) && this.readyReceived) {
				this.scheduleRehighlight(true);
			}
		}));

		this.disposables.push(
			webviewPanel.webview.onDidReceiveMessage((raw: unknown) => {
				if (this.closing) return;
				const parsed = validateEditorToHostMessage(
					raw,
					createLineEndingMap(this.document.getText()).normalizedText.length,
					this.document.version,
				);
				if (!parsed.ok) {
					diagnosticEventRateLimited('protocol.webviewMessageRejected', { reason: parsed.reason });
					// A well-shaped stale edit is a normal concurrent-writer conflict,
					// not permission to silently abandon the renderer's pending text.
					if (validateEditorToHostMessage(raw, MAX_EDITOR_DOCUMENT_BYTES).ok &&
						(raw as EditorToHostMessage).type === 'edit' && this.resyncRateLimiter.tryTake()) {
						this.enqueueMutation(() => this.sendInit());
					}
					return;
				}
				this.handleMessage(parsed.value);
			}),
		);

		this.disposables.push(
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.document.uri.toString() === document.uri.toString()) {
					this.handleDocumentChanged(event);
				}
			}),
		);

		this.disposables.push(
			vscode.window.onDidChangeActiveColorTheme(() => this.scheduleRehighlight(true)),
		);
		this.disposables.push(
			webviewPanel.onDidChangeViewState((event) => this.setVisible(event.webviewPanel.visible)),
		);
	}

	private post(message: HostToEditorMessage) {
		this.webviewPanel.webview.postMessage(message);
	}

	private handleMessage(message: EditorToHostMessage) {
		switch (message.type) {
			case 'draftSnapshot':
				this.pendingDraft = message;
				if (!this.visible) this.queuePendingDraftFlush();
				break;
			case 'save':
				this.enqueueMutation(async () => { await this.saveExplicitly?.(); });
				break;
			case 'resync':
				if (this.resyncRateLimiter.tryTake()) this.enqueueMutation(() => this.sendInit());
				break;
			case 'checkpoint':
			case 'preserveDraft': {
				const release = this.recoveryLimiter.tryAcquire();
				if (!release) { this.post({ type: 'draftPreserved', requestId: message.requestId, ok: false }); break; }
				if (!this.enqueueMutation(async () => {
					try {
						if (message.type === 'checkpoint') {
							if (await this.trySaveSnapshot(message)) {
								this.post({ type: 'draftPreserved', requestId: message.requestId, ok: true });
								return;
							}
						}
						if (!this.preserveDraft) throw new Error('Recovery store unavailable');
						await this.preserveDraft(message.text);
						this.post({ type: 'draftPreserved', requestId: message.requestId, ok: true });
					} catch {
						this.post({ type: 'draftPreserved', requestId: message.requestId, ok: false });
						void vscode.window.showErrorMessage(vscode.l10n.t('A Markdown recovery draft could not be saved. Keep the editor open and save a copy before closing it.'));
					} finally { release(); }
				})) { release(); this.post({ type: 'draftPreserved', requestId: message.requestId, ok: false }); }
				break;
			}
			case 'copyCode': {
				if (this.disposed || !this.webviewPanel.active || this.clipboardWritePending || !this.clipboardRateLimiter.tryTake()) {
					this.post({ type: 'copyCodeResult', requestId: message.requestId, ok: false });
					break;
				}
				this.clipboardWritePending = true;
				void Promise.resolve().then(() => vscode.env.clipboard.writeText(message.text)).then(
					() => this.post({ type: 'copyCodeResult', requestId: message.requestId, ok: true }),
					() => this.post({ type: 'copyCodeResult', requestId: message.requestId, ok: false }),
				).finally(() => { this.clipboardWritePending = false; });
				break;
			}
			case 'ready':
				if (this.readyReceived) {
					diagnosticEventRateLimited('protocol.duplicateReadyRejected');
					break;
				}
				this.readyReceived = true;
				// Retained VS Code panels can stay document.hidden === false even
				// when their tab is not shown. Send host-owned visibility before init
				// so a new or policy-reloaded renderer does not start hidden work.
				this.post({ type: 'panelVisibility', visible: this.visible });
				void this.mutationQueue.drain().then(() => {
					if (this.disposed) return;
					if (this.visible) { this.sendInit(); this.scheduleRehighlight(true); }
					else { this.needsFullSync = true; this.needsRehighlight = true; }
					this.flushPendingJump();
				});
				break;
			case 'edit': {
				const acceptedText = this.documentText;
				if (!this.enqueueMutation(async () => {
					try { await this.applyEdit(message.changes, message.baseVersion, true, acceptedText); }
					catch { await this.recoverRejectedEdit(acceptedText, message.changes); }
				})) this.sendInit();
				break;
			}
			case 'undo':
				// Chained onto mutationQueue (not fired immediately) so it can't run ahead
				// of an 'edit' message still being applied — otherwise it would undo
				// the wrong (older) change and desync from the webview's local state.
				this.enqueueMutation(async () => {
					await this.settleAutoSave?.();
					if (this.disposed || !this.webviewPanel.active) return;
					await vscode.commands.executeCommand('undo');
					await this.settleAutoSave?.();
				});
				break;
			case 'redo':
				this.enqueueMutation(async () => {
					await this.settleAutoSave?.();
					if (this.disposed || !this.webviewPanel.active) return;
					await executeCaseAwareRedo(() => vscode.commands.executeCommand('redo'));
					await this.settleAutoSave?.();
				});
				break;
			case 'openLink':
				{
					const release = this.linkLimiter.tryAcquire();
					if (!release || !this.linkRateLimiter.tryTake()) {
						release?.();
						diagnosticEventRateLimited('protocol.linkRequestRejected');
						break;
					}
					void this.openLink(message.href)
						.catch(() => diagnosticEventRateLimited('protocol.linkRequestFailed'))
						.finally(release);
				}
				break;
			case 'pasteImage':
				if (!vscode.workspace.isTrusted) return;
				this.enqueuePastedImages(message.atPos, [{ mimeType: message.mimeType, dataBase64: message.dataBase64 }], message.needsOwnParagraph);
				break;
			case 'pasteImages':
				if (!vscode.workspace.isTrusted) return;
				this.enqueuePastedImages(message.atPos, message.images, message.needsOwnParagraph);
				break;
			case 'readDrawioFile':
				if (!vscode.workspace.isTrusted) return;
				{
					const release = this.drawioLimiter.tryAcquire();
					if (!release) {
						this.post({ type: 'drawioFile', requestId: message.requestId, error: vscode.l10n.t('Too many draw.io files are loading at once.') });
						return;
					}
					void this.handleReadDrawioFile(message.requestId, message.src)
						.catch(() => this.post({ type: 'drawioFile', requestId: message.requestId, error: vscode.l10n.t('Could not read the file.') }))
						.finally(release);
				}
				break;
			case 'readWikiEmbed':
				{
					const release = this.embedLimiter.tryAcquire();
					if (!release) {
						this.post({ type: 'wikiEmbed', requestId: message.requestId, error: vscode.l10n.t('Too many embedded notes are loading at once.') });
						return;
					}
					void this.handleReadWikiEmbed(message.requestId, message.body, message.contextPath)
						.catch(() => this.post({ type: 'wikiEmbed', requestId: message.requestId, error: vscode.l10n.t('The embedded note could not be read.') }))
						.finally(release);
				}
				break;
			case 'resolveLocalImage':
				{
					const release = this.localImageLimiter.tryAcquire();
					if (!release) {
						this.post({ type: 'localImage', requestId: message.requestId, error: vscode.l10n.t('Too many local images are loading at once.') });
						return;
					}
					void this.handleResolveLocalImage(message.requestId, message.src, message.contextPath)
						.catch(() => this.post({ type: 'localImage', requestId: message.requestId, error: vscode.l10n.t('The local image could not be loaded securely.') }))
						.finally(release);
				}
				break;
		}
	}

	private enqueueMutation(task: () => void | Promise<void>): boolean {
		const accepted = this.mutationQueue.tryEnqueue(task, () => {
			diagnosticEventRateLimited('protocol.mutationFailed');
		});
		if (!accepted) {
			diagnosticEventRateLimited('protocol.editQueueRejected', {
				queued: this.mutationQueue.pendingCount,
			});
		}
		return accepted;
	}

	private queuePendingDraftFlush(): void {
		if (this.draftFlushQueued || !this.pendingDraft) return;
		this.draftFlushQueued = true;
		if (!this.enqueueMutation(async () => {
			const pending = this.pendingDraft;
			try { await this.flushPendingDraft(); }
			finally {
				this.draftFlushQueued = false;
				if (this.pendingDraft && this.pendingDraft !== pending) this.queuePendingDraftFlush();
			}
		})) this.draftFlushQueued = false;
	}

	private async trySaveSnapshot(draft: { text: string; baselineText: string; requiresSeparatePreservation?: true }): Promise<boolean> {
		if (draft.requiresSeparatePreservation) return false;
		try {
			await this.reopenClosedDocument();
			const text = normalizeLineEndingsForWebview(this.document.getText());
			if (text === draft.baselineText && text !== draft.text) {
				await this.applyEdit([{ from: 0, to: text.length, insert: draft.text }], this.document.version, false);
				if (normalizeLineEndingsForWebview(this.document.getText()) !== text) {
					// Snapshot-only widget drafts are not normal renderer batches, so
					// they produce no edit ACK. A retained renderer still needs their
					// authoritative source/version before its next edit. Visibility may
					// have changed while the native edit/save was awaited.
					if (this.visible && this.readyReceived && !this.closing) {
						this.needsFullSync = false;
						this.sendInit();
					} else this.needsFullSync = true;
				}
			}
			await this.settleAutoSave?.();
			return !this.document.isDirty && normalizeLineEndingsForWebview(this.document.getText()) === draft.text;
		} catch { return false; } // Native failure must still allow a local recovery copy.
	}

	private async flushPendingDraft(): Promise<void> {
		const draft = this.pendingDraft;
		if (!draft) return;
		try {
			if (await this.trySaveSnapshot(draft)) {
				if (this.pendingDraft === draft) this.pendingDraft = undefined;
				return;
			}
			if (!this.preserveDraft) throw new Error('Recovery unavailable');
			await this.preserveDraft(draft.text);
			if (this.pendingDraft === draft) this.pendingDraft = undefined;
		} catch {
			void vscode.window.showErrorMessage(vscode.l10n.t('The pending Markdown draft could not be saved or preserved. Reopen the editor and save a copy before closing VS Code.'));
		}
	}

	private async handleResolveLocalImage(requestId: number, src: string, contextPath: string): Promise<void> {
		const reply = (payload: { mimeType?: string; dataBase64?: string; error?: string }) => {
			void this.webviewPanel.webview.postMessage({ type: 'localImage', requestId, ...payload });
		};
		const resolution = await VaultService.resolve();
		if (!resolution.available) {
			reply({ error: vscode.l10n.t('Local images require one local workspace folder.') });
			return;
		}
		const currentPath = resolution.service.relativePath(this.document.uri);
		const isKnownContext = contextPath === currentPath || this.getVaultNotes().some((note) => note.path === contextPath);
		if (!isKnownContext) {
			reply({ error: vscode.l10n.t('The local image context is invalid.') });
			return;
		}
		try {
			const image = await resolution.service.resolveLocalImage(contextPath, src);
			const { bytes } = await resolution.service.readFileInside(image, MAX_LOCAL_IMAGE_BYTES);
			const mimeType = rasterMimeTypeForPath(image.fsPath);
			if (!mimeType || !hasRasterImageSignature(mimeType, bytes) || !hasSafeRasterImageDimensions(mimeType, bytes)) {
				throw new Error('Invalid raster image.');
			}
			reply({ mimeType, dataBase64: Buffer.from(bytes).toString('base64') });
		} catch {
			// Do not echo an attacker-controlled path or expose which outside-vault
			// path exists. The UI only needs to know that this image is unavailable.
			reply({ error: vscode.l10n.t('The local image could not be loaded securely.') });
		}
	}

	private async handleReadWikiEmbed(requestId: number, body: string, contextPath: string): Promise<void> {
		const reply = (payload: { sourcePath?: string; text?: string; error?: string }) => {
			void this.webviewPanel.webview.postMessage({ type: 'wikiEmbed', requestId, ...payload });
		};
		const parsed = parseWikiLinkBody(body);
		if (!parsed) {
			reply({ error: vscode.l10n.t('The embed target is invalid.') });
			return;
		}
		const workspaceRoot = localWorkspaceVaultRoot(this.document.uri);
		if (!workspaceRoot || workspaceRoot.scheme !== 'file') {
			reply({ error: vscode.l10n.t('Embeds require a local workspace folder.') });
			return;
		}
		const vaultResolution = await VaultService.resolve();
		if (!vaultResolution.available || vaultResolution.service.rootUri.fsPath !== workspaceRoot.fsPath) {
			reply({ error: vscode.l10n.t('Embeds require a local workspace folder.') });
			return;
		}
		let note: VaultNoteSummary | undefined;
		if (!parsed.target) {
			const current = contextPath || relative(workspaceRoot.fsPath, this.document.uri.fsPath).replace(/\\/g, '/');
			note = this.getVaultNotes().find((candidate) => candidate.path === current);
		} else {
			const resolution = resolveWikiLinkSummary(parsed.target, this.getVaultNotes());
			if (resolution.kind === 'resolved') note = resolution.note;
			else {
				reply({ error: resolution.kind === 'ambiguous'
					? vscode.l10n.t('The embed target is ambiguous.')
					: vscode.l10n.t('The embedded note was not found.') });
				return;
			}
		}
		if (!note) {
			reply({ error: vscode.l10n.t('The embedded note was not found.') });
			return;
		}
		const uri = vscode.Uri.joinPath(workspaceRoot, note.path);
		if (!isInside(workspaceRoot, uri) || !(await isCanonicallyInside(workspaceRoot, uri))) {
			reply({ error: vscode.l10n.t('The embed target is outside the vault.') });
			return;
		}
		try {
			await vaultResolution.service.assertExistingInside(uri);
			const openDocument = uri.toString() === this.document.uri.toString()
				? this.document
				: vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
			const text = openDocument
				? openDocument.getText()
				: new TextDecoder('utf-8', { fatal: true }).decode(
					(await vaultResolution.service.readFileInside(uri, MAX_WIKI_EMBED_BYTES)).bytes,
				);
			const selected = extractWikiEmbedContent(text, parsed.fragment);
			if (selected === undefined) {
				reply({ error: vscode.l10n.t('The embedded heading or block was not found.') });
				return;
			}
			if (new TextEncoder().encode(selected).byteLength > MAX_WIKI_EMBED_BYTES) {
				reply({ error: vscode.l10n.t('The embedded content is too large.') });
				return;
			}
			reply({ sourcePath: note.path, text: selected });
		} catch {
			reply({ error: vscode.l10n.t('The embedded note could not be read.') });
		}
	}

	/**
	 * Reads a `.drawio` file referenced from the document and sends its text back.
	 *
	 * The webview cannot touch the filesystem, and an `<img>` cannot render
	 * mxGraph XML, so a `![](diagram.drawio)` reference has to come through here.
	 *
	 * The path is confined to the document's own folder tree. `src` comes
	 * straight out of the Markdown, so it can say `../../../../etc/passwd`, and
	 * this handler would otherwise happily read it and hand the contents to the
	 * webview — turning "open a Markdown file someone sent you" into an arbitrary
	 * file read. Resolving first and then checking that the result is still under
	 * the document's directory is what closes that, and it is done on the
	 * resolved path because `..` segments only cancel out after resolution.
	 */
	private async handleReadDrawioFile(requestId: number, src: string): Promise<void> {
		const reply = (payload: { text?: string; error?: string }) => {
			void this.webviewPanel.webview.postMessage({ type: 'drawioFile', requestId, ...payload });
		};
		if (!vscode.workspace.isTrusted) return;

		const target = resolveLinkTarget(src);
		if (target.kind !== 'relative' || !isDrawioPath(target.path)) {
			// A remote diagram would mean the webview fetching over the network on
			// behalf of a file the user merely opened; only local files are read.
			reply({ error: vscode.l10n.t('Only local .drawio files can be shown.') });
			return;
		}

		const vaultRoot = localWorkspaceVaultRoot(this.document.uri);
		if (!vaultRoot || vaultRoot.scheme !== 'file') {
			reply({ error: vscode.l10n.t('Local diagrams require one local workspace folder.') });
			return;
		}
		const docDir = vscode.Uri.joinPath(this.document.uri, '..');
		const uri = vscode.Uri.joinPath(docDir, target.path);
		// Track only bounded, local authored references. Every re-read still uses
		// the canonical containment and size checks below, including symlink swaps.
		if (isInside(vaultRoot, uri) && this.referencedDrawioFiles.size < 256) this.referencedDrawioFiles.add(uri.toString());
		if (!isInside(vaultRoot, uri) || !(await isCanonicallyInside(vaultRoot, uri))) {
			reply({ error: vscode.l10n.t('Files outside the workspace cannot be read.') });
			return;
		}

		try {
			const resolution = await VaultService.resolve();
			if (!resolution.available || resolution.service.rootUri.fsPath !== vaultRoot.fsPath) throw new Error('No vault.');
			const { bytes } = await resolution.service.readFileInside(uri, MAX_DRAWIO_BYTES);
			if (!vscode.workspace.isTrusted) return;
			reply({ text: new TextDecoder('utf-8').decode(bytes) });
		} catch (error) {
			// Do not echo an attacker-authored path across the privileged message
			// boundary. The renderer deliberately presents one generic, localized
			// failure state and does not need filesystem details.
			if ((error as Error).message.includes('size limit')) {
				reply({ error: vscode.l10n.t('The file is too large (over 5MB).') });
				return;
			}
			reply({ error: vscode.l10n.t('Could not read the file.') });
		}
	}

	/**
	 * Follows a link from the preview.
	 *
	 * `openExternal(Uri.parse(href))` was used for every link, which is right
	 * only for one that already carries a scheme. A relative link — `./notes.md`,
	 * `../img/a.png`, or a bare `notes.md`, the common case in a Markdown file —
	 * parses into a scheme-less URI that resolves against nothing, and the shell
	 * was handed a path it could not find ("0x2"). Those are resolved against the
	 * document's own folder instead, and opened in the editor rather than the
	 * shell, which is what following a link between notes should do.
	 */
	private async openLink(href: string): Promise<void> {
		if (href.startsWith('wikilink:')) {
			await this.openWikiLink(href.slice('wikilink:'.length));
			return;
		}
		const target = resolveLinkTarget(href);
		if (target.kind === 'ignore') return;
		if (target.kind === 'anchor') {
			const line = await this.lineForDocumentFragment(this.document.uri, target.fragment);
			if (line !== undefined) this.jumpToLine(line);
			return;
		}
		if (target.kind === 'blocked') {
			void vscode.window.showWarningMessage(vscode.l10n.t('This link type is blocked for security.'));
			return;
		}
		if (target.kind === 'insecureHttp') {
			const open = vscode.l10n.t('Open insecure link');
			const choice = await vscode.window.showWarningMessage(
				vscode.l10n.t('This link uses insecure HTTP: {0}', target.href),
				{ modal: true },
				open,
			);
			if (choice === open) await vscode.env.openExternal(vscode.Uri.parse(target.href));
			return;
		}
		if (target.kind === 'external') {
			await vscode.env.openExternal(vscode.Uri.parse(target.href));
			return;
		}

		const workspaceRoot = localWorkspaceVaultRoot(this.document.uri);
		if (!workspaceRoot || workspaceRoot.scheme !== 'file') {
			void vscode.window.showWarningMessage(vscode.l10n.t('Local links require one local workspace folder.'));
			return;
		}
		const docDir = vscode.Uri.joinPath(this.document.uri, '..');
		const uri = vscode.Uri.joinPath(docDir, target.path);
		if (!isInside(workspaceRoot, uri)) {
			void vscode.window.showWarningMessage(vscode.l10n.t('Links outside the workspace cannot be opened.'));
			return;
		}
		const vaultResolution = await VaultService.resolve();
		if (!vaultResolution.available || vaultResolution.service.rootUri.fsPath !== workspaceRoot.fsPath) {
			void vscode.window.showWarningMessage(vscode.l10n.t('Local links require one local workspace folder.'));
			return;
		}
		try {
			await vaultResolution.service.assertRegularFileInside(uri);
		} catch {
			void vscode.window.showWarningMessage(vscode.l10n.t('The local link target could not be opened securely.'));
			return;
		}
		const line = target.fragment ? await this.lineForDocumentFragment(uri, target.fragment) : undefined;
		if (uri.toString() === this.document.uri.toString() && line !== undefined) {
			this.jumpToLine(line);
			return;
		}
		try {
			await openConfiguredVaultResource(uri);
		} catch {
			// Never hand a vault file to the operating system. A crafted note could
			// otherwise turn a click on an apparently ordinary local link into an
			// executable launch. VS Code remains the only local-file opener; formats
			// without a registered editor fail closed.
			void vscode.window.showWarningMessage(vscode.l10n.t('The local link target could not be opened safely in VS Code.'));
			return;
		}
		if (line !== undefined && !this.revealOpenedLine?.(uri, line)) {
			await vscode.commands.executeCommand('revealLine', { lineNumber: line - 1, at: 'center' });
		}
	}

	private async lineForDocumentFragment(uri: vscode.Uri, fragment: string): Promise<number | undefined> {
		const workspaceRoot = localWorkspaceVaultRoot(uri);
		const path = workspaceRoot?.scheme === 'file' ? relative(workspaceRoot.fsPath, uri.fsPath).replace(/\\/g, '/') : undefined;
		const note = path ? this.getVaultNotes().find((candidate) => candidate.path === path) : undefined;
		return this.lineForWikiFragment(uri, note, fragment.startsWith('#^') ? fragment.slice(1) : fragment);
	}

	private async openWikiLink(encodedBody: string): Promise<void> {
		let body: string;
		try { body = decodeURIComponent(encodedBody); } catch { return; }
		const parsed = parseWikiLinkBody(body);
		if (!parsed) return;
		const workspaceRoot = localWorkspaceVaultRoot(this.document.uri);
		if (!workspaceRoot) return;
		const { target, fragment } = parsed;
		const summaries = this.getVaultNotes();
		let chosen: VaultNoteSummary | undefined;
		if (!target) {
			chosen = summaries.find((note) => vscode.Uri.joinPath(workspaceRoot, note.path).toString() === this.document.uri.toString());
		} else {
			const resolution = resolveWikiLinkSummary(target, summaries);
			if (resolution.kind === 'resolved') chosen = resolution.note;
			else if (resolution.kind === 'ambiguous') {
				const pick = await vscode.window.showQuickPick(resolution.notes.map((note) => ({
					label: note.basename,
					description: note.path,
					note,
				})), { title: vscode.l10n.t('Choose a note for this wikilink') });
				chosen = pick?.note;
			}
		}

		let uri: vscode.Uri;
		if (chosen) {
			uri = vscode.Uri.joinPath(workspaceRoot, chosen.path);
		} else {
			if (target && isOpenOnlyAttachmentTarget(target)) {
				const vault = await VaultService.resolve();
				if (!vault.available || vault.service.rootUri.toString() !== workspaceRoot.toString()) return;
				try {
					uri = await vault.service.resolveLinkedAttachment(target);
					await openConfiguredVaultResource(uri);
				} catch {
					void vscode.window.showWarningMessage(vscode.l10n.t('The wikilink target could not be opened.'));
				}
				return;
			}
			if (!target || !vscode.workspace.isTrusted) return;
			const create = vscode.l10n.t('Create note');
			const answer = await vscode.window.showInformationMessage(
				vscode.l10n.t('The note "{0}" does not exist. Create it in this vault?', target),
				{ modal: true },
				create,
			);
			if (answer !== create) return;
			if (!vscode.workspace.isTrusted) return;
			const resolution = await VaultService.resolve();
			if (!resolution.available || resolution.service.rootUri.toString() !== workspaceRoot.toString()) return;
			if (!vscode.workspace.isTrusted) return;
			try {
				uri = await resolution.service.createNoteAtRelativePath(
					target,
					() => vscode.workspace.isTrusted
						&& localWorkspaceVaultRoot(this.document.uri)?.toString() === workspaceRoot.toString(),
				);
			} catch {
				void vscode.window.showErrorMessage(vscode.l10n.t('The note could not be created safely.'));
				return;
			}
		}
		if (!isInside(workspaceRoot, uri)) return;
		const navigationVault = await VaultService.resolve();
		if (!navigationVault.available || navigationVault.service.rootUri.toString() !== workspaceRoot.toString()) return;
		try {
			await navigationVault.service.assertRegularFileInside(uri);
		} catch {
			void vscode.window.showWarningMessage(vscode.l10n.t('The wikilink target could not be opened.'));
			return;
		}
		const line = await this.lineForWikiFragment(uri, chosen, fragment);
		if (uri.toString() === this.document.uri.toString() && line !== undefined) {
			this.jumpToLine(line);
			return;
		}
		try {
			await openConfiguredVaultResource(uri);
			if (line !== undefined) {
				if (!this.revealOpenedLine?.(uri, line)) {
					await vscode.commands.executeCommand('revealLine', { lineNumber: line - 1, at: 'center' });
				}
			}
		} catch {
			void vscode.window.showWarningMessage(vscode.l10n.t('The wikilink target could not be opened.'));
		}
	}

	private async lineForWikiFragment(
		uri: vscode.Uri,
		note: VaultNoteSummary | undefined,
		fragment: string,
	): Promise<number | undefined> {
		if (!fragment) return undefined;
		if (fragment.startsWith('#') && note) {
			const wanted = wikiHeadingSlug(fragment.slice(1));
			const indexed = note.headings.find((heading) => wikiHeadingSlug(heading.text) === wanted)?.line;
			if (indexed !== undefined) return indexed;
		}
		try {
			if (uri.toString() === this.document.uri.toString()) {
				return findMarkdownAnchorLine(this.document.getText(), fragment);
			}
			const vault = await VaultService.resolve();
			if (!vault.available) return undefined;
			await vault.service.assertExistingInside(uri);
			const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
			const text = open
				? open.getText()
				: new TextDecoder('utf-8', { fatal: true }).decode(
					(await vault.service.readFileInside(uri, MAX_EDITOR_DOCUMENT_BYTES)).bytes,
				);
			return findMarkdownAnchorLine(text, fragment);
		} catch { return undefined; }
	}

	/**
	 * Saves a pasted/dropped image batch under an `assets/` folder beside the
	 * document and inserts its Markdown image links at `atPos`. This edit
	 * originates on the host (the final relative path is only known after
	 * writing the file), unlike every other edit in this class — so it is
	 * applied as a plain `vscode.WorkspaceEdit` (not via `applyEdit()`) and
	 * deliberately does *not* set `applyingLocalEdit`, letting the existing
	 * `handleDocumentChanged` → `externalUpdate` path deliver it to the
	 * webview exactly as if it were an edit from another tab.
	 */
	private enqueuePastedImages(atPos: number, images: PastedImagePayload[], needsOwnParagraph: boolean): void {
		this.enqueueMutation(() => this.handlePasteImages(atPos, images, needsOwnParagraph));
	}

	private async handlePasteImages(
		atPos: number,
		images: PastedImagePayload[],
		needsOwnParagraph: boolean,
	): Promise<void> {
		if (!vscode.workspace.isTrusted) return;
		if (images.length === 0 || images.length > MAX_PASTED_IMAGE_COUNT) return;
		const validatedImages: Array<{ ext: string; bytes: Buffer }> = [];
		let totalBytes = 0;
		for (const image of images) {
			const ext = extensionForMimeType(image.mimeType);
			if (!ext) return;
			const bytes = Buffer.from(image.dataBase64, 'base64');
			if (bytes.byteLength > MAX_PASTED_IMAGE_BYTES || totalBytes > MAX_PASTED_IMAGE_OPERATION_BYTES - bytes.byteLength) return;
			totalBytes += bytes.byteLength;
			if (!hasRasterImageSignature(image.mimeType, bytes)) {
				void vscode.window.showWarningMessage(vscode.l10n.t('The pasted image content does not match its declared type.'));
				return;
			}
			if (!hasSafeRasterImageDimensions(image.mimeType, bytes)) {
				void vscode.window.showWarningMessage(vscode.l10n.t('The pasted image dimensions are invalid or exceed the safe limit.'));
				return;
			}
			validatedImages.push({ ext, bytes });
		}
		if (this.document.uri.scheme !== 'file') {
			void vscode.window.showWarningMessage(vscode.l10n.t('Attachments can only be saved in a local workspace.'));
			return;
		}

		const docDir = vscode.Uri.joinPath(this.document.uri, '..');
		const workspaceRoot = localWorkspaceVaultRoot(this.document.uri);
		if (!workspaceRoot || workspaceRoot.scheme !== 'file') {
			void vscode.window.showWarningMessage(vscode.l10n.t('Attachments require a local workspace folder.'));
			return;
		}
		const vaultResolution = await VaultService.resolve();
		if (!vaultResolution.available || vaultResolution.service.rootUri.fsPath !== workspaceRoot.fsPath) {
			void vscode.window.showWarningMessage(vscode.l10n.t('Attachments require a local workspace folder.'));
			return;
		}
		const vaultService = vaultResolution.service;
		const configuredFolder = vscode.workspace
			.getConfiguration('mdLivePreview.vault', this.document.uri)
			.get<string>('attachmentFolder', 'assets');
		let assetsDir: vscode.Uri;
		try {
			assetsDir = vscode.Uri.file(resolveAttachmentFolder(workspaceRoot.fsPath, docDir.fsPath, configuredFolder));
		} catch {
			void vscode.window.showWarningMessage(vscode.l10n.t('The configured attachment folder is invalid.'));
			return;
		}
		try {
			assetsDir = await vaultService.ensureDirectoryInside(
				assetsDir,
				() => vscode.workspace.isTrusted
					&& localWorkspaceVaultRoot(this.document.uri)?.toString() === workspaceRoot.toString(),
			);
		} catch {
			void vscode.window.showWarningMessage(
				vscode.l10n.t('The attachment folder resolves outside the workspace, so the image was not saved.'),
			);
			return;
		}

		let existingNames: string[];
		try {
			existingNames = (await vaultService.readDirectoryInside(assetsDir)).map(([name]) => name);
		} catch {
			existingNames = [];
		}
		const names = new Set(existingNames);
		const timestamp = Date.now();
		const createdFiles: CreatedVaultFile[] = [];
		const rollback = async () => {
			for (let index = createdFiles.length - 1; index >= 0; index--) {
				await vaultService.removeCreatedFile(createdFiles[index]);
			}
		};
		for (let imageIndex = 0; imageIndex < validatedImages.length; imageIndex++) {
			if (!vscode.workspace.isTrusted) {
				await rollback();
				return;
			}
			const image = validatedImages[imageIndex];
			let createdFile: CreatedVaultFile | undefined;
			for (let attempt = 0; attempt < 100; attempt++) {
				const fileName = generateImageFileName(names, timestamp, image.ext);
				try {
					createdFile = await vaultService.createFileExclusive(
						assetsDir,
						fileName,
						image.bytes,
						MAX_PASTED_IMAGE_BYTES,
						() => vscode.workspace.isTrusted
							&& localWorkspaceVaultRoot(this.document.uri)?.toString() === workspaceRoot.toString(),
					);
					names.add(fileName);
					break;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
						await rollback();
						void vscode.window.showWarningMessage(vscode.l10n.t('The pasted image could not be saved securely.'));
						return;
					}
					names.add(fileName);
				}
			}
			if (!createdFile) {
				await rollback();
				void vscode.window.showWarningMessage(vscode.l10n.t('Could not allocate a unique attachment filename.'));
				return;
			}
			createdFiles.push(createdFile);
		}

		// `atPos` was relocated to just after a table (see `escapeTable` in
		// imagePasteHandler.ts) when the cursor was inside one — a leading
		// blank line separates the image into its own paragraph instead of
		// running it straight onto the table's last line.
		const markdownImages = createdFiles.map(({ uri }) => {
			const relativeAssetPath = relative(docDir.fsPath, uri.fsPath).replace(/\\/g, '/');
			const encodedAssetPath = encodeURI(relativeAssetPath).replace(/#/g, '%23').replace(/\?/g, '%3F');
			return `![](${encodedAssetPath})`;
		});
		const offsetMap = createLineEndingMap(this.document.getText());
		if (atPos > offsetMap.normalizedText.length) {
			await rollback();
			return;
		}
		const position = this.document.positionAt(offsetMap.toRawOffset(atPos));
		const joinedImages = markdownImages.join(needsOwnParagraph ? '\n\n' : '\n');
		const normalizedInsertText = needsOwnParagraph ? `\n\n${joinedImages}` : joinedImages;
		const insertText = normalizeInsertedLineEndings(
			normalizedInsertText,
			this.document.eol === vscode.EndOfLine.CRLF,
		);
		const edit = new vscode.WorkspaceEdit();
		edit.insert(this.document.uri, position, insertText);
		if (!vscode.workspace.isTrusted) {
			await rollback();
			return;
		}
		let applied = false;
		try {
			applied = await vscode.workspace.applyEdit(edit);
		} catch {
			await rollback();
			return;
		}
		if (!applied) {
			await rollback();
			return;
		}
		for (const createdFile of createdFiles) await vaultService.releaseCreatedFile(createdFile);

		this.post({ type: 'setCursor', pos: atPos + normalizedInsertText.length });
	}

	private sendWhitespaceSetting(): void {
		this.post({ type: 'setWhitespace', enabled: vscode.workspace.getConfiguration('mdLivePreview', this.document.uri).get<string>('showWhitespace', 'off') === 'on' });
	}

	private sendInit() {
		const configuration = vscode.workspace.getConfiguration('mdLivePreview', this.document.uri);
		const remoteMedia = resolveWorkspaceRemoteMediaPolicy(
			vscode.workspace.isTrusted,
			configuration.inspect<RemoteMediaPolicy>('remoteMedia'),
		);
		const diagramRenderingAllowed =
			vscode.workspace.isTrusted && configuration.get<'safe' | 'off'>('diagramRendering', 'safe') === 'safe';
		const editingMode = configuration.get<'editing' | 'locked'>('defaultEditingMode', 'editing');
		const workspaceRoot = localWorkspaceVaultRoot(this.document.uri);
		const currentVaultPath = workspaceRoot?.scheme === 'file'
			? relative(workspaceRoot.fsPath, this.document.uri.fsPath).replace(/\\/g, '/')
			: '';
		const rawText = this.document.getText();
		this.documentText = rawText;
		this.post({
			type: 'init',
			protocolVersion: EDITOR_PROTOCOL_VERSION,
			text: createLineEndingMap(rawText).normalizedText,
			version: this.document.version,
			css: vscode.workspace.isTrusted ? this.getCss() : '',
			codeTheme: pickCodeTheme(),
			remoteMedia,
			workspaceTrusted: vscode.workspace.isTrusted,
			diagramRenderingAllowed,
			editingMode: editingMode === 'locked' ? 'locked' : 'editing',
			// Large vault summaries cross in bounded follow-up chunks so opening an
			// editor never serializes one multi-megabyte IPC message synchronously.
			vaultNotes: [],
			currentVaultPath,
		});
		this.scheduleVaultNotesSync();
		this.lastAppliedVersion = this.document.version;
		this.sendWhitespaceSetting();
	}

	private async recoverRejectedEdit(acceptedText: string, changes: TextChange[]): Promise<void> {
		// A closing iframe cannot respond to a resync. Preserve the already
		// accepted draft using its immutable baseline, never stale file offsets.
		if (this.closing) {
			const draft = applyNormalizedTextChanges(normalizeLineEndingsForWebview(acceptedText), changes);
			try {
				if (draft === undefined || !this.preserveDraft) throw new Error('Recovery unavailable');
				await this.preserveDraft(draft);
			} catch {
				void vscode.window.showErrorMessage(vscode.l10n.t('An accepted Markdown edit could not be saved or preserved after closing. Reopen the note and check its contents before continuing.'));
			}
		} else this.sendInit();
	}

	private async applyEdit(changes: TextChange[], baseVersion: number, acknowledge = true, acceptedText = this.documentText) {
		// A new WorkspaceEdit can cancel a native save still writing the previous
		// version. Keep the edit/ack queue behind that save, then recheck authority
		// and version: a tab close or independent edit may have happened meanwhile.
		await this.settleAutoSave?.();
		if (this.disposed) return;
		const oldVersion = this.document.version;
		if (await this.reopenClosedDocument()) {
			if (baseVersion !== oldVersion || this.document.getText() !== acceptedText) {
				await this.recoverRejectedEdit(acceptedText, changes); return;
			}
			baseVersion = this.document.version;
		}
		if (baseVersion !== this.document.version) {
			// Webview's batch was computed against a document snapshot that has since
			// moved on (e.g. an external edit landed concurrently). Rather than risk
			// corrupting the file with stale offsets, request a full resync. The
			// webview retains its divergent local draft for separate recovery.
			await this.recoverRejectedEdit(acceptedText, changes);
			return;
		}
		if (changes.length === 0) {
			return;
		}
		const rawText = this.document.getText();
		if (rawText !== this.documentText) {
			await this.recoverRejectedEdit(acceptedText, changes);
			return;
		}
		const offsetMap = createLineEndingMap(rawText);
		const expectedNormalizedText = applyNormalizedTextChanges(offsetMap.normalizedText, changes);
		if (expectedNormalizedText === undefined) {
			await this.recoverRejectedEdit(acceptedText, changes);
			return;
		}

		const edit = new vscode.WorkspaceEdit();
		for (const change of changes) {
			edit.replace(
				this.document.uri,
				new vscode.Range(
					this.document.positionAt(offsetMap.toRawOffset(change.from)),
					this.document.positionAt(offsetMap.toRawOffset(change.to)),
				),
				normalizeInsertedLineEndings(change.insert, this.document.eol === vscode.EndOfLine.CRLF),
			);
		}

		this.applyingLocalEdit = true;
		let applied = false;
		try {
			applied = await vscode.workspace.applyEdit(edit);
		} finally {
			this.applyingLocalEdit = false;
		}
		if (!applied) {
			await this.recoverRejectedEdit(acceptedText, changes);
			return;
		}
		// Drain this batch's save before acknowledging another editable snapshot.
		// The controller still reports failures and never bypasses containment.
		await this.settleAutoSave?.();
		if (this.disposed) return;
		this.lastAppliedVersion = this.document.version;
		this.documentText = this.document.getText();
		if (createLineEndingMap(this.documentText).normalizedText !== expectedNormalizedText) {
			// A filesystem provider or unusual line-ending boundary produced a
			// different document than the batch the webview already applied. Do not
			// acknowledge divergent state; replace it with the authoritative snapshot.
			await this.recoverRejectedEdit(acceptedText, changes);
			return;
		}
		if (acknowledge && this.closing && this.document.isDirty) {
			// The original editor is gone, so its native dirty buffer is not enough
			// to call this accepted edit safe. Keep a separate local recovery copy.
			await this.recoverRejectedEdit(acceptedText, changes);
			return;
		}
		if (acknowledge) this.post({ type: 'ackEdit', version: this.document.version });
		this.scheduleRehighlight();
	}

	private handleDocumentChanged(event: vscode.TextDocumentChangeEvent) {
		if (this.applyingLocalEdit) {
			// Echo of the edit applyEdit() is in the middle of making; the webview
			// already reflects it locally, so there is nothing to forward. Still
			// track the version so a later genuine external edit compares correctly.
			this.lastAppliedVersion = event.document.version;
			this.documentText = event.document.getText();
			return;
		}
		if (event.document.version <= this.lastAppliedVersion) {
			// This change is the echo of an edit we just applied ourselves; the
			// webview already reflects it locally, so there is nothing to forward.
			this.documentText = event.document.getText();
			return;
		}
		const previousText = this.documentText;
		const offsetMap = createLineEndingMap(previousText);
		this.lastAppliedVersion = event.document.version;
		this.documentText = event.document.getText();
		if (event.contentChanges.length === 0) {
			return;
		}
		if (!this.visible) {
			// A retained but hidden webview should do no document parsing. Coalesce
			// any number of background edits into one authoritative snapshot when
			// the panel becomes visible again instead of queueing offset-sensitive
			// incremental changes for an inactive renderer.
			this.needsFullSync = true;
			this.needsRehighlight = true;
			return;
		}

		const changes: TextChange[] = event.contentChanges.map((c) => ({
			from: offsetMap.toNormalizedOffset(c.rangeOffset),
			to: offsetMap.toNormalizedOffset(c.rangeOffset + c.rangeLength),
			insert: normalizeLineEndingsForWebview(c.text),
		}));
		const reconciled = applyNormalizedTextChanges(offsetMap.normalizedText, changes);
		const authoritative = createLineEndingMap(this.documentText).normalizedText;
		if (reconciled === undefined || reconciled !== authoritative) {
			// VS Code normally reports ranges against the pre-change snapshot. If a
			// provider reports an ambiguous CRLF-half edit or violates that contract,
			// a full snapshot is safer than forwarding a corrupt incremental patch.
			this.sendInit();
			this.scheduleRehighlight();
			return;
		}
		const update: HostToEditorMessage = { type: 'externalUpdate', changes, version: event.document.version };
		// An external paste/replace-all can exceed the incremental message limit.
		// Use the bounded document snapshot path instead of sending a patch the
		// renderer must reject, which would leave it permanently out of sync.
		if (validateHostToEditorMessage(update, offsetMap.normalizedText.length).ok) this.post(update);
		else this.sendInit();
		this.scheduleRehighlight();
	}

	private scheduleRehighlight(immediate = false) {
		const generation = ++this.rehighlightGeneration;
		if (this.rehighlightTimer) {
			clearTimeout(this.rehighlightTimer);
			this.rehighlightTimer = undefined;
		}
		if (this.disposed || this.closing || this.document.isClosed) return;
		if (!this.visible) {
			this.needsRehighlight = true;
			return;
		}
		const run = async () => {
			this.rehighlightTimer = undefined;
			if (this.disposed || this.closing || generation !== this.rehighlightGeneration) return;
			const document = this.document;
			const version = document.version;
			try {
				const rawText = document.getText();
				const blocks = await tokenizeDocument(document);
				// A palette change can launch a newer request without changing the
				// document version. Closed/recreated iframes must not receive old
				// results or keep rescheduling parsing after their session ends.
				if (this.disposed || this.closing || document.isClosed || document !== this.document || generation !== this.rehighlightGeneration) return;
				if (version !== document.version) {
					this.scheduleRehighlight();
					return;
				}
				const offsetMap = createLineEndingMap(rawText);
				const normalizedBlocks = blocks.map((block) => ({
					from: offsetMap.toNormalizedOffset(block.from),
					to: offsetMap.toNormalizedOffset(block.to),
					tokens: block.tokens.map((token) => ({
						...token,
						from: offsetMap.toNormalizedOffset(token.from),
						to: offsetMap.toNormalizedOffset(token.to),
					})),
				}));
				if (this.visible) this.post({ type: 'codeTokens', blocks: normalizedBlocks });
				else this.needsRehighlight = true;
			} catch {
				if (!this.disposed && !this.closing && generation === this.rehighlightGeneration) diagnosticEventRateLimited('editor.codeHighlightFailed');
			}
		};
		if (immediate) {
			void run();
		} else {
			this.rehighlightTimer = setTimeout(() => { void run(); }, REHIGHLIGHT_DEBOUNCE_MS);
		}
	}

	notifyCssChanged() {
		if (!this.visible) {
			this.pendingCss = true;
			return;
		}
		this.post({ type: 'applyCss', css: vscode.workspace.isTrusted ? this.getCss() : '' });
	}

	getDocument(): vscode.TextDocument {
		return this.document;
	}

	private async reopenClosedDocument(): Promise<boolean> {
		if (!this.document.isClosed) return false;
		const root = localWorkspaceVaultRoot(this.document.uri);
		if (!root || !await isCanonicalPathInside(root.fsPath, this.document.uri.fsPath)) throw new Error('Closed document is no longer inside the vault');
		this.document = await vscode.workspace.openTextDocument(this.document.uri);
		return true;
	}

	getWebview(): vscode.Webview {
		return this.webviewPanel.webview;
	}

	reloadWebview(html: string): void {
		this.rehighlightGeneration++;
		this.queuePendingDraftFlush();
		this.readyReceived = false;
		this.webviewPanel.webview.html = html;
	}

	jumpToLine(line: number): void {
		const deliver = this.pendingLineNavigation.request(
			line,
			this.document.lineCount,
			this.readyReceived && this.visible,
		);
		if (deliver === undefined) {
			// Opening a custom editor resolves before its webview necessarily sends
			// `ready`. Retain only the newest local-navigation target so a search or
			// Backlinks jump cannot be lost during startup, without creating a queue.
			return;
		}
		this.post({ type: 'jumpToLine', line: deliver });
	}

	private flushPendingJump(): void {
		const line = this.pendingLineNavigation.flush(this.readyReceived && this.visible);
		if (line === undefined) return;
		this.post({ type: 'jumpToLine', line });
	}

	notifyVaultNotesChanged(): void {
		if (!this.visible) {
			this.pendingVaultNotes = true;
			return;
		}
		this.scheduleVaultNotesSync();
	}

	private scheduleVaultNotesSync(): void {
		const generation = ++this.vaultNotesGeneration;
		if (!this.visible) {
			this.pendingVaultNotes = true;
			return;
		}
		setTimeout(() => {
			if (this.disposed || !this.visible || generation !== this.vaultNotesGeneration) return;
			const notes = this.getVaultNotes().slice(0, 10_000);
			let offset = 0;
			const chunks = chunkVaultNoteSummaries(notes, generation);
			let chunkIndex = 0;
			const sendNext = () => {
				if (this.disposed || !this.visible || generation !== this.vaultNotesGeneration) return;
				const chunk = chunks[chunkIndex++];
				if (!chunk) return;
				this.post({ type: 'vaultNotesChunk', generation, offset, total: notes.length, notes: chunk });
				offset += chunk.length;
				if (chunkIndex < chunks.length) setTimeout(sendNext, 0);
			};
			sendNext();
		}, 0);
	}

	setVisible(visible: boolean): void {
		if (visible === this.visible) return;
		this.visible = visible;
		if (this.readyReceived) this.post({ type: 'panelVisibility', visible });
		if (!visible) {
			this.rehighlightGeneration++;
			this.queuePendingDraftFlush();
			// Editable contexts survive hiding so in-transit edits can still arrive.
			// Keep their completed handshake: a retained iframe does not send ready
			// again when shown. Only reloadWebview resets the handshake.
			this.vaultNotesGeneration++;
			if (this.rehighlightTimer) {
				clearTimeout(this.rehighlightTimer);
				this.rehighlightTimer = undefined;
				this.needsRehighlight = true;
			}
			return;
		}
		if (!this.readyReceived) return;
		if (this.needsFullSync) {
			this.needsFullSync = false;
			this.pendingCss = false;
			this.pendingVaultNotes = false;
			this.sendInit();
		} else {
			if (this.pendingCss) {
				this.pendingCss = false;
				this.notifyCssChanged();
			}
			if (this.pendingVaultNotes) {
				this.pendingVaultNotes = false;
				this.notifyVaultNotesChanged();
			}
		}
		if (this.needsRehighlight) {
			this.needsRehighlight = false;
			this.scheduleRehighlight(true);
		}
		this.flushPendingJump();
	}

	async flushPendingSaves(): Promise<void> {
		this.queuePendingDraftFlush();
		await this.mutationQueue.drain();
		await this.flushPendingDraft();
		await this.settleAutoSave?.();
	}

	dispose(): Promise<void> {
		if (this.closeOperation) return this.closeOperation;
		this.closing = true;
		this.rehighlightGeneration++;
		this.queuePendingDraftFlush();
		if (this.drawioRefreshTimer) clearTimeout(this.drawioRefreshTimer);
		this.vaultNotesGeneration++;
		if (this.rehighlightTimer) {
			clearTimeout(this.rehighlightTimer);
		}
		this.disposables.forEach((d) => d.dispose());
		// Already-received edits/checkpoints remain authorized for this document.
		// Closing a clean tab must not cancel its final queued keystrokes.
		this.closeOperation = this.mutationQueue.drain().then(() => this.flushPendingDraft()).finally(() => { this.disposed = true; });
		return this.closeOperation;
	}
}
