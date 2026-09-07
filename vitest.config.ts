import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text-summary', 'json-summary', 'html'],
			reportsDirectory: 'coverage',
			// The unit suite runs in plain Node, so it can only reach code that does
			// not need a browser or the VS Code host. Files that are nothing but
			// wiring to one of those are excluded rather than counted as untested
			// forever: what they do is verified by the integration and e2e suites.
			// Anything with logic of its own stays in, whether or not it has tests.
			exclude: [
				'src/**/*.test.ts',
				'src/webview-editor/testDom.ts',
				'src/shared/drawioTestXml.ts',
				// Extension host entry points: activation and VS Code API calls.
				'src/extension.ts',
				'src/editor/MarkdownLivePreviewProvider.ts',
				'src/sidebar/OutlineViewProvider.ts',
				'src/sidebar/StyleManagerViewProvider.ts',
				// Type-only.
				'src/shared/messages.ts',
				// Webview entry points: DOM assembly against a live document.
				'src/webview-mermaid/main.ts',
				'src/webview-outline/main.ts',
				'src/webview-preview/main.ts',
				'src/webview-sidebar/main.ts',
				'src/webview-editor/main.ts',
			],
		},
	},
});
