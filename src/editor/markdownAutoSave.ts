import * as vscode from 'vscode';
import { diagnosticEventRateLimited } from '../diagnostics';
import { isEditorDocumentWithinLimit, MAX_EDITOR_DOCUMENT_BYTES } from '../shared/messageValidation';
import { isCanonicalPathInside } from './canonicalContainment';
import { localWorkspaceVaultRoot } from './workspaceVault';

export const MARKDOWN_AUTO_SAVE_DELAY_MS = 500;

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
}

/**
 * Coalesces Live Preview edits into one native TextDocument save. The
 * controller deliberately does not accept a path from the webview: its only
 * authority is the already-open TextDocument registered by the host.
 */
export class MarkdownAutoSaveController implements vscode.Disposable {
	private readonly tracked = new Map<string, TrackedDocument>();
	private readonly disposables: vscode.Disposable[];
	private disposed = false;

	constructor() {
		this.disposables = [
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.contentChanges.length > 0) this.schedule(event.document);
			}),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (!event.affectsConfiguration('mdLivePreview.autoSave')) return;
				for (const state of this.tracked.values()) {
					this.cancelTimer(state);
					if (state.document.isDirty) this.schedule(state.document);
				}
			}),
		];
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
		this.cancelTimer(state);
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
			document.languageId !== 'markdown' ||
			document.uri.scheme !== 'file' ||
			!documentWithinAutoSaveLimit(document)
		) return;

		const vaultRoot = localWorkspaceVaultRoot(document.uri);
		if (!vaultRoot || !await isCanonicalPathInside(vaultRoot.fsPath, document.uri.fsPath)) {
			diagnosticEventRateLimited('editor.autoSaveRejected');
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
			!this.enabled(document)
		) return;

		state.saving = true;
		state.pending = false;
		let saved = false;
		try {
			saved = await document.save();
		} catch {
			// A filesystem provider or save participant may fail. Do not retry in a
			// loop; the dirty document remains available for an explicit user save.
		}
		state.saving = false;
		if (!saved) diagnosticEventRateLimited('editor.autoSaveFailed');
		if (state.pending && document.isDirty) {
			state.pending = false;
			this.schedule(document);
		}
	}

	private cancelTimer(state: TrackedDocument): void {
		if (state.timer) clearTimeout(state.timer);
		state.timer = undefined;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const state of this.tracked.values()) {
			this.cancelTimer(state);
			state.generation++;
		}
		this.tracked.clear();
		for (const disposable of this.disposables) disposable.dispose();
	}
}
