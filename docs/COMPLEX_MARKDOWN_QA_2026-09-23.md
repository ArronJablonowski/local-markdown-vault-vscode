# Complex Markdown QA — September 23, 2026

## Scope

Tested the custom Markdown Live Preview in Chromium and real VS Code 1.139.0 on
macOS. Tests use disposable notes and profiles, not personal vault content.
Editing and Locked modes are included. Native Markdown Editor, Text Editor,
and Markdown Preview have separate integration/regression checks; the extension
does not own VS Code's native Markdown Editor implementation.

## Reusable fixtures

The four primary notes in `test/fixtures/complex-qa` are intentionally mixed:

| Note | Main stress cases |
| --- | --- |
| `01-research-workbench.md` | Properties, inline styles, table editing, tasks, math, footnotes, Mermaid entity tables, multi-page draw.io, long code |
| `02-linked-diagram-atlas.md` | Wikilinks, local images and embeds, referenced draw.io, flow/sequence/timeline/entity diagrams, nested diagrams |
| `03-long-project-review.md` | 800-cell table, callout families, long-note scrolling, tasks, code and diagrams |
| `04-editing-boundaries.md` | Six heading levels, inert HTML, nested lists/tasks, tables, diagrams, code, and a final independent paragraph |

Supporting notes and assets are checked in beside them. Copy the entire folder
to a disposable vault to preserve its relative references. The existing
100-note comparison corpus and specialized advanced/security fixtures remain
available; these four notes add combined-feature stress rather than replacing them.

## Coverage

- Full-note scrolling in Editing and Locked modes, without document mutation,
  uncaught rendering errors, or unexpected webview network requests.
- Properties, bold/italic/strikethrough/highlights, headings, lists, task states,
  tags, links, local images, wikilinks and embeds, callouts, math, footnotes,
  code copy/folding, tables, and diagrams through new and existing tests.
- Ten Mermaid diagram families, including entity relationship tables; light
  and dark diagram screenshots, labels/connectors, pan/zoom/reset/source.
- Uncompressed draw.io XML, local file references, multiple pages, source
  controls, and external file changes. Compressed draw.io remains unsupported.
- Table alignment, safe line breaks, editing/cancel/structural controls,
  scrolling/sticky headers, selection/copy/cut/delete, and source transitions.
- Real system clipboard, keyboard shortcuts, mouse selections, automatic save,
  undo/redo, mode switching, vault moves/link rewrites, and case-only renames.
- Existing hostile Markdown, SVG, YAML, URL, and Workspace Trust regressions.

## Product fixes

1. Wide tables inside note embeds could stretch the entire editor. Give each
   embedded table an accessible horizontal scroll region.
2. Embedded tables ignored alignment and could have inconsistent cell counts.
   Respect separator alignment, pad missing cells, ignore excess cells, and use
   semantic column headers and table sections.
3. Nested Mermaid/draw.io fences did not render; reading just the first parsed
   code fragment would also truncate them. Collect all parsed code fragments,
   allow safe quote/indent prefixes, and preserve the source-button caret target.
   Fences sharing a line with a list marker remain source text: put the opening
   fence on its own indented line. Existing diagram sanitization and limits remain
   in effect.

## Test reliability

The browser harness now supplies VS Code's actual light/dark body classes, so
diagram theme checks exercise the correct palette. The native Markdown Editor
typing test now uses the macOS end-of-line shortcut and a 40 ms typing cadence;
zero-delay synthetic typing had lost characters in VS Code's built-in editor.
Repeated sticky-header tests also exposed a stale test scroll offset: after
CodeMirror materialized the second table, the test occasionally scrolled beyond
its bottom. Captured geometry confirmed the header was correctly hidden there.
The test now waits for its intended in-table position before checking the header.
Installed-app UI tests run separately from other desktop profiles to avoid focus
being stolen while entering names.

## Validation results

- 980 deterministic unit tests passed.
- 271 browser interaction/rendering tests passed.
- The corrected multi-table sticky-header test passed 50 repeated cases.
- 85 standard VS Code integration tests passed; 18 mode-specific cases were
  skipped in that runner and use separate profiles/runners.
- 19 focused desktop interaction tests and 4 Restricted Mode tests passed.
- Packaged VSIX checks passed in clean trusted, restricted, and disabled profiles.
- Installed-app QA passed note/folder creation, advanced Markdown entry,
  autosave, formatting, rename, move, canceled trash, and confirmed folder trash.
- Dependency policy and US English checks passed. The npm audit returned zero
  known vulnerabilities at the time of this run.

## Limits

Passing finite fixtures cannot establish perfect rendering for every Markdown
combination or every draw.io shape. This run is not live Windows/Linux testing,
a new Obsidian side-by-side comparison, or a complete independent security audit.
Native-editor behavior and unsupported formats are not represented as custom
Live Preview fixes.
