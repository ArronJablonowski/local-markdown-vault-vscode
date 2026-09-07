import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards against features that are written but never switched on.
 *
 * `main.ts` is the editor's wiring: it assembles CodeMirror's extensions, and a
 * capability missing from that list fails silently — the code implementing it
 * still compiles, still ships, and simply never runs. That is exactly how
 * multiple selections came to be documented in the README while being disabled
 * in practice, and how the search panel's styling sat unused for a release.
 *
 * Asserting on the source text is crude, but the alternative is booting a real
 * CodeMirror against a DOM, and what needs guarding here is only "is this line
 * present" rather than any behaviour. The same file's behaviour is covered by
 * the integration and e2e suites.
 */
const MAIN = readFileSync(join(__dirname, 'main.ts'), 'utf8');
const THEME = readFileSync(
	join(__dirname, '..', '..', 'media', 'webview-editor-theme.css'),
	'utf8',
);

describe('editor wiring', () => {
	it('enables multiple selections', () => {
		// Without this, every extra cursor collapses into one: Ctrl+D does nothing
		// and Ctrl+B/Ctrl+I silently lose their multi-cursor behaviour.
		expect(MAIN).toContain('allowMultipleSelections.of(true)');
	});

	it('draws the extra cursors it allows', () => {
		// The browser paints only its own single caret, so the extra ones are
		// invisible without this even when the selections exist.
		expect(MAIN).toContain('drawSelection()');
	});

	it('mounts the search extension', () => {
		expect(MAIN).toMatch(/\bsearch\(\{/);
	});

	it('binds the search keys a user expects', () => {
		for (const key of ['Mod-f', 'F3', 'Mod-d', 'Escape']) {
			expect(MAIN).toContain(`'${key}'`);
		}
	});

	it('keeps a search match visible through the reveal extension', () => {
		expect(MAIN).toContain('searchRevealExtension');
	});
});

describe('editor theme', () => {
	it('colors the drawn caret from the VS Code theme', () => {
		// `drawSelection()` replaces the native caret with an element whose library
		// default is a hardcoded black — invisible on a dark theme.
		expect(THEME).toMatch(/\.cm-cursor[^{]*\{[^}]*--vscode-editorCursor-foreground/s);
	});

	it('styles the search panel it mounts', () => {
		expect(THEME).toContain('.cm-panel.cm-search');
	});

	it('has no stray control characters', () => {
		// A literal NUL once reached this file through a mis-escaped `\00d7`,
		// which rendered as garbage and made the stylesheet count as binary.
		const stray = Array.from(THEME).filter((c) => {
			const code = c.charCodeAt(0);
			return code < 9 || (code > 13 && code < 32);
		});
		expect(stray).toEqual([]);
	});
});
