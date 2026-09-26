import * as vscode from 'vscode';
import { DocumentSyncSession } from './documentSync';
import { extractHeadings } from '../shared/headings';
import type { HeadingItem } from '../shared/headings';
import { escapeAttribute } from '../shared/i18n';
import type { RemoteMediaPolicy, VaultNoteSummary } from '../shared/messages';
import { resolveWorkspaceRemoteMediaPolicy } from '../shared/securitySettings';
import { isEditorDocumentWithinLimit } from '../shared/messageValidation';
import { createCspNonce } from '../shared/cspNonce';
import { MarkdownAutoSaveController } from './markdownAutoSave';
import { MarkdownRecoveryStore } from './markdownRecoveryStore';
import { registerMarkdownRecovery } from './markdownRecoveryUi';
import { MarkdownDraftPreserver } from './markdownDraftPreserver';

function remoteMediaPolicy(resource: vscode.Uri): RemoteMediaPolicy {
	const inspected = vscode.workspace
		.getConfiguration('mdLivePreview', resource)
		.inspect<RemoteMediaPolicy>('remoteMedia');
	return resolveWorkspaceRemoteMediaPolicy(vscode.workspace.isTrusted, inspected);
}

export class MarkdownLivePreviewProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
	static readonly viewType = 'mdLivePreview.editor';

	private readonly sessions = new Set<DocumentSyncSession>();
	// Closing panels leave the visible session set before their final writes settle.
	private readonly closingSaves = new Set<Promise<void>>();
	private readonly autoSave = new MarkdownAutoSaveController();
	private readonly recovery?: MarkdownRecoveryStore;
	private readonly draftPreserver: MarkdownDraftPreserver;

	private constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly getCss: () => string,
		private readonly getVaultNotes: () => VaultNoteSummary[],
	) {
		try { this.recovery = new MarkdownRecoveryStore(context.workspaceState); }
		catch {
			void vscode.window.showErrorMessage(vscode.l10n.t('Existing Markdown recovery data could not be loaded. It has not been overwritten. Save open drafts manually before closing VS Code.'));
		}
		this.draftPreserver = new MarkdownDraftPreserver(this.recovery);
		context.subscriptions.push(registerMarkdownRecovery(this.recovery, this.draftPreserver));
	}

	static register(
		context: vscode.ExtensionContext,
		getCss: () => string,
		getVaultNotes: () => VaultNoteSummary[],
	): { disposable: vscode.Disposable; provider: MarkdownLivePreviewProvider } {
		const provider = new MarkdownLivePreviewProvider(context, getCss, getVaultNotes);
		const registration = vscode.window.registerCustomEditorProvider(MarkdownLivePreviewProvider.viewType, provider, {
			// Keep editable contexts alive across tab switches: destroying an iframe
			// can discard its last edit and recovery messages before VS Code receives
			// them, even when both are posted synchronously. This deliberately trades
			// per-open-tab memory for draft safety. Hidden expensive work is suspended
			// separately; CSP, input limits, and policy-triggered reloads still apply.
			webviewOptions: { retainContextWhenHidden: true },
			supportsMultipleEditorsPerDocument: true,
		});
		const disposable = vscode.Disposable.from(registration, provider);
		return { disposable, provider };
	}

	resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): void {
		const documentWithinLimit = isEditorDocumentWithinLimit(document.getText());
		const localContentRoots = [
			vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
			vscode.Uri.joinPath(this.context.extensionUri, 'media'),
		];
		webviewPanel.webview.options = {
			enableScripts: documentWithinLimit,
			// Vault files are never resource roots. Specific image bytes, note embeds,
			// and diagrams cross validated host message boundaries instead.
			localResourceRoots: localContentRoots,
		};
		if (!documentWithinLimit) {
			webviewPanel.webview.html = this.buildDocumentLimitHtml(webviewPanel.webview);
			return;
		}
		webviewPanel.webview.html = this.buildHtml(webviewPanel.webview, remoteMediaPolicy(document.uri));
		const autoSaveTracking = this.autoSave.track(document);

		const session: DocumentSyncSession = new DocumentSyncSession(
			document,
			webviewPanel,
			this.getCss,
			this.getVaultNotes,
			(uri, line) => this.jumpToDocument(uri, line),
			() => this.autoSave.flush(session.getDocument()),
			(text) => this.draftPreserver.preserve(document.uri.toString(), text),
			async () => {
				try {
					await this.autoSave.flush(session.getDocument());
					const current = session.getDocument();
					// This is an explicit user Save, not a background write. VS Code
					// retains its normal participants, conflict checks, and prompts.
					if (current.isDirty && (current.isClosed || !(await current.save()) || current.isDirty)) throw new Error('Save incomplete');
				} catch {
					void vscode.window.showErrorMessage(vscode.l10n.t('Markdown could not be saved. Keep this document open and save a copy.'));
				}
			},
		);
		this.sessions.add(session);

		webviewPanel.onDidDispose(() => {
			const closing = session.dispose();
			this.closingSaves.add(closing);
			void closing.finally(() => { autoSaveTracking.dispose(); this.closingSaves.delete(closing); });
			this.sessions.delete(session);
		});
	}

	async flushPendingSaves(): Promise<void> {
		await Promise.all([...this.sessions].map(session => session.flushPendingSaves()));
		await Promise.all(this.closingSaves);
		await Promise.all(vscode.workspace.textDocuments.filter(document => document.languageId === 'markdown').map(document => this.autoSave.flush(document)));
	}

	dispose(): void {
		for (const session of this.sessions) this.closingSaves.add(session.dispose());
		this.sessions.clear();
		void Promise.all(this.closingSaves).finally(() => this.autoSave.dispose());
	}

	/** Called when the enabled CSS snippet set changes, to hot-reload every open panel. */
	broadcastCssChanged(): void {
		for (const session of this.sessions) {
			session.notifyCssChanged();
		}
	}

	broadcastVaultNotesChanged(): void {
		for (const session of this.sessions) session.notifyVaultNotesChanged();
	}

	/** Rebuilds each CSP and re-initializes its webview after a trust/network policy change. */
	reloadSecurityPolicy(): void {
		for (const session of this.sessions) {
			session.reloadWebview(this.buildHtml(
				session.getWebview(),
				remoteMediaPolicy(session.getDocument().uri),
			));
		}
	}

	/**
	 * Finds the session for the currently active Markdown Live Preview editor
	 * tab, matched by tab viewType and URI — the same tab-lookup pattern
	 * `extension.ts` already uses for the "open with source" command, rather
	 * than tracking webview panel focus separately.
	 */
	private findActiveSession(): DocumentSyncSession | undefined {
		const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		if (!(input instanceof vscode.TabInputCustom) || input.viewType !== MarkdownLivePreviewProvider.viewType) {
			return undefined;
		}
		const uriKey = input.uri.toString();
		for (const session of this.sessions) {
			if (session.getDocument().uri.toString() === uriKey) return session;
		}
		return undefined;
	}

	/** Headings of the currently active Markdown Live Preview document, or `undefined` if none is active. */
	getActiveHeadings(): HeadingItem[] | undefined {
		const session = this.findActiveSession();
		return session ? extractHeadings(session.getDocument().getText()) : undefined;
	}

	/** Asks the currently active Markdown Live Preview panel to move its cursor to the given line. */
	jumpToActiveHeading(line: number): void {
		this.findActiveSession()?.jumpToLine(line);
	}

	/** Reveals a line in an already-open Live Preview target after local navigation. */
	jumpToDocument(uri: vscode.Uri, line: number): boolean {
		let found = false;
		for (const session of this.sessions) {
			if (session.getDocument().uri.toString() !== uri.toString()) continue;
			session.jumpToLine(line);
			found = true;
		}
		return found;
	}

	private buildHtml(webview: vscode.Webview, remoteMedia: RemoteMediaPolicy): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview-editor.js'),
		);
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview-editor-theme.css'),
		);
		// Mermaid ships as its own bundle, loaded only once a document actually
		// contains a diagram (see webview-editor/mermaidLoader.ts). The webview
		// can't build this URI itself — `asWebviewUri` is host-side API — so it's
		// handed over here, along with the nonce the loader must stamp on the
		// <script> tag to satisfy the CSP below.
		const mermaidChunkUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'mermaid-chunk.js'),
		);
		// The AWS shape table is data, not code, so the webview fetches it rather
		// than loading it as a script — but it still cannot build the URI itself.
		const awsShapesUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'aws4-shapes.json'),
		);
		const nonce = createCspNonce();
		const remoteImageSource = remoteMedia === 'https' ? ' https:' : '';
		const documentTitle = vscode.l10n.t('Markdown Live Preview');

		// CodeMirror measures and styles elements inline; scripts still require a fresh nonce.
		return `<!DOCTYPE html>
<html lang="en-US">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} blob:${remoteImageSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${webview.cspSource};" />
	<link rel="stylesheet" href="${styleUri}" />
	<title>${escapeAttribute(documentTitle)}</title>
</head>
<body>
	<div id="mlp-root" data-mermaid-uri="${escapeAttribute(mermaidChunkUri.toString())}" data-aws-shapes-uri="${escapeAttribute(awsShapesUri.toString())}" data-script-nonce="${escapeAttribute(nonce)}"></div>
		<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}

	private buildDocumentLimitHtml(webview: vscode.Webview): string {
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview-editor-theme.css'),
		);
		const title = vscode.l10n.t('Document too large for Live Preview');
		const explanation = vscode.l10n.t('Markdown Live Preview is limited to documents no larger than 20 MiB.');
		const action = vscode.l10n.t('Use Open Source in the editor toolbar to edit this file as plain Markdown.');
		return `<!DOCTYPE html>
<html lang="en-US">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource};" />
	<link rel="stylesheet" href="${styleUri}" />
	<title>${escapeAttribute(title)}</title>
</head>
<body>
	<main class="mlp-document-limit" role="status">
		<h1>${escapeAttribute(title)}</h1>
		<p>${escapeAttribute(explanation)}</p>
		<p>${escapeAttribute(action)}</p>
	</main>
</body>
</html>`;
	}
}
