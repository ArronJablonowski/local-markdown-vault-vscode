import { defineConfig } from '@vscode/test-cli';

// Integration tests run inside a real VS Code with the extension loaded, which
// is the only place the things unit tests cannot reach are observable: whether
// activation succeeds, whether the custom editor claims a .md file, and whether
// the editor's own extensions (multiple selections, search) are actually wired
// in rather than merely written.
export default defineConfig({
	files: 'out-test/integration/**/*.test.js',
	version: 'stable',
	// The suite creates and deletes documents, so it needs a real folder open
	// rather than the empty window the runner opens by default.
	workspaceFolder: 'test/fixtures',
	mocha: {
		ui: 'tdd',
		timeout: 60_000,
	},
});
