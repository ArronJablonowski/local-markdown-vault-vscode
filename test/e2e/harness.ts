import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

/**
 * Stands in for the VS Code host inside the page.
 *
 * Kept as a string rather than written inline in the HTML template, because the
 * bundle's own `${...}` sequences and this file's template literal would
 * otherwise fight over the same syntax.
 */
const HOST_STUB = [
	'window.__posted = [];',
	'window.acquireVsCodeApi = function () {',
	'  return {',
	'    postMessage: function (m) { window.__posted.push(m); },',
	'    getState: function () { return undefined; },',
	'    setState: function () {},',
	'  };',
	'};',
].join(String.fromCharCode(10));

const ROOT = join(__dirname, '..', '..');

/**
 * Mounts the built editor webview in a blank page.
 *
 * The bundle and the stylesheet are the ones that ship, so a rule that only
 * works in the author's head fails here. What is faked is the host: the webview
 * talks to VS Code through `acquireVsCodeApi`, and expects an `init` message
 * carrying the document's text.
 *
 * `--vscode-*` variables normally come from the host's theme; a representative
 * dark set is supplied so colors resolve to something assertable rather than to
 * the fallbacks.
 */
export async function mountEditor(
	page: Page,
	text: string,
	options: {
		mermaidChunk?: string;
		workspaceTrusted?: boolean;
		diagramRenderingAllowed?: boolean;
		remoteMedia?: 'block' | 'https';
		css?: string;
		vaultNotes?: Array<{ path: string; basename: string; aliases: string[]; headings: Array<{ text: string; line: number }>; blockIds: string[] }>;
		currentVaultPath?: string;
	} = {},
): Promise<void> {
	const script = readFileSync(join(ROOT, 'dist', 'webview-editor.js'), 'utf8');
	const style = readFileSync(join(ROOT, 'media', 'webview-editor-theme.css'), 'utf8');

	// The Mermaid bundle is fetched lazily by URI, and the AWS shape table by
	// `fetch`. Serving both from the page's own origin lets the diagram widgets
	// run for real rather than being stubbed into always-failing.
	await page.route('**/mermaid-chunk.js', (route) =>
		route.fulfill({
			contentType: 'application/javascript',
			body: options.mermaidChunk ?? readFileSync(join(ROOT, 'dist', 'mermaid-chunk.js'), 'utf8'),
		}),
	);
	await page.route('**/aws4-shapes.json', (route) =>
		route.fulfill({
			contentType: 'application/json',
			body: readFileSync(join(ROOT, 'dist', 'aws4-shapes.json'), 'utf8'),
		}),
	);

	await page.setContent(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
:root {
	--vscode-editor-background: #1e1e1e;
	--vscode-editor-foreground: #d4d4d4;
	--vscode-editorCursor-foreground: #aeafad;
	--vscode-editorWidget-background: #252526;
	--vscode-editorWidget-border: #454545;
	--vscode-input-background: #3c3c3c;
	--vscode-input-foreground: #cccccc;
	--vscode-focusBorder: #007fd4;
	--vscode-button-secondaryBackground: #3a3d41;
	--vscode-button-secondaryForeground: #ffffff;
	--vscode-icon-foreground: #c5c5c5;
	--vscode-toolbar-hoverBackground: #5a5d5e;
	--vscode-inputOption-activeBorder: #007fd4;
	--vscode-inputOption-activeBackground: #0e639c55;
}

html, body { margin: 0; height: 100%; background: var(--vscode-editor-background); }
#mlp-root { height: 100%; }
${style}
</style>
</head>
<body>
<div id="mlp-root" data-mermaid-uri="https://example.invalid/mermaid-chunk.js" data-aws-shapes-uri="https://example.invalid/aws4-shapes.json" data-script-nonce="test"></div>
<script>${HOST_STUB}</script>
<script>${script.replace(/<\/script>/gi, '<\/script>')}</script>
</body>
</html>`);

	await page.evaluate(({ docText, workspaceTrusted, diagramRenderingAllowed, remoteMedia, css, vaultNotes, currentVaultPath }) => {
		window.dispatchEvent(
			new MessageEvent('message', {
				data: {
					type: 'init',
					protocolVersion: 1,
					text: docText,
					version: 0,
					css,
					codeTheme: 'dark-plus',
					remoteMedia,
					workspaceTrusted,
					diagramRenderingAllowed,
					vaultNotes,
					currentVaultPath,
				},
			}),
		);
	}, {
		docText: text,
		workspaceTrusted: options.workspaceTrusted ?? true,
		diagramRenderingAllowed: options.diagramRenderingAllowed ?? options.workspaceTrusted ?? true,
		remoteMedia: options.remoteMedia ?? 'block',
		css: options.css ?? '',
		vaultNotes: options.vaultNotes ?? [],
		currentVaultPath: options.currentVaultPath ?? '',
	});

	await page.waitForSelector('.cm-content');
}

/** Mounts the shipped CSS-theme sidebar bundle with a validated host update. */
export async function mountStyleSidebar(
	page: Page,
	styles: Array<{ id: string; name: string; enabled: boolean; css: string }>,
	workspaceTrusted = true,
): Promise<void> {
	const script = readFileSync(join(ROOT, 'dist', 'webview-sidebar.js'), 'utf8');
	const style = readFileSync(join(ROOT, 'media', 'webview-sidebar-style.css'), 'utf8');
	await page.setContent(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><style>${style}</style></head>
<body><div id="mlp-sidebar-root"></div><script>${HOST_STUB}</script>
<script>${script.replace(/<\/script>/gi, '<\/script>')}</script></body></html>`);
	await page.evaluate(({ entries, trusted }) => {
		window.dispatchEvent(new MessageEvent('message', {
			data: {
				type: 'init',
				styles: entries,
				settings: { defaultEditor: 'prompt', codeTheme: 'auto' },
				themeKind: 'vscode-dark',
				workspaceTrusted: trusted,
			},
		}));
	}, { entries: styles, trusted: workspaceTrusted });
	await page.waitForSelector('.mlp-settings');
}

/**
 * Sends a message to the webview as the host would.
 *
 * The webview's whole input surface is `window.postMessage`, so this is how a
 * test drives anything the host normally supplies — syntax-highlight tokens, a
 * CSS theme, an external edit.
 */
export async function postToWebview(page: Page, message: unknown): Promise<void> {
	await page.evaluate((data) => {
		window.dispatchEvent(new MessageEvent('message', { data }));
	}, message);
}

/** Opens the find panel and waits for it to mount. */
export async function openSearch(page: Page): Promise<void> {
	await page.locator('.cm-content').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
	await page.waitForSelector('.cm-search');
	await page.locator('.cm-search input').first().focus();
}
