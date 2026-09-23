import * as vscode from 'vscode';
import { diagnosticEventRateLimited } from '../diagnostics';
import { isEditorDocumentWithinLimit, MAX_EDITOR_DOCUMENT_BYTES } from '../shared/messageValidation';
import { isCanonicalPathInside } from './canonicalContainment';
import { localWorkspaceVaultRoot } from './workspaceVault';

// Yield only until VS Code has finished publishing the change and dirty state.
export const MARKDOWN_AUTO_SAVE_DELAY_MS = 0;

function documentWithinAutoSaveLimit(document: vscode.TextDocument): boolean {
	const lastLine = document.lineAt(document.lineCount - 1);
	const characterLength = document.offsetAt(lastLine.rangeIncludingLineBreak.end);
	// UTF-8 cannot be shorter than the UTF-16 code-unit count. Reject that cheap
	// lower bound before getText() creates a second attacker-sized document copy.
	return characterLength <= MAX_EDITOR_DOCUMENT_BYTES && isEditorDocumentWithinLimit(document.getText());
}

interface TrackedDocument {
	document: vscode.TextDocument;
	references: number;
	generation: number;
	timer?: ReturnType<typeof setTimeout>;
	saving: boolean;
	pending: boolean;
	failureReported?: boolean;
}

/**
 * Saves Markdown edits without an idle delay, serializing native saves. The
 * controller deliberately does not accept a path from the webview: its only
 * authority is the already-open TextDocument registered by the host.
 */
export class MarkdownAutoSaveController implements vscode.Disposable {
	private readonly tracked = new Map<string, TrackedDocument>();
	private readonly automaticallyTracked = new Map<string, vscode.Disposable>();
	private readonly disposables: vscode.Disposable[];
	private disposed = false;

	constructor() {
		this.disposables = [
			vscode.workspace.onDidChangeTextDocument((event) => {
				this.trackAutomatically(event.document);
				// VS Code may publish the dirty-state transition separately from the
				// content event, including after a previous save has just completed.
				const saving = this.tracked.get(event.document.uri.toString())?.saving;
				if (event.contentChanges.length > 0 || (event.document.isDirty && !saving)) this.schedule(event.document);
			}),
			vscode.workspace.onDidOpenTextDocument((document) => this.trackAutomatically(document)),
			vscode.workspace.onDidCloseTextDocument((document) => {
				const key = document.uri.toString();
				this.automaticallyTracked.get(key)?.dispose();
				this.automaticallyTracked.delete(key);
			}),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (!event.affectsConfiguration('mdLivePreview.autoSave')) return;
				for (const state of this.tracked.values()) {
					this.cancelTimer(state);
					if (state.document.isDirty) this.schedule(state.document);
				}
			}),
		];
		for (const document of vscode.workspace.textDocuments) this.trackAutomatically(document);
	}

	private trackAutomatically(document: vscode.TextDocument): void {
		if (this.disposed || document.languageId !== 'markdown') return;
		const key = document.uri.toString();
		if (!this.automaticallyTracked.has(key)) {
			this.automaticallyTracked.set(key, this.track(document));
		}
	}

	track(document: vscode.TextDocument): vscode.Disposable {
		const key = document.uri.toString();
		const existing = this.tracked.get(key);
		if (existing) existing.references++;
		else this.tracked.set(key, {
			document,
			references: 1,
			generation: 0,
			saving: false,
			pending: false,
		});
		if (!existing && document.isDirty) this.schedule(document);

		let released = false;
		return new vscode.Disposable(() => {
			if (released) return;
			released = true;
			const state = this.tracked.get(key);
			if (!state || --state.references > 0) return;
			this.cancelTimer(state);
			state.generation++;
			this.tracked.delete(key);
		});
	}

	private schedule(document: vscode.TextDocument): void {
		// During a WorkspaceEdit, VS Code can publish the content-change event just
		// before `isDirty` flips to true. Schedule from every tracked content change
		// and check dirtiness when the timer fires; otherwise a one-click mutation
		// such as checking a task can be the only event and remain unsaved forever.
		if (this.disposed || !this.enabled(document)) return;
		const state = this.tracked.get(document.uri.toString());
		if (!state || state.document !== document) return;
		if (state.saving) {
			state.pending = true;
			return;
		}
		if (state.timer !== undefined) return;
		const generation = ++state.generation;
		state.timer = setTimeout(() => {
			state.timer = undefined;
			void this.saveIfAuthorized(state, generation);
		}, MARKDOWN_AUTO_SAVE_DELAY_MS);
	}

	private enabled(document: vscode.TextDocument): boolean {
		return vscode.workspace
			.getConfiguration('mdLivePreview', document.uri)
			.get<boolean>('autoSave', true);
	}

	private async saveIfAuthorized(state: TrackedDocument, generation: number): Promise<void> {
		const document = state.document;
		if (
			this.disposed ||
			this.tracked.get(document.uri.toString()) !== state ||
			state.generation !== generation ||
			!document.isDirty ||
			!this.enabled(document) ||
			document.languageId !== 'markdown'
		) return;
		if (document.uri.scheme !== 'file' || !documentWithinAutoSaveLimit(document)) {
			this.warnOnce(state, 'Automatic Markdown saving is unavailable for this file. Save it manually before closing it.');
			return;
		}

		// Serialize authorization as well as the save itself. Edits arriving during
		// either asynchronous operation must trigger a follow-up save, not cancel it.
		state.saving = true;
		state.pending = false;
		try {
			const vaultRoot = localWorkspaceVaultRoot(document.uri);
			if (!vaultRoot || !await isCanonicalPathInside(vaultRoot.fsPath, document.uri.fsPath)) {
				diagnosticEventRateLimited('editor.autoSaveRejected');
				this.warnOnce(state, 'Automatic Markdown saving requires a file inside the current local workspace vault. Save this document manually before closing it.');
				return;
			}
			// The asynchronous canonical-path check may have outlived this tab, a
			// configuration change, or another edit. Never let that stale authority
			// cause a save.
			if (
				this.disposed ||
				this.tracked.get(document.uri.toString()) !== state ||
				state.generation !== generation ||
				!document.isDirty ||
				!this.enabled(document) ||
				!documentWithinAutoSaveLimit(document) ||
				localWorkspaceVaultRoot(document.uri)?.toString() !== vaultRoot.toString()
			) return;

			let saved = false;
			try {
				saved = await document.save();
			} catch {
				// A filesystem provider or save participant may fail. Do not retry in a
				// loop; the dirty document remains available for an explicit user save.
			}
			if (!saved) {
				diagnosticEventRateLimited('editor.autoSaveFailed');
				this.warnOnce(state, 'Markdown could not be saved automatically. Your changes remain unsaved in VS Code. Save the document before closing it.');
			} else {
				state.failureReported = false;
			}
		} finally {
			state.saving = false;
			if (state.pending) {
				state.pending = false;
				this.schedule(document);
			}
		}
	}

	private warnOnce(state: TrackedDocument, message: string): void {
		if (this.disposed || state.failureReported) return;
		state.failureReported = true;
		void vscode.window.showWarningMessage(message);
	}

	private cancelTimer(state: TrackedDocument): void {
		if (state.timer) clearTimeout(state.timer);
		state.timer = undefined;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const tracking of this.automaticallyTracked.values()) tracking.dispose();
		this.automaticallyTracked.clear();
		for (const state of this.tracked.values()) {
			this.cancelTimer(state);
			state.generation++;
		}
		this.tracked.clear();
		for (const disposable of this.disposables) disposable.dispose();
	}
}
