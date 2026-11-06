import * as vscode from 'vscode';
import { createCspNonce } from '../shared/cspNonce';
import { escapeAttribute } from '../shared/i18n';
import { CSV_LIMITS } from '../shared/csv';
import { CSV_VIEW_BODY } from '../shared/csvView';

/** Read-only projection of VS Code's text buffer; no file writes or resource loads. */
export class CsvTableProvider implements vscode.CustomTextEditorProvider {
	static readonly viewType = 'mdLivePreview.csv';
	constructor(private readonly context: vscode.ExtensionContext) {}
	resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
		const webview = panel.webview;
		webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist'), vscode.Uri.joinPath(this.context.extensionUri, 'media')] };
		let ready = false, disposed = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const publish = () => {
			if (!ready || disposed) return;
			if (document.uri.scheme !== 'file') { void webview.postMessage({ type: 'error', message: 'CSV Table supports local files only.' }); return; }
			// Preflight offsets before allocating the full text; allow for CRLF mapping.
			if (document.offsetAt(document.positionAt(CSV_LIMITS.characters + 2)) > CSV_LIMITS.characters) {
				void webview.postMessage({ type: 'error', message: 'CSV exceeds the 5 MiB character limit. Use Open Text to inspect it.' }); return;
			}
			const text = document.getText();
			void webview.postMessage(text.length > CSV_LIMITS.characters ? { type: 'error', message: 'CSV exceeds the 5 MiB character limit. Use Open Text to inspect it.' }
					: { type: 'csv', text });
		};
		const messages = webview.onDidReceiveMessage((message: unknown) => {
			// Commands carry no paths, cell values, or other untrusted arguments.
			if (!message || typeof message !== 'object' || Array.isArray(message) || Object.keys(message).length !== 1) return;
			const type = (message as { type?: unknown }).type;
			if (type === 'ready' && !ready) { ready = true; publish(); }
			// VS Code can recreate a hidden webview without resolving its provider again.
			else if (type === 'ready') { clearTimeout(timer); timer = setTimeout(publish, 100); }
			else if (type === 'openSource') void vscode.commands.executeCommand('vscode.openWith', document.uri, 'default', { viewColumn: panel.viewColumn });
		});
		const changes = vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document !== document) return;
			// Coalesce rapid edits in a separate Text Editor without queuing snapshots.
			clearTimeout(timer); timer = setTimeout(publish, 100);
		});
		panel.onDidDispose(() => { disposed = true; clearTimeout(timer); messages.dispose(); changes.dispose(); });
		const nonce = createCspNonce();
		const script = escapeAttribute(webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview-csv.js')).toString());
		const css = escapeAttribute(webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview-csv.css')).toString());
		webview.html = `<!DOCTYPE html><html lang="en-US"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<title>CSV Table</title><link rel="stylesheet" href="${css}"></head><body>
${CSV_VIEW_BODY}
<script nonce="${nonce}" src="${script}"></script></body></html>`;
	}
}
