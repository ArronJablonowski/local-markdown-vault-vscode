import * as vscode from 'vscode';
import { diagnosticEventRateLimited } from '../diagnostics';
import { isEditorDocumentWithinLimit, MAX_EDITOR_DOCUMENT_BYTES } from '../shared/messageValidation';
import { isCanonicalPathInside } from './canonicalContainment';
import { localWorkspaceVaultRoot } from './workspaceVault';
import { hasUnsafeNativeMarkdownTab } from './nativeMarkdownCompatibility';

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
	waiting: boolean;
	pending: boolean;
	operation?: Promise<void>;
	failureReported?: boolean;
	dirtySuccessRetries: number;
	contentRevision: number;
	savedRevision: number;
	successfulSaveEvents: number;
	failedConcurrentRetries: number;
	nativePauseReported?: boolean;
}

interface AutomaticTracking {
	document: vscode.TextDocument;
	disposable: vscode.Disposable;
}

/**
 * Saves Markdown edits without an idle delay, serializing native saves. The
 * controller deliberately does not accept a path from the webview: its only
 * authority is the already-open TextDocument registered by the host.
 */
export class MarkdownAutoSaveController implements vscode.Disposable {
	private readonly tracked = new Map<string, TrackedDocument>();
	private readonly operations = new Map<string, Promise<void>>();
	private readonly automaticallyTracked = new Map<string, AutomaticTracking>();
	private readonly disposables: vscode.Disposable[];
	private disposed = false;

