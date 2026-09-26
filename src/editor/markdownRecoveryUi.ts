import * as vscode from 'vscode';
import { basename } from 'node:path';
import type { MarkdownRecoveryEntry, MarkdownRecoveryStore } from './markdownRecoveryStore';

export interface EmergencyMarkdownRecovery {
	list(): readonly MarkdownRecoveryEntry[];
	open(id: string): Promise<void>;
}

/** Recovery is opened as a new, unsaved document; it never overwrites a note. */
export function registerMarkdownRecovery(store?: MarkdownRecoveryStore, emergency?: EmergencyMarkdownRecovery): vscode.Disposable {
	return vscode.commands.registerCommand('mdLivePreview.openRecoveredDrafts', async () => {
		if (!store && !emergency?.list().length) {
			void vscode.window.showErrorMessage(vscode.l10n.t('Markdown recovery storage is unavailable. Existing data has not been overwritten.'));
			return;
		}
		if (!store?.list().length && !emergency?.list().length) {
			void vscode.window.showInformationMessage(vscode.l10n.t('There are no recovered Markdown drafts in this workspace.'));
			return;
		}
		type Item = vscode.QuickPickItem & { entry: MarkdownRecoveryEntry; emergency?: boolean };
		const picker = vscode.window.createQuickPick<Item>();
		picker.title = vscode.l10n.t('Recovered Markdown Drafts');
		picker.placeholder = vscode.l10n.t('Open a draft as an unsaved copy. Recovery copies remain until you delete them.');
		const refresh = () => {
			// Memory-only drafts come first because closing VS Code would discard them.
			picker.items = [...(emergency?.list() ?? []).map(entry => ({
				label: basename(vscode.Uri.parse(entry.sourceUri).path),
				description: vscode.l10n.t('Emergency copy — memory only; Save As now'),
				detail: entry.sourceUri, entry, emergency: true,
			})), ...(store?.list() ?? []).map(entry => ({
				label: basename(vscode.Uri.parse(entry.sourceUri).path),
				description: new Date(entry.createdAt).toLocaleString('en-US'),
				detail: entry.sourceUri,
				entry,
				buttons: [{ iconPath: new vscode.ThemeIcon('trash'), tooltip: vscode.l10n.t('Delete recovery copy') }],
			}))];
		};
		const subscriptions = [
			picker.onDidAccept(() => {
				const item = picker.selectedItems[0];
				if (!item) return;
				picker.hide();
				if (item.emergency) {
					void emergency?.open(item.entry.id).catch(() => {}); // The emergency owner reports failures and retains the draft.
					return;
				}
				void vscode.workspace.openTextDocument({ language: 'markdown', content: item.entry.text })
					.then(document => vscode.window.showTextDocument(document, { preview: false }))
					.then(undefined, () => vscode.window.showErrorMessage(vscode.l10n.t('The recovery copy could not be opened. It is still stored locally.')));
			}),
			picker.onDidTriggerItemButton(async ({ item }) => {
				if (item.emergency || !store) return;
				const remove = vscode.l10n.t('Delete recovery copy');
				if (await vscode.window.showWarningMessage(vscode.l10n.t('Permanently delete this recovery copy? The original Markdown file will not be changed.'), { modal: true }, remove) !== remove) return;
				try { await store.remove(item.entry.id); refresh(); }
				catch { void vscode.window.showErrorMessage(vscode.l10n.t('The recovery copy could not be deleted.')); }
			}),
			picker.onDidHide(() => { for (const subscription of subscriptions) subscription.dispose(); picker.dispose(); }),
		];
		refresh();
		picker.show();
	});
}
