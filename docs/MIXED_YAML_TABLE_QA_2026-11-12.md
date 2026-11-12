# Mixed YAML, table, and callout QA

## Confirmed issues and fixes

1. **Column resizing jumped in the wrong direction.** Natural column widths
   outside 64–2,000 pixels snapped into that range on the first gesture. Right
   Arrow could shrink a wide column; Left Arrow could enlarge a small one.
   Resize limits now include the column's measured starting dimensions. Mouse
   and keyboard gestures preserve their direction, reversing restores the
   starting width, and accessible minimum/maximum values match the controls.
   Double-click resets both widths and remembered limits. Resizing remains
   view-only and does not rewrite Markdown.
2. **HTML formatting inside table list items appeared literally.** Screenshot
   inspection exposed visible `<strong>` tags in a nested list. The bounded
   list parser now accepts balanced, attribute-free `strong`, `em`, `b`, `i`,
   `u`, `s`, `del`, `mark`, `sub`, `sup`, and `kbd` elements inside list items.
   Elements are constructed explicitly; no source HTML is inserted into the
   DOM. Attributes, active HTML, malformed structure, excessive depth, escaped
   examples, and code examples remain inert. Existing source, node, and depth
   budgets also cover formatting elements.

## New coverage

Added 91 browser cases:

- 60 combinations of plain notes, callouts, nested callouts, and list-contained
  callouts, with collapsed YAML, checkboxes, sub-bullets, and independent tables.
  Cells mix Markdown formatting, HTML lists, line breaks, Unicode, links, math
  syntax, tags, emoji syntax, and footnote references. Tests type content, select
  it, delete it, restore it, resize columns, fold sections, and verify source.
- Nine mouse/keyboard resize cases for oversized content and small theme sizes,
  including reverse gestures and accessible bounds.
- Six opening/copy tests for 1,000-, 8,000-, and 20,000-line YAML blocks, both
  standalone and inside callouts. Copy must include the complete source.
- Sixteen formatting/security combinations in editing and locked modes, covering
  scripts, images, SVG, event handlers, CSS impersonation, command attributes,
  encoded tags, code spans, and nesting limits. No script execution or network
  requests are allowed.

Twenty new unit cases cover HTML formatting and its rejection boundaries. A new
installed-VSIX regression combines oversized columns, HTML lists, collapsed
YAML, and a callout while checking the original file bytes.

## Results and limits

- Type checking and all 2,405 deterministic unit tests passed.
- The 2,924-case browser run passed 2,916 cases and identified the eight new HTML
  formatting failures. After fixing that issue, all 1,044 affected-area browser
  tests passed, including those failures and all 91 new browser cases.
- Before/after screenshots confirmed that table list emphasis renders without
  literal tags and that row layout updates with the changed content.
- Row heights grow and shrink automatically with wrapping and cell edits.
  Manual row-height dragging is still unavailable.
- Dependency auditing reported zero vulnerabilities. Dependency policy and US
  English checks passed; no dependency changes were required.
- Final installed-VSIX checks passed: 22 trusted, 17 restricted, and one
  disabled-extension case. The new resize/formatting regression and the existing
  saved Undo/Redo regression ran without exclusions.

An earlier native attempt intermittently failed to locate a newly opened YAML
editor. The final complete run passed. The frame-discovery assertion now records
the active tab and observed editor documents on failure; this intermittent
lookup problem is not claimed to be permanently resolved. The previously
reported Undo/Redo failure did not reproduce during this round. No history
algorithm was changed, and its regression remains enabled.

Browser tests drive the real webview bundle with keyboard and mouse events but
simulate the host acknowledgment channel. Installed-VSIX tests separately check
VS Code behavior and on-disk content. This round runs on macOS and Chromium;
it does not constitute a new native Windows or Ubuntu certification.
