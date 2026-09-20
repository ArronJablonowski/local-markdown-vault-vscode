import { describe, expect, it } from 'vitest';
import { prepareSidebarPreviewCss } from './sidebarCss';

describe('sidebar CSS preview policy', () => {
	it('remaps body theme gates into the thumbnail shadow host', () => {
		expect(prepareSidebarPreviewCss('body.vscode-dark h1 { color: white; }'))
			.toContain(':host(.vscode-dark) h1 { color: white; }');
	});

	it.each([
		'@import "https://tracker.invalid/theme.css";',
		'h1 { background: url(https://tracker.invalid/pixel); }',
		'h1 { position: fixed; inset: 0; }',
		'h1 { z-index: 999999; }',
		'button { color: transparent; }',
	])('rejects network-bearing or control-obscuring CSS: %s', (css) => {
		expect(prepareSidebarPreviewCss(css)).toBe('');
	});

	it('keeps safe thumbnail rules when a hostile sibling rule is removed', () => {
		const css = prepareSidebarPreviewCss('h1 { color: red; } div { opacity: 0; } p { font-weight: bold; }');
		expect(css).toContain('h1 { color: red; }');
		expect(css).toContain('p { font-weight: bold; }');
		expect(css).not.toContain('opacity');
	});
});
