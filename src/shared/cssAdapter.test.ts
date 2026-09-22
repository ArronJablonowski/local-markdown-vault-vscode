import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import {
	adaptMarkdownCss,
	decodeCssForSecurity,
	MAX_PREVIEW_CSS_BYTES,
	MAX_PREVIEW_CSS_NESTING,
	MAX_PREVIEW_CSS_RULES,
	sanitizePreviewCss,
	scopePreviewCss,
	stripNetworkedCss,
} from './cssAdapter';

// Tags the adapter deliberately leaves untouched (rendered with their real tag
// in the live preview, so no selector mapping applies to them).
const UNTOUCHED_TAGS = ['a', 'strong', 'em', 'del', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div'];

// Block-level tags mapped to a fixed replacement class, paired with the class
// each one is expected to contain in the output (PBT-07: domain-specific
// generator reflecting the adapter's own known mapping table, not raw strings).
const MAPPED_BLOCK_TAGS: Array<[string, string]> = [
	['h1', '.cm-line.mlp-line-h1'],
	['h2', '.cm-line.mlp-line-h2'],
	['h3', '.cm-line.mlp-line-h3'],
	['h4', '.cm-line.mlp-line-h4'],
	['h5', '.cm-line.mlp-line-h5'],
	['h6', '.cm-line.mlp-line-h6'],
	['blockquote', '.cm-line.mlp-line-quote'],
	['hr', '.mlp-hr'],
	['code', '.mlp-inline-code'],
];

// Realistic CSS property/value pairs (not arbitrary strings) so generated
// declarations stay parseable and don't accidentally exercise the box-model
// distribution logic (padding/margin/border), which is out of scope here.
const safeProp = fc.constantFrom('color', 'font-size', 'font-weight', 'line-height', 'background-color', 'opacity');
const safeValue = fc.constantFrom('red', '#333', '1rem', '14px', 'bold', '1.5', '0.8', 'inherit');
const declaration = fc.tuple(safeProp, safeValue).map(([p, v]) => `${p}: ${v};`);

describe('adaptMarkdownCss', () => {
	it('rewrites a simple heading selector to its .cm-line class', () => {
		const out = adaptMarkdownCss('h1 { color: red; }');
		expect(out).toContain('.cm-line.mlp-line-h1');
	});

	it('rewrites "pre code" to the block-code child selector', () => {
		const out = adaptMarkdownCss('pre code { color: red; }');
		expect(out).toContain('.cm-line.mlp-line-code > *');
	});

	it('maps a checkbox input selector to the checkbox span', () => {
		const out = adaptMarkdownCss('input[type="checkbox"] { accent-color: blue; }');
		expect(out).toContain('.mlp-checkbox');
	});

	it('maps every known block-level tag to its class regardless of declaration content (PBT-03 invariant)', () => {
		fc.assert(
			fc.property(fc.constantFrom(...MAPPED_BLOCK_TAGS), declaration, ([tag, expectedClass], decl) => {
				const out = adaptMarkdownCss(`${tag} { ${decl} }`);
				expect(out).toContain(expectedClass);
			}),
		);
	});

	it('leaves selector lists of untouched tags byte-for-byte identical (PBT-03 invariant)', () => {
		fc.assert(
			fc.property(fc.subarray(UNTOUCHED_TAGS, { minLength: 1, maxLength: 3 }), declaration, (tags, decl) => {
				const css = `${tags.join(', ')} { ${decl} }`;
				expect(adaptMarkdownCss(css)).toBe(css);
			}),
		);
	});
});

describe('stripNetworkedCss', () => {
	it('decodes escaped security-sensitive selectors before policy checks', () => {
		expect(decodeCssForSecurity(':h\\6f st { color:red }')).toContain(':host');
		expect(decodeCssForSecurity('u/**/\\72l(https\\3a //example.invalid)')).toContain('url(https://');
	});

	it('keeps ordinary local theme CSS', () => {
		const css = 'h1 { color: red; }';
		expect(stripNetworkedCss(css)).toBe(css);
	});

	it('retains the complete bundled GitHub-like theme without a security warning', () => {
		const css = readFileSync(new URL('../../media/sample-styles/github-like.css', import.meta.url), 'utf8');
		const result = sanitizePreviewCss(css);
		expect(result.rejected).toBe(false);
		expect(result.css).toBe(css);
	});

	it('retains the complete bundled Obsidian Dark theme without a security warning', () => {
		const css = readFileSync(new URL('../../media/sample-styles/obsidian-dark.css', import.meta.url), 'utf8');
		const result = sanitizePreviewCss(css);
		expect(result.rejected).toBe(false);
		expect(result.css).toBe(css);
		expect(decodeCssForSecurity(css)).not.toMatch(/@import|url\s*\(/i);
	});

	it.each([
		'@import "https://example.com/theme.css";',
		'h1 { background: url(https://example.com/pixel.png); }',
		'h1 { background: URL ( "https://example.com/pixel.png" ); }',
		'h1 { background: u\\72l(https://example.com/pixel.png); }',
		'@\\69mport "https://example.com/theme.css";',
		'h1 { background-image: image-set("https://example.com/pixel.png" 1x); }',
		'h1 { background-image: -webkit-image-set("//example.com/pixel.png" 1x); }',
		'h1 { content: image("data:image/svg+xml,<svg></svg>"); }',
		'h1::after { content: "h\\74tps://example.com/pixel.png"; }',
		'h1 { background-image: image-set("ht\\\ntps://example.com/pixel.png" 1x); }',
		'h1 { background-image: image-set("ht\\\r\ntps://example.com/pixel.png" 1x); }',
	])('rejects network-bearing CSS: %s', (css) => {
		expect(stripNetworkedCss(css)).toBe('');
	});

	it('does not let comments split the network-bearing token', () => {
		expect(stripNetworkedCss('h1 { background: u/**/rl(https://example.com/x); }')).toBe('');
	});

	it('drops only unsafe rules and reports the partial rejection', () => {
		const result = sanitizePreviewCss('h1 { color: red; }\ndiv { display: none; }\np { font-weight: bold; }');
		expect(result.rejected).toBe(true);
		expect(result.css).toContain('h1 { color: red; }');
		expect(result.css).toContain('p { font-weight: bold; }');
		expect(result.css).not.toContain('div { display: none; }');
	});

	it('sanitizes nested conditional rule lists without discarding safe siblings', () => {
		const result = sanitizePreviewCss('@media (min-width: 10px) { h1 { color:red } div { opacity:0 } }');
		expect(result.rejected).toBe(true);
		expect(result.css).toContain('@media (min-width: 10px)');
		expect(result.css).toContain('h1 { color:red }');
		expect(result.css).not.toContain('opacity');
	});

	it('rejects themes beyond the byte budget before parsing rules', () => {
		const result = sanitizePreviewCss(`/*${'é'.repeat(MAX_PREVIEW_CSS_BYTES / 2)}*/`);
		expect(result).toEqual({ css: '', rejected: true });
	});

	it('bounds conditional-rule nesting without overflowing the sanitizer stack', () => {
		const source = `${'@media all {'.repeat(MAX_PREVIEW_CSS_NESTING + 2)}h1{color:red}${'}'.repeat(MAX_PREVIEW_CSS_NESTING + 2)}`;
		const result = sanitizePreviewCss(source);
		expect(result.rejected).toBe(true);
		expect(result.css.length).toBeLessThan(source.length);
	});

	it('stops after the bounded number of CSS rules', () => {
		const source = 'h1{x:y}'.repeat(MAX_PREVIEW_CSS_RULES + 1);
		const result = sanitizePreviewCss(source);
		expect(result.rejected).toBe(true);
		expect((result.css.match(/h1\{x:y\}/g) ?? [])).toHaveLength(MAX_PREVIEW_CSS_RULES);
	});

	it('handles a long comment-only tail without regexp backtracking', () => {
		const tail = `${' /* safe */'.repeat(20_000)} `;
		const result = sanitizePreviewCss(`h1{color:red}${tail}`);
		expect(result).toEqual({ css: `h1{color:red}${tail}`, rejected: false });
	});

	it('rejects an unterminated trailing comment', () => {
		expect(sanitizePreviewCss('h1{color:red} /*')).toEqual({ css: 'h1{color:red}', rejected: true });
	});

	it.each([
		'.cm-search { display: none; }',
		'.mlp-mermaid-toolbar { opacity: 0; }',
		'h1 { position: fixed; }',
		'h1 { --overlay-position: fixed; position: var(--overlay-position); }',
		'h1 { z-index: 9999; }',
		'div { opacity: 0; }',
		'div { filter: opacity(0); }',
		'div { -webkit-filter: opacity(0); }',
		'div { transform: scale(100); }',
		'div { scale: 100; }',
		'div { clip-path: inset(100%); }',
		'div { -webkit-mask: none; }',
		'div { all: initial; }',
		'div { overflow: hidden; }',
		'div { color: transparent; }',
		'div { font-size: 0; }',
		'div { font: 0 sans-serif; }',
		'* { color: transparent; }',
		'@keyframes cover { from { opacity: 0 } to { opacity: 1 } }',
	])('rejects CSS capable of hiding or impersonating controls: %s', (css) => {
		expect(stripNetworkedCss(css)).toBe('');
	});

	it.each([
		'h1 { body:has(&) { display: none; } }',
		'h1 { .mlp-mermaid-toolbar & { position: fixed; z-index: 9999; } }',
		'h1 { @media all { body:has(&) { opacity: 0; } } }',
	])('rejects nested CSS that can escape selector scoping: %s', (css) => {
		expect(stripNetworkedCss(css)).toBe('');
	});

	it('does not mistake braces inside a declaration string for nested CSS', () => {
		const css = 'code::before { content: "{"; color: red; }';
		expect(stripNetworkedCss(css)).toBe(css);
	});
});

describe('scopePreviewCss', () => {
	it('scopes ordinary and adapted selectors beneath the document content', () => {
		expect(scopePreviewCss('h1, table { color: red; }')).toContain(
			'#mlp-root .cm-content h1, #mlp-root .cm-content table',
		);
		expect(scopePreviewCss('.cm-editor .cm-content { color: red; }')).toContain(
			'#mlp-root .cm-content',
		);
	});

	it('keeps VS Code theme gates as ancestors of the preview root', () => {
		expect(scopePreviewCss('body.vscode-dark .cm-line { color: white; }')).toContain(
			'body.vscode-dark #mlp-root .cm-content .cm-line',
		);
	});
});
