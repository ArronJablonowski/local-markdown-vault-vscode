import { defineConfig } from '@playwright/test';

// The e2e suite mounts the real webview bundle and the real stylesheet in a
// browser page. That is the only place the things the other two suites cannot
// see become observable: computed colors, box geometry, and what a click
// actually does to the DOM.
export default defineConfig({
	testDir: 'test/e2e',
	fullyParallel: true,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		// The webview is a fixed-size panel in a sidebar-less window; a desktop
		// viewport is close enough, and each test sets its own where size matters.
		viewport: { width: 1000, height: 700 },
	},
});
