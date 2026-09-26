import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { isEditorDocumentWithinLimit } from '../shared/messageValidation';
import { MAX_MARKDOWN_RECOVERY_ENTRIES, MAX_MARKDOWN_RECOVERY_STORAGE_BYTES, type MarkdownRecoveryEntry, type MarkdownRecoveryStore } from './markdownRecoveryStore';

interface EmergencyDraft {
	readonly entry: MarkdownRecoveryEntry;
	readonly bytes: number;
	document?: vscode.TextDocument;
	opening?: Promise<void>;
}

/** Provider-owned emergency drafts outlive a closing webview. RAM is not durable storage. */
export class MarkdownDraftPreserver {
	private readonly emergency = new Map<string, EmergencyDraft>();
	private emergencyBytes = 0;
	private openingCount = 0;
	private readonly nativeCopies: { sourceUri: string; document: vscode.TextDocument }[] = [];

	constructor(private readonly store?: MarkdownRecoveryStore) {}

	list(): readonly MarkdownRecoveryEntry[] {
		return Object.freeze([...this.emergency.values()].map(draft => draft.entry));
	}

	async preserve(sourceUri: string, text: string): Promise<void> {
		// Both values are host supplied, but validate them before retaining memory
		// or creating a native buffer. The source URI is metadata, never a target.
		if (!isEditorDocumentWithinLimit(text) || sourceUri.length > 8192 || /[\u0000-\u0020\u007f]/u.test(sourceUri)) throw new Error('Invalid emergency Markdown draft.');
		try { new URL(sourceUri); } catch { throw new Error('Invalid emergency Markdown source URI.'); }
		try {
			if (!this.store) throw new Error('Recovery storage is unavailable.');
			await this.store.preserve(sourceUri, text);
			for (const draft of this.emergency.values()) {
				if (draft.entry.sourceUri === sourceUri && draft.entry.text === text) this.removeEmergency(draft);
			}
			const open = vscode.l10n.t('Open Recovered Drafts');
			void vscode.window.showWarningMessage(vscode.l10n.t('A Markdown draft was preserved locally because it could not safely replace the original file.'), open).then(choice => {
				if (choice === open) void vscode.commands.executeCommand('mdLivePreview.openRecoveredDrafts');
			});
			return;
		} catch {
			// A full/corrupt/unwritable recovery store must not discard a draft
			// merely because its original editor is closing.
		}
		let draft = [...this.emergency.values()].find(item => item.entry.sourceUri === sourceUri && item.entry.text === text);
		if (!draft) {
			const bytes = Buffer.byteLength(text, 'utf8');
			const existingNative = this.nativeCopies.find(item => item.sourceUri === sourceUri && !item.document.isClosed && item.document.getText() === text);
			draft = { entry: Object.freeze({ id: randomUUID(), sourceUri, text, createdAt: Date.now() }), bytes, document: existingNative?.document };
			if (this.emergency.size < MAX_MARKDOWN_RECOVERY_ENTRIES && this.emergencyBytes + bytes <= MAX_MARKDOWN_RECOVERY_STORAGE_BYTES) {
				this.emergency.set(draft.entry.id, draft);
				this.emergencyBytes += bytes;
			}
			// Even at the RAM limit, still try the native editor. Do not silently
			// evict an older distinct draft to admit a new one.
		}
		await this.openDraft(draft);
	}

	async open(id: string): Promise<void> {
		const draft = this.emergency.get(id);
		if (!draft) throw new Error('Emergency Markdown draft not found.');
		await this.openDraft(draft);
	}

	private openDraft(draft: EmergencyDraft): Promise<void> {
		// Checkpoint and close can request the same draft before its native editor opens.
		if (draft.opening) return draft.opening;
		if (this.openingCount >= MAX_MARKDOWN_RECOVERY_ENTRIES) {
			this.warnFailure(draft);
			return Promise.reject(new Error('Emergency Markdown editor queue is full.'));
		}
		this.openingCount++;
		const opening = Promise.resolve().then(async () => {
			try {
				if (!draft.document || draft.document.isClosed || draft.document.getText() !== draft.entry.text) {
					draft.document = await vscode.workspace.openTextDocument({ language: 'markdown', content: draft.entry.text });
				}
				await vscode.window.showTextDocument(draft.document, { preview: false });
				if (draft.document.isClosed || draft.document.getText() !== draft.entry.text) throw new Error('The native recovery copy changed before it was shown.');
				this.removeEmergency(draft);
				// Remember only bounded native-document identities, not additional
				// text snapshots, so checkpoint/close repeats reuse the same copy.
				const remembered = this.nativeCopies.findIndex(item => item.document === draft.document);
				if (remembered >= 0) this.nativeCopies.splice(remembered, 1);
				this.nativeCopies.push({ sourceUri: draft.entry.sourceUri, document: draft.document });
				if (this.nativeCopies.length > MAX_MARKDOWN_RECOVERY_ENTRIES) this.nativeCopies.shift();
				void vscode.window.showWarningMessage(vscode.l10n.t('Local Markdown recovery storage is unavailable or full. Your exact draft was opened as an unsaved Markdown copy. Use Save As now and keep it open until saved.'));
			} catch {
				this.warnFailure(draft);
				// Do not acknowledge RAM-only retention: the webview must keep its
				// own pending state too. Native documents opened before a reveal
				// failure also remain available for a later retry.
				throw new Error('The Markdown draft still needs to be saved as a copy.');
			} finally {
				this.openingCount--;
				draft.opening = undefined;
			}
		});
		draft.opening = opening;
		return opening;
	}

	private removeEmergency(draft: EmergencyDraft): void {
		if (this.emergency.delete(draft.entry.id)) this.emergencyBytes -= draft.bytes;
	}

	private warnFailure(draft: EmergencyDraft): void {
		if (this.emergency.has(draft.entry.id)) {
			const open = vscode.l10n.t('Open Recovered Drafts');
			void vscode.window.showErrorMessage(vscode.l10n.t('The Markdown draft could not be saved or shown. An emergency copy is held only in memory. Do not close VS Code; use Open Recovered Drafts and Save As.'), open).then(choice => {
				if (choice === open) void vscode.commands.executeCommand('mdLivePreview.openRecoveredDrafts');
			});
		} else {
			void vscode.window.showErrorMessage(vscode.l10n.t('Markdown recovery storage, the native editor, and the emergency recovery buffer are unavailable or full. This draft could not be preserved. Keep the original editor and VS Code open, and copy the text to a safe location immediately.'));
		}
	}
}
