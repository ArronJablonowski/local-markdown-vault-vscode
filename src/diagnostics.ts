import * as vscode from 'vscode';
import { BoundedDiagnosticBuffer, DiagnosticRateLimiter, sanitizeDiagnosticEventName, sanitizeDiagnosticFields, type DiagnosticFields } from './shared/diagnosticSanitizer';

const MAX_LOG_ENTRIES = 500;
const MAX_LOG_CHARACTERS = 64 * 1024;

class LocalDiagnosticLog implements vscode.Disposable {
	private readonly entries = new BoundedDiagnosticBuffer(MAX_LOG_ENTRIES, MAX_LOG_CHARACTERS);
	private readonly rateLimiter = new DiagnosticRateLimiter();
	private channel: vscode.OutputChannel | undefined;
	private enabled = false;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.refreshConfiguration();
		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration('mdLivePreview.diagnostics.enabled')) this.refreshConfiguration();
			}),
			vscode.commands.registerCommand('mdLivePreview.showDiagnostics', () => this.show()),
			this,
		);
	}

	record(event: string, fields: DiagnosticFields = {}): void {
		if (!this.enabled) return;
		// Redact before buffering so hidden logs never retain raw note or path data.
		const safeEvent = sanitizeDiagnosticEventName(event);
		const safeFields = sanitizeDiagnosticFields(fields);
		const details = Object.keys(safeFields).length ? ` ${JSON.stringify(safeFields)}` : '';
		const line = `${new Date().toISOString()} ${safeEvent}${details}`;
		this.entries.push(line);
		this.render();
	}

	recordRateLimited(event: string, fields: DiagnosticFields = {}): void {
		if (!this.enabled) return;
		const safeEvent = sanitizeDiagnosticEventName(event);
		if (this.rateLimiter.accept(safeEvent)) this.record(safeEvent, fields);
	}

	private refreshConfiguration(): void {
		const enabled = vscode.workspace.getConfiguration('mdLivePreview.diagnostics').get<boolean>('enabled', false);
		if (enabled === this.enabled) return;
		this.enabled = enabled;
		if (!enabled) {
			// Turning diagnostics off also forgets this session's captured events.
			this.entries.clear();
			this.rateLimiter.clear();
			this.channel?.clear();
		} else this.render();
	}

	private show(): void {
		this.ensureChannel();
		this.render();
		this.channel!.show(false);
	}

	private render(): void {
		// Recording stays headless until the user explicitly opens the output channel.
		if (!this.channel) return;
		const header = this.enabled
			? vscode.l10n.t('Local diagnostics are enabled. Markdown, URLs, clipboard data, secrets, and absolute paths are redacted.')
			: vscode.l10n.t('Local diagnostics are disabled. Enable mdLivePreview.diagnostics.enabled to record bounded troubleshooting events.');
		const entries = this.entries.snapshot();
		this.channel.replace(`${header}\n${entries.join('\n')}${entries.length ? '\n' : ''}`);
	}

	private ensureChannel(): void {
		this.channel ??= vscode.window.createOutputChannel('Local Markdown Vault');
	}

	dispose(): void {
		this.entries.clear();
		this.rateLimiter.clear();
		this.channel?.dispose();
		this.channel = undefined;
	}
}

let activeLog: LocalDiagnosticLog | undefined;

export function initializeDiagnostics(context: vscode.ExtensionContext): void {
	activeLog?.dispose();
	activeLog = new LocalDiagnosticLog(context);
}

export function diagnosticEvent(event: string, fields?: DiagnosticFields): void {
	activeLog?.record(event, fields);
}

export function diagnosticEventRateLimited(event: string, fields?: DiagnosticFields): void {
	activeLog?.recordRateLimited(event, fields);
}
