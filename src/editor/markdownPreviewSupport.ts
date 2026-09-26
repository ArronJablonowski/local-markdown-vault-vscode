import * as vscode from 'vscode';
import { diagnosticEventRateLimited } from '../diagnostics';

export const STICKY_PREVIEW_TABLE_CLASS = 'lmv-sticky-table-headers';
const SETTING = 'mdLivePreview.stickyTableHeaders';
// VS Code batches ordinary document preview refreshes for 300ms. Its force
// refresh command does not upgrade an already pending ordinary refresh, which
// can skip an unchanged document. Let that batch settle before requesting ours.
const PREVIEW_REFRESH_DELAY_MS = 350;

// The built-in Markdown extension supplies markdown-it. Keep this boundary
// structural instead of shipping a second parser just for its renderer hook.
interface PreviewToken {
	attrs: [string, string][] | null;
}
interface PreviewRenderer {
	renderToken(tokens: PreviewToken[], index: number, options: unknown): string;
}
type PreviewRule = (
	tokens: PreviewToken[], index: number, options: unknown,
	env: { currentDocument?: vscode.Uri } | undefined, renderer: PreviewRenderer,
) => string;
export interface MarkdownItPreview {
	renderer: PreviewRenderer & { rules: Record<string, PreviewRule | undefined> };
}
export interface MarkdownPreviewApi {
	extendMarkdownIt<T extends MarkdownItPreview>(markdownIt: T): T;
}

export function createMarkdownPreviewSupport(): MarkdownPreviewApi & vscode.Disposable {
	// VS Code may reuse a parser; wrapping its rule twice would duplicate our marker.
	const installed = new WeakSet<MarkdownItPreview>();
	let disposed = false;
	let refreshing = false;
	let refreshPending = false;
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;

	async function refresh(): Promise<void> {
		if (refreshing || disposed) return;
		refreshing = true;
		try {
			// Coalesce changes while a refresh is in flight, but do not miss a
			// final toggle that arrives after the previous render read its config.
			while (refreshPending && !disposed) {
				refreshPending = false;
				try {
					await vscode.commands.executeCommand('markdown.preview.refresh');
				} catch {
					// The built-in Markdown extension may have been disabled. This
					// optional rendering integration must not break normal editing.
					diagnosticEventRateLimited('markdownPreview.refresh.failed');
				}
			}
		} finally {
			refreshing = false;
		}
	}
	const subscription = vscode.workspace.onDidChangeConfiguration(event => {
		if (disposed || !event.affectsConfiguration(SETTING)) return;
		if (refreshTimer !== undefined) clearTimeout(refreshTimer);
		refreshTimer = setTimeout(() => {
			refreshTimer = undefined;
			refreshPending = true;
			void refresh();
		}, PREVIEW_REFRESH_DELAY_MS);
	});

	return {
		extendMarkdownIt<T extends MarkdownItPreview>(markdownIt: T): T {
			if (installed.has(markdownIt)) return markdownIt;
			installed.add(markdownIt);
			const previous = markdownIt.renderer.rules.table_open;
			markdownIt.renderer.rules.table_open = (tokens, index, options, env, renderer) => {
				const token = tokens[index];
				const original = token.attrs;
				const enabled = !disposed && vscode.workspace.getConfiguration('mdLivePreview', env?.currentDocument)
					.get<unknown>('stickyTableHeaders', false) === true;
				if (!enabled) return previous ? previous(tokens, index, options, env, renderer)
					: renderer.renderToken(tokens, index, options);

				// Renderer tokens may be cached by VS Code. Use a temporary copy so
				// switching this setting off never leaves an old marker on a token.
				token.attrs = original?.map(([name, value]) => [name, value]) ?? [];
				const classes = token.attrs.find(([name]) => name === 'class');
				if (classes) classes[1] = `${classes[1]} ${STICKY_PREVIEW_TABLE_CLASS}`;
				else token.attrs.push(['class', STICKY_PREVIEW_TABLE_CLASS]);
				try {
					return previous ? previous(tokens, index, options, env, renderer)
						: renderer.renderToken(tokens, index, options);
				} finally {
					token.attrs = original;
				}
			};
			return markdownIt;
		},
		dispose() {
			disposed = true;
			refreshPending = false;
			if (refreshTimer !== undefined) clearTimeout(refreshTimer);
			refreshTimer = undefined;
			subscription.dispose();
		},
	};
}
