# Callout QA — September 23, 2026

## Scope

Tested the extension-owned Markdown Live Preview renderer on macOS using its
real browser bundle and stylesheet, plus an isolated VS Code extension host.
All content changes used disposable QA documents, not personal notes.

The family matrix covers 29 standard types, aliases, and fallback examples in
both Editing and Locked modes: note, notes, abstract, summary, tldr, info, todo,
tip, hint, important, success, check, done, question, help, faq, warning, caution,
attention, failure, fail, missing, danger, error, bug, example, quote, cite, and
custom-type. Uppercase markers, default/custom/empty titles, malformed markers,
hostile title text, nested panels, and adjacent panels are included.

## Interactions and objects

- Mouse folding and keyboard Enter/Space folding; nested fold independence;
  folding through unrelated edits and source-marker changes.
- Bullets, sub-bullets, ordered lists, tasks, Tab/Shift+Tab, and multi-line
  indentation. Locked content and code-like list text remain unchanged.
- Paragraph additions, replacements, and deletion using keyboard selections.
- Table cell changes, row insertion/deletion, source reveal, and preserved quote
  prefixes. Cell Enter/Escape must not unexpectedly switch the table to source.
- Mermaid, draw.io, eight-line code blocks, inline/display math, emphasis,
  highlights, links, and task completion inside one callout.
- Repeated rich-source replacement, complete deletion, and recreation, with
  exact Markdown comparisons and updated diagram labels.
- Code copying excludes quote prefixes; task completion receives strikethrough.
- Native VS Code table/task edits reach disk; folding does not change file bytes.
- Base and Obsidian-style theme panel colors, including nested callout colors.

Reusable fixtures are in `test/fixtures/callout-qa/`. Browser regressions are in
`test/e2e/calloutQa.spec.ts`; desktop coverage is in
`test/integration/focusedDesktop.test.ts`.

## Issues fixed

1. Quoted tables stayed raw instead of becoming editable rendered tables.
2. Folding stopped at block widgets and reset after unrelated edits. It now uses
   CodeMirror state and block replacement rather than hiding DOM siblings.
3. Tables, diagrams, and math lost the surrounding panel hue. Nested callouts
   could inherit an outer callout's color according to stylesheet order.
4. Quoted task items did not get completed-task strikethrough.
5. Copying quoted code included Markdown quote markers.
6. Tab indented the quote rather than its bullet content.
7. Quoted display math stayed raw; dollar expressions inside quoted code could
   be misidentified as math.
8. Finishing/canceling a table cell edit could accidentally reveal raw source.

## Verification

- Unit suite: 1,001 passing tests.
- Full browser regression suite: 371 passing tests, including 72 new callout cases.
- Focused desktop integration suite: 21 passing tests.
- Type checking, dependency policy, and US English checks.
- Dependency audit: zero known vulnerabilities reported by npm at test time.
- Packaged VSIX verification passed. Isolated installed-package smoke checks
  passed: 9 trusted, 5 restricted, and 1 disabled-extension check. Other cases
  are intentionally skipped when inapplicable to the current smoke profile.

The tests retain the existing HTML/SVG/math sanitization and network restrictions.
Hostile callout titles remain text, never executable HTML. No remote resources,
accounts, uploads, or new privileges were introduced by these changes.

## Limits and follow-up

This is a bounded, reproducible matrix, not a claim to test every possible
Markdown combination. Native VS Code Markdown Editor/Preview behavior is not
owned by this renderer, and Windows/Linux desktop interaction was not retested
in this macOS session. It is not an independent full security assessment.

Quoted display math currently requires consistent quote prefixes on its opening,
body, and closing lines. Per-editor folding state is temporary; reopening follows
the authored fold marker. Arbitrary raw HTML remains inert. Broader accessibility
and native Obsidian comparison testing remain separate QA activities.
