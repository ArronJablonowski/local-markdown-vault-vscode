# Large tables and emoji menu QA - September 24, 2026

## Sticky headers

Two browser scenarios use the production editor bundle in editing and locked
modes. Each document contains three tables: 500 rows by 12 columns, 200 rows by
30 columns, and 1,000 rows by 8 columns (20,000 body cells in total).

The tests search between tables and return to the first table, scroll to 10%,
50%, and 90% of each table, resize the viewport to 450 and 1,200 pixels, and
scroll horizontally to the left, middle, far right, and back. They compare both
the left edge and width of every header column with its body column within two
CSS pixels. A custom theme overrides table layout and padding. All 192 sampled
geometry checks passed, no browser exceptions occurred, and the final screenshot
was visually inspected. No further sticky-header defect was found in this pass.

These tests supplement the existing wheel-over-header, multiple-table, editing,
source-view, and resizing regressions. They do not establish performance limits
for arbitrary table sizes or inspect every row individually.

## Emoji menu defect and fix

The disappearing menu was reproduced by typing `:s`, then delivering a background
vault-index refresh. The refresh dispatched a selection transaction even though
the selection had not changed. CodeMirror interprets that as a user selection
operation and dismisses autocomplete.

Background vault updates, chunked vault updates, and draw.io invalidation now
dispatch a dedicated rendering-refresh effect. Block, inline, and wikilink
decorations still rebuild, but the cursor and completion state are left alone.
The same change also avoids dismissing wikilink completion for this reason.

A browser regression waits through all three background refresh types and then
selects the emoji with a mouse click. An isolated macOS VS Code test types the
query, verifies it on disk, checks the menu repeatedly over three seconds while
autosave/indexing run, clicks the emoji, and verifies the saved Unicode text.
Both tests passed. Existing keyboard acceptance and Unicode rendering tests
also passed. No network access or security-policy changes were introduced.

Final verification: 1,025 unit tests, 429 browser tests, the native emoji scenario,
and all 15 packaged-extension checks passed.
