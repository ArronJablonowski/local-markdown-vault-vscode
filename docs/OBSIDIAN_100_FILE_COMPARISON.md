# Obsidian 100-file comparison

This comparison tests the extension-owned **Markdown Live Preview** view.
**Markdown Editor** and its **VS Code Markdown Editor** settings alias select
VS Code's separate built-in editor. The results below do not establish parity
for that built-in editor. Earlier wording incorrectly conflated these views.
The built-in Text Editor and Markdown Preview remain available; contributed
Preview copy/collapse controls are tested separately.

## Reproducible corpus

`test/fixtures/obsidian-comparison-100/` contains exactly 100 ordinary Markdown
files split evenly across ten categories:

1. Basic formatting
2. Lists and tasks
3. Links and wikilinks
4. Tables
5. Callouts and quotations
6. Properties and tags
7. Code and literals
8. Math and footnotes
9. Embeds and navigation
10. Unicode, stress, and security cases

The files range from fewer than 300 bytes to more than 20 KB. Variants increase
the amount and complexity of content without introducing random input. Run
`npm run fixtures:obsidian` to regenerate the same corpus. `manifest.json`
records the category, byte length, rendering assertions, and interaction cases
for every file.

## Test method

- Every file is mounted with the production Markdown Live Preview JavaScript
  and CSS. Tests require a visible editor, the correct note title, no browser
  exception, and no request to the hostile remote-image fixture.
- The fifth file in each category receives category-specific structural checks
  for formatting, task state, tables, callouts, properties, code controls,
  math, footnotes, embeds, and inert unsafe content.
- Keyboard tests cover selection, copy-key dispatch, insertion, undo/redo host
  requests, ordered-list continuation, list indentation, keyboard task
  toggling, completed-task strikethrough, highlight exit, and code-block exit.
- The same corpus was opened as a disposable vault in Obsidian 1.13.7 on macOS.
  Files 005, 015, 025, 035, 045, 055, 065, 075, 085, and 095 were inspected in
  Live Preview as category representatives. Additional disposable variants
  were edited for interaction checks.

## Results

| Area | Obsidian 1.13.7 | Markdown Live Preview | Result |
| --- | --- | --- | --- |
| Headings, emphasis, strikethrough, highlight, quotes | Rendered in Live Preview | Rendered with source reveal | Matched |
| Three-level bullets and ordered lists | Distinct nesting and automatic numbering | Distinct nesting and automatic numbering | Matched |
| Tasks | Pointer-operable; completed items struck through | Pointer- and keyboard-operable; completed items struck through | Matched or improved |
| Tables | Structured table rendering | Structured table rendering plus keyboard-accessible editing controls | Matched or improved |
| Callouts | Type colors, icons, nesting, and fold state | Same core type and fold behavior | Matched |
| Properties and tags | Typed properties and tag presentation | Typed properties and local tag indexing | Matched for supported property types |
| Fenced code | Language label and Copy control, including single-line blocks | Language-aware highlighting and Copy control on every fenced block | Matched |
| Math and footnotes | Inline/block math and navigable footnotes | Inline/block math and navigable footnotes | Matched |
| Wikilinks and embeds | Resolved local navigation and inline note embeds | Vault-local resolution and bounded, cycle-safe embeds | Matched with security limits |
| Unicode and long content | Rendered without data loss in sampled notes | All 100 notes rendered without an exception | Matched |

## Interaction observations

- Pressing Return at the end of an ordered item in Obsidian continued with the
  next number; Markdown Live Preview does the same.
- Pressing Tab on a nested list item in Obsidian indented it; Markdown Live
  Preview does the same and changes the visual marker by nesting level.
- Clicking an incomplete task in Obsidian updated the source marker and applied
  strikethrough. Pointer and keyboard activation do both in Markdown Live
  Preview and trigger the extension's automatic-save path.
- Native text selection plus Command-C and Command-V worked in the disposable
  Obsidian vault. Markdown Live Preview preserves normal CodeMirror selection,
  copy, paste, undo, and redo behavior; browser automation verifies the
  selection and host command boundaries.
- Obsidian keeps two Returns typed inside a populated fenced block inside that
  block. Markdown Live Preview also supports normal in-block Return, but adds
  Command-Return and a blank-final-line escape because users explicitly need a
  reliable way to leave a code block.

## Intentional security differences

Exact visual cloning stops where it would weaken the extension's threat model:

- Obsidian rendered the raw HTML button in fixture 095 as a real button. Local
  Markdown Vault displays the source as inert text and never creates the button.
- Remote images remain blocked by default; the tracking-pixel fixture produces
  no web request in the extension.
- Unsafe `javascript:`, `command:`, encoded traversal, and out-of-vault targets
  never become executable navigation.
- Mermaid and local embeds remain bounded and sanitized.

These are passing compatibility results, not gaps. Security guarantees take
precedence over pixel-level equivalence.

## Automated entry points

- `npm run fixtures:obsidian`
- `npx playwright test test/e2e/obsidian100Compatibility.spec.ts`
- `npm run test:e2e`
