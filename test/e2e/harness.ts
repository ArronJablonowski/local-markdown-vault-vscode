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
	"window.mlpLocale = 'en';",
	"window.mlpNonce = 'test';",
	"window.mlpMermaidChunkUri = 'https://example.invalid/mermaid-chunk.js';",
	"window.mlpAwsShapesUri = 'https://example.invalid/aws4-shapes.json';",
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
export async function mountEditor(page: Page, text: string): Promise<void> {
	const script = readFileSync(join(ROOT, 'dist', 'webview-editor.js'), 'utf8');
	const style = readFileSync(join(ROOT, 'media', 'webview-editor-theme.css'), 'utf8');

	// The Mermaid bundle is fetched lazily by URI, and the AWS shape table by
	// `fetch`. Serving both from the page's own origin lets the diagram widgets
	// run for real rather than being stubbed into always-failing.
	await page.route('**/mermaid-chunk.js', (route) =>
		route.fulfill({
			contentType: 'application/javascript',
			body: readFileSync(join(ROOT, 'dist', 'mermaid-chunk.js'), 'utf8'),
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
<div id="mlp-root"></div>
<script>${HOST_STUB}</script>
<script>${script.replace(/<\/script>/gi, '<\/script>')}</script>
</body>
</html>`);

	await page.evaluate((docText) => {
		window.dispatchEvent(
			new MessageEvent('message', {
				data: {
					type: 'init',
					text: docText,
					version: 0,
					baseUri: 'https://example.invalid/',
					css: '',
					codeTheme: 'dark-plus',
				},
			}),
		);
	}, text);

	await page.waitForSelector('.cm-content');
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
	await page.keyboard.press('Control+f');
	await page.waitForSelector('.cm-search');
}
