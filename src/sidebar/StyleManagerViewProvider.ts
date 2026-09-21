import * as vscode from 'vscode';
import type { CodeThemeSetting, DefaultEditorSetting, EditingModeSetting, HostToSidebarMessage, SidebarSettings, SidebarToHostMessage, ThemeKind } from '../shared/messages';
import { StyleStore } from './styleStore';
import { StylePreviewController } from './StylePreviewController';
import { escapeAttribute } from '../shared/i18n';
import { validateSidebarToHostMessage } from '../shared/auxMessageValidation';
import { createCspNonce } from '../shared/cspNonce';
import { diagnosticEventRateLimited } from '../diagnostics';

const CONFIG_SECTION = 'mdLivePreview';

export class StyleManagerViewProvider implements vscode.WebviewViewProvider {
	static readonly viewType = 'mdLivePreview.styleManager';

	private view: vscode.WebviewView | undefined;
	private readonly preview: StylePreviewController;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly styleStore: StyleStore,
	) {
		this.preview = new StylePreviewController(context, styleStore);
		this.styleStore.onDidChange(() => void this.pushStyles());
		// Re-push when the surfaced settings change or the color theme flips, so the
		// settings controls and the preview thumbnails' light/dark rendering stay current.
		this.context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (
					e.affectsConfiguration(`${CONFIG_SECTION}.defaultEditor`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.defaultEditingMode`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.codeTheme`)
				) {
					void this.pushStyles();
				}
			}),
			vscode.window.onDidChangeActiveColorTheme(() => void this.pushStyles()),
		);
	}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
				vscode.Uri.joinPath(this.context.extensionUri, 'media'),
			],
		};
		webviewView.webview.html = this.buildHtml(webviewView.webview);
		webviewView.webview.onDidReceiveMessage((raw: unknown) => {
			const parsed = validateSidebarToHostMessage(raw);
			if (!parsed.ok) {
				diagnosticEventRateLimited('protocol.sidebarMessageRejected', { reason: parsed.reason });
				return;
			}
			void this.handleMessage(parsed.value);
		});
		webviewView.onDidDispose(() => {
			if (this.view === webviewView) {
				this.view = undefined;
			}
		});
	}

	async createNewStyle(): Promise<vscode.Uri | undefined> {
		if (!vscode.workspace.isTrusted) return undefined;
		const uri = await this.styleStore.createNewStyle();
		if (!uri) {
			void vscode.window.showWarningMessage(vscode.l10n.t('At most 1,000 CSS themes can be stored.'));
			return undefined;
		}
		// Open the new file with the live preview beside it, same as the edit action.
		const name = uri.path.split('/').pop() ?? '';
		await this.preview.open(name, name);
		return uri;
	}

	private async handleMessage(message: SidebarToHostMessage): Promise<void> {
		if (!vscode.workspace.isTrusted && message.type !== 'ready' && message.type !== 'setSetting') {
			diagnosticEventRateLimited('protocol.restrictedMutationRejected', { surface: 'sidebar' });
			return;
		}
		switch (message.type) {
			case 'ready':
				await this.pushStyles();
				break;
			case 'toggle':
				await this.styleStore.setEnabled(message.id, message.enabled);
				break;
			case 'newStyle':
				await this.createNewStyle();
				break;
			case 'openStyle':
				// Open the CSS on the left and a live preview beside it on the right.
				await this.preview.open(message.id, message.id);
				break;
			case 'duplicateStyle':
				await this.styleStore.duplicateStyle(message.id);
				break;
			case 'renameStyle':
				await this.renameStyle(message.id);
				break;
			case 'deleteStyle':
				await this.styleStore.deleteStyle(message.id);
				break;
			case 'setSetting':
				await vscode.workspace
					.getConfiguration(CONFIG_SECTION)
					.update(message.key, message.value, vscode.ConfigurationTarget.Global);
				break;
		}
	}

	private async renameStyle(id: string): Promise<void> {
		const current = id.replace(/\.css$/i, '');
		const input = await vscode.window.showInputBox({
			title: vscode.l10n.t('Rename style'),
			value: current,
			prompt: vscode.l10n.t('New name (.css is added automatically)'),
			validateInput: (v) => (v.trim().length === 0 ? vscode.l10n.t('Enter a name') : undefined),
		});
		if (input === undefined || !vscode.workspace.isTrusted) return; // canceled or trust changed
		try {
			await this.styleStore.renameStyle(id, input);
		} catch {
			await vscode.window.showErrorMessage(vscode.l10n.t('Could not rename to "{0}" — a style with that name already exists.', input));
		}
	}

	private getSettings(): SidebarSettings {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		const defaultEditor = config.get<string>('defaultEditor', 'prompt');
		const defaultEditingMode = config.get<string>('defaultEditingMode', 'editing');
		const codeTheme = config.get<string>('codeTheme', 'auto');
		return {
			defaultEditor: (['prompt', 'livePreview', 'default'].includes(defaultEditor) ? defaultEditor : 'prompt') as DefaultEditorSetting,
			defaultEditingMode: (['editing', 'locked'].includes(defaultEditingMode) ? defaultEditingMode : 'editing') as EditingModeSetting,
			codeTheme: (['auto', 'dark-plus', 'light-plus', 'github-dark', 'github-light'].includes(codeTheme) ? codeTheme : 'auto') as CodeThemeSetting,
		};
	}

	private getThemeKind(): ThemeKind {
		switch (vscode.window.activeColorTheme.kind) {
			case vscode.ColorThemeKind.Light:
				return 'vscode-light';
			case vscode.ColorThemeKind.HighContrast:
			case vscode.ColorThemeKind.HighContrastLight:
				return 'vscode-high-contrast';
			default:
				return 'vscode-dark';
		}
	}

	private async pushStyles(): Promise<void> {
		if (!this.view) return;
		const trustedAtStart = vscode.workspace.isTrusted;
		const loadedStyles = trustedAtStart ? await this.styleStore.listEntries() : [];
		const workspaceTrusted = trustedAtStart && vscode.workspace.isTrusted;
		const styles = workspaceTrusted ? loadedStyles : [];
		const msg: HostToSidebarMessage = {
			type: 'init',
			styles,
			settings: this.getSettings(),
			themeKind: this.getThemeKind(),
			workspaceTrusted,
		};
		void this.view.webview.postMessage(msg);
	}

	refreshSecurityPolicy(): void {
		void this.pushStyles();
		this.preview.refreshSecurityPolicy();
	}

	private buildHtml(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview-sidebar.js'),
		);
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview-sidebar-style.css'),
		);
		const nonce = createCspNonce();
		const documentTitle = vscode.l10n.t('CSS Themes');

		return `<!DOCTYPE html>
<html lang="en-US">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
	<link rel="stylesheet" href="${styleUri}" />
	<title>${escapeAttribute(documentTitle)}</title>
</head>
<body>
	<div id="mlp-sidebar-root"></div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}