	constructor() {
		this.disposables = [
			vscode.workspace.onDidChangeTextDocument((event) => {
				this.trackAutomatically(event.document);
				const state = this.tracked.get(event.document.uri.toString());
				if (event.contentChanges.length > 0 && state?.document === event.document) state.contentRevision++;
				// VS Code may publish the dirty-state transition separately from the
				// content event, including after a previous save has just completed.
				const saving = state?.saving;
				if (event.contentChanges.length > 0 || (event.document.isDirty && !saving)) this.schedule(event.document);
			}),
			vscode.workspace.onDidOpenTextDocument((document) => this.trackAutomatically(document)),
			vscode.workspace.onDidSaveTextDocument((document) => {
				const state = this.tracked.get(document.uri.toString());
				if (state?.document === document) state.successfulSaveEvents++;
			}),
			vscode.workspace.onDidCloseTextDocument((document) => {
				const key = document.uri.toString();
				const automatic = this.automaticallyTracked.get(key);
				if (automatic?.document === document) {
					automatic.disposable.dispose();
					this.automaticallyTracked.delete(key);
				}
				// A custom editor can retain its registration until after the native
				// document closes. Neither that registration nor a late close event
				// may keep a reopened URI attached to the old TextDocument.
				const state = this.tracked.get(key);
				if (state?.document === document) {
					this.cancelTimer(state);
					state.generation++;
					this.tracked.delete(key);
				}
			}),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (!event.affectsConfiguration('mdLivePreview.autoSave')) return;
				for (const state of this.tracked.values()) {
					this.cancelTimer(state);
					if (state.document.isDirty || state.contentRevision > state.savedRevision) this.schedule(state.document);
				}
			}),
			vscode.window.tabGroups.onDidChangeTabs(() => this.resumeSafeDocuments()),
			vscode.window.tabGroups.onDidChangeTabGroups(() => this.resumeSafeDocuments()),
		];
		for (const document of vscode.workspace.textDocuments) this.trackAutomatically(document);
	}

	private trackAutomatically(document: vscode.TextDocument): void {
		if (this.disposed || document.isClosed || document.languageId !== 'markdown') return;
		const key = document.uri.toString();
		const automatic = this.automaticallyTracked.get(key);
		if (automatic?.document !== document) {
			const disposable = this.track(document);
			automatic?.disposable.dispose();
			this.automaticallyTracked.set(key, { document, disposable });
		}
	}

	track(document: vscode.TextDocument): vscode.Disposable {
		if (this.disposed || document.isClosed) return new vscode.Disposable(() => {});
		const key = document.uri.toString();
		const existing = this.tracked.get(key);
		if (existing && existing.document !== document) {
			this.cancelTimer(existing);
			existing.generation++;
		}
		const state = existing?.document === document ? existing : {
			document,
			references: 0,
			generation: 0,
			saving: false,
			waiting: false,
			pending: false,
			dirtySuccessRetries: 0,
			contentRevision: 0,
			savedRevision: 0,
			successfulSaveEvents: 0,
			failedConcurrentRetries: 0,
			// A native save cannot be canceled once it has started. A replacement
			// document at the same URI must wait for it before writing newer text.
			operation: this.operations.get(key) ?? existing?.operation,
		};
		state.references++;
		this.tracked.set(key, state);
		if (state !== existing && document.isDirty) this.schedule(document);

		let released = false;
		return new vscode.Disposable(() => {
			if (released) return;
			released = true;
			if (this.tracked.get(key) !== state || --state.references > 0) return;
			this.cancelTimer(state);
			state.generation++;
			this.tracked.delete(key);
		});
	}

	private schedule(document: vscode.TextDocument, continuation = false): void {
		// During a WorkspaceEdit, VS Code can publish the content-change event just
		// before `isDirty` flips to true. Schedule from every tracked content change
		// and check dirtiness when the timer fires; otherwise a one-click mutation
		// such as checking a task can be the only event and remain unsaved forever.
		if (this.disposed || document.isClosed || !this.enabled(document)) return;
		const state = this.tracked.get(document.uri.toString());
		if (!state || state.document !== document) return;
		if (this.nativeSaveBlocked(state)) { this.cancelTimer(state); return; }
		if (state.saving || state.waiting) {
			state.pending = true;
			return;
		}
		if (!continuation) {
			state.dirtySuccessRetries = 0;
			state.failedConcurrentRetries = 0;
		}
		if (state.timer !== undefined) return;
		const generation = ++state.generation;
		state.timer = setTimeout(() => {
			state.timer = undefined;
			this.startSave(state, generation);
		}, MARKDOWN_AUTO_SAVE_DELAY_MS);
	}

	/** Settle a save before/after undo so native history cannot race a disk write. */
	async flush(document: vscode.TextDocument): Promise<void> {
		const key = document.uri.toString();
		const state = this.tracked.get(key);
		if (this.disposed) return;
		if (!state || state.document !== document) {
			// Closing removes tracking, but cannot cancel a native save already in
			// progress. A recovery reopen must wait for that write before reading or
			// replaying its accepted draft at the same URI.
			await this.settlePendingOperations(key);
			return;
		}
		do {
			this.cancelTimer(state);
			await state.operation;
			while (state.saving || state.waiting) await state.operation;
			this.cancelTimer(state);
			if (this.disposed) return;
			if (this.tracked.get(key) !== state) {
				await this.settlePendingOperations(key);
				return;
			}
			await this.startSave(state, state.generation);
			// A newer native keystroke can arrive during this save. Shutdown and
			// history callers must wait for its scheduled follow-up too, rather
			// than returning early and letting disposal cancel the last timer.
		} while (state.timer !== undefined || state.saving || state.waiting);
	}

	private async settlePendingOperations(key: string): Promise<void> {
		let operation = this.operations.get(key);
		while (operation) {
			await operation;
			const current = this.operations.get(key);
			// A replacement document can queue its save while the old document's
			// write is awaited. Drain that successor too, without starting a save or
			// awaiting ourselves. A settled identity needs no further iteration.
			if (current === operation) return;
			operation = current;
		}
	}

	private startSave(state: TrackedDocument, generation: number): Promise<void> {
		const key = state.document.uri.toString();
		const previous = this.operations.get(key);
		state.waiting = true;
		const operation = (async () => {
			try {
				await previous;
				state.waiting = false;
				await this.saveIfAuthorized(state, generation);
			}
			catch {
				// A closed document or unexpected provider error must not poison all
				// subsequent attempts or become an unhandled timer rejection.
				diagnosticEventRateLimited('editor.autoSaveFailed');
				this.warnOnce(state, 'Markdown could not be saved automatically. Keep this document open and save it manually.');
			}
			finally { state.waiting = false; }
		})();
		state.operation = operation;
		this.operations.set(key, operation);
		void operation.then(() => {
			if (this.operations.get(key) === operation) this.operations.delete(key);
		});
		return operation;
	}

	private enabled(document: vscode.TextDocument): boolean {
		return vscode.workspace
			.getConfiguration('mdLivePreview', document.uri)
			.get<boolean>('autoSave', true);
	}

	private resumeSafeDocuments(): void {
		for (const state of this.tracked.values()) {
			if (hasUnsafeNativeMarkdownTab(state.document.uri)) this.cancelTimer(state);
			else {
				state.nativePauseReported = false;
				if (state.document.isDirty || state.contentRevision > state.savedRevision) this.schedule(state.document);
			}
		}
	}

	private nativeSaveBlocked(state: TrackedDocument): boolean {
		if (!hasUnsafeNativeMarkdownTab(state.document.uri)) return false;
		if (!state.nativePauseReported) {
			state.nativePauseReported = true;
			void vscode.window.showWarningMessage('Automatic Markdown saving is paused while this file is open in VS Code\'s native Markdown Editor because saving can interrupt typing there. Use Markdown Live Preview or Text Editor, or save manually after you stop typing.');
		}
		return true;
	}

	private async saveIfAuthorized(state: TrackedDocument, generation: number): Promise<void> {
		const document = state.document;
		if (
			this.disposed ||
			this.tracked.get(document.uri.toString()) !== state ||
			state.generation !== generation ||
			document.isClosed ||
			(!document.isDirty && state.contentRevision <= state.savedRevision) ||
			!this.enabled(document) ||
			this.nativeSaveBlocked(state) ||
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
		let retryDirtySuccess = false;
		let saveFailed = false;
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
				document.isClosed ||
				document.languageId !== 'markdown' ||
				(!document.isDirty && state.contentRevision <= state.savedRevision) ||
				!this.enabled(document) ||
				this.nativeSaveBlocked(state) ||
				!documentWithinAutoSaveLimit(document) ||
				localWorkspaceVaultRoot(document.uri)?.toString() !== vaultRoot.toString()
			) return;

			// Native save notifications do not carry a document version. VS Code's
			// extension-host mirror can therefore report clean for a newer edit when
			// an older save completes. Only cover changes observed before this save
			// began, and ask the native model to save newer revisions even when that
			// stale mirror says isDirty=false. Never rewrite files or fabricate edits.
			const savingRevision = state.contentRevision;
			const successfulEventsBefore = state.successfulSaveEvents;
			let saved = false;
			try {
				saved = await document.save();
			} catch {
				// A filesystem provider or save participant may fail. Do not retry in a
				// loop; the dirty document remains available for an explicit user save.
			}
			if (!saved) {
				const newerContent = state.contentRevision > savingRevision;
				const madeProgress = state.successfulSaveEvents > successfulEventsBefore;
				if (newerContent && (madeProgress || state.failedConcurrentRetries++ === 0)) {
					// VS Code can write the older snapshot and return false because a
					// newer native keystroke kept its real model dirty. That is progress,
					// not a failed filesystem write: finish saving the newer revision.
					// A canceled save with no write gets only one follow-up attempt.
					if (madeProgress) state.failedConcurrentRetries = 0;
					retryDirtySuccess = true;
				} else {
					saveFailed = true;
					diagnosticEventRateLimited('editor.autoSaveFailed');
					this.warnOnce(state, 'Markdown could not be saved automatically. Your changes remain unsaved in VS Code. Save the document before closing it.');
				}
			} else if (document.isDirty) {
				state.savedRevision = Math.max(state.savedRevision, savingRevision);
				// Some save participants/providers can resolve successfully while a
				// newer change remains dirty, without publishing a content event to
				// this controller. Verify the postcondition instead of treating a
				// true return value as proof that the latest content reached disk.
				// Retry once when no newer edit was reported; a permanently dirty
				// successful provider must not cause an unbounded save loop.
				if (!state.pending && state.dirtySuccessRetries++ === 0) retryDirtySuccess = true;
				else if (!state.pending) {
					diagnosticEventRateLimited('editor.autoSaveStillDirty');
					this.warnOnce(state, 'Markdown still has unsaved changes after automatic saving. Save the document manually before closing it.');
				}
			} else {
				state.savedRevision = Math.max(state.savedRevision, savingRevision);
				state.failedConcurrentRetries = 0;
				state.dirtySuccessRetries = 0;
				state.failureReported = false;
			}
		} finally {
			state.saving = false;
			if (state.pending || retryDirtySuccess) {
				state.pending = false;
				// Failed saves can themselves emit edits (for example from a save
				// participant). Require the next independent edit or explicit flush
				// to retry instead of repeatedly invoking a failing participant.
				if (!saveFailed) this.schedule(document, true);
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
		for (const tracking of this.automaticallyTracked.values()) tracking.disposable.dispose();
		this.automaticallyTracked.clear();
		for (const state of this.tracked.values()) {
			this.cancelTimer(state);
			state.generation++;
		}
		this.tracked.clear();
		this.operations.clear();
		for (const disposable of this.disposables) disposable.dispose();
	}
}
