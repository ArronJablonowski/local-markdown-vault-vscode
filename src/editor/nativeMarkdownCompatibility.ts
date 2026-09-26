import * as vscode from 'vscode';
import { isCanonicalPathInside } from './canonicalContainment';
import { localWorkspaceVaultRoot } from './workspaceVault';
import { isEditorDocumentWithinLimit, MAX_EDITOR_DOCUMENT_BYTES } from '../shared/messageValidation';

const UNSAFE_NATIVE_EDITOR = 'vscode.markdown.editor';
const SAFE_LIVE_PREVIEW = 'mdLivePreview.editor';
const MAX_CONCURRENT_HANDOFFS = 4;

/** Any native view of the same working copy can be invalidated by a save. */
export function hasUnsafeNativeMarkdownTab(uri: vscode.Uri): boolean {
	return vscode.window.tabGroups.all.some(group => group.tabs.some(tab => {
		const input = tab.input;
		return input instanceof vscode.TabInputCustom && input.viewType === UNSAFE_NATIVE_EDITOR && input.uri.toString() === uri.toString();
	}));
}

/**
 * The bundled native editor invalidates in-flight typing on dirty-only save
 * events. Route only authorized local vault documents through VS Code's normal
 * editor open. Never close a native tab, rewrite a document, or change
 * another extension's files/settings to work around that upstream behavior.
 */
export function registerNativeMarkdownCompatibility(): vscode.Disposable {
	// Opening a companion raises tab events; remember attempts to prevent a handoff loop.
	const attempted = new WeakMap<vscode.Tab, string>();
	let disposed = false;
	let scanQueued = false;
	let handoffs = 0;
	let warned = false;
	const stillNative = (tab: vscode.Tab, uri: vscode.Uri) => !disposed && vscode.window.tabGroups.all.some(group => group.tabs.includes(tab)) &&
		tab.input instanceof vscode.TabInputCustom && tab.input.viewType === UNSAFE_NATIVE_EDITOR && tab.input.uri.toString() === uri.toString();

	const handoff = async (tab: vscode.Tab, group: vscode.TabGroup, uri: vscode.Uri) => {
		try {
			const root = localWorkspaceVaultRoot(uri);
			if (!root || !await isCanonicalPathInside(root.fsPath, uri.fsPath) || !stillNative(tab, uri)) return;
			const document = vscode.workspace.textDocuments.find(item => item.uri.toString() === uri.toString()) ?? await vscode.workspace.openTextDocument(uri);
			if (document.isClosed || document.languageId !== 'markdown') return;
			const lastLine = document.lineAt(document.lineCount - 1);
			if (document.offsetAt(lastLine.rangeIncludingLineBreak.end) > MAX_EDITOR_DOCUMENT_BYTES || !isEditorDocumentWithinLimit(document.getText())) return;
			// The path, workspace, and tab may all change during authorization.
			if (!stillNative(tab, uri) || localWorkspaceVaultRoot(uri)?.toString() !== root.toString() || !await isCanonicalPathInside(root.fsPath, uri.fsPath) || !stillNative(tab, uri)) return;
			const sourceEditor = vscode.window.visibleTextEditors.find(editor => editor.document === document && editor.viewColumn === group.viewColumn);
			await vscode.commands.executeCommand('vscode.openWith', uri, SAFE_LIVE_PREVIEW, {
				viewColumn: group.viewColumn,
				preserveFocus: !group.isActive || !tab.isActive,
				// A preview open could implicitly replace/close the native preview
				// tab. Pin only this exceptional compatibility companion instead.
				preview: false,
				...(sourceEditor ? { selection: sourceEditor.selection } : {}),
			});
			// Closing even a currently clean native tab can revert a shared working
			// copy if a keystroke arrives while the asynchronous close is pending.
			// Keep ALL native tabs, not just dirty ones; there is no safe public
			// atomic replace-editor API. Normal configured opens go directly to
			// Live Preview and do not create this exceptional extra tab.
			if (!warned) {
				warned = true;
				void vscode.window.showWarningMessage(vscode.l10n.t('Markdown Live Preview was opened to avoid a VS Code native-editor typing-loss issue. Original native tabs are kept: verify and save your changes, then close those tabs manually. Automatic saving stays paused for a file until all its native Markdown Editor tabs are closed.'));
			}
		} catch {
			if (!disposed) void vscode.window.showErrorMessage(vscode.l10n.t('The native Markdown Editor could not be switched safely. Keep the document open and choose Markdown Live Preview or Text Editor. Automatic saving is paused while the native Markdown Editor remains open.'));
		} finally {
			handoffs--;
			queueScan();
		}
	};
	const queueScan = () => {
		if (disposed || scanQueued) return;
		scanQueued = true;
		queueMicrotask(() => {
			scanQueued = false;
			if (disposed) return;
			for (const group of vscode.window.tabGroups.all) for (const tab of group.tabs) {
				if (handoffs >= MAX_CONCURRENT_HANDOFFS) return;
				const input = tab.input;
				if (!(input instanceof vscode.TabInputCustom) || input.viewType !== UNSAFE_NATIVE_EDITOR) { attempted.delete(tab); continue; }
				if (attempted.get(tab) === input.uri.toString()) continue;
				attempted.set(tab, input.uri.toString());
				if (input.uri.scheme !== 'file' || !localWorkspaceVaultRoot(input.uri)) continue;
				handoffs++;
				void handoff(tab, group, input.uri);
			}
		});
	};
	const subscriptions = [vscode.window.tabGroups.onDidChangeTabs(queueScan), vscode.window.tabGroups.onDidChangeTabGroups(queueScan)];
	queueScan();
	return new vscode.Disposable(() => { disposed = true; for (const subscription of subscriptions) subscription.dispose(); });
}
