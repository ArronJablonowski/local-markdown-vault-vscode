# Table resizing during mixed Markdown redrafts

## Confirmed bug

A naturally wide column could resize correctly until a neighboring cell was
edited. That edit rebuilt the table widget and discarded its original resize
limits. The next reverse resize stopped at the reduced width instead of returning
to the starting width. A similar issue affected naturally narrow theme-sized
columns and their minimum limit.

The original 24 mixed-content redraft cases reproduced the problem. The previous
installed VSIX also failed the native regression with: `Cell editing discarded
the original resize bounds`.

## Fix

Resize limits now follow immutable width snapshots through widget replacement,
source offset mapping, and compatible table rewrites. A private weak association
stores copied numeric limits alongside those snapshots. This keeps the existing
width-state interface and Markdown files unchanged, and allows unused metadata
to be collected. Reused DOM restores the surviving table's own limits; resetting
automatic widths clears the local limits.

## New tests

Added 34 browser cases:

- 24 combinations of plain tables, callouts, nested callouts, and list-contained
  callouts, with collapsed YAML, checkboxes, sub-bullets, dark/light themes, and
  plain, Markdown, or HTML-list cell content. Keyboard redrafts replace and
  delete content, restore the exact source, reverse column resizing, and check
  accessible bounds. Row heights must grow with added content and shrink after
  it is removed.
- Four small-theme cases check that minimum widths survive editing.
- Six structural cases exercise row insertion, row addition, and sorting inside
  and outside callouts.

The installed-VSIX regression also edits and saves a neighboring cell, then
checks the restored width. It first verifies that resizing alone leaves source
bytes unchanged.

## Results

- All 34 new browser scenarios passed after the fix.
- The complete browser suite passed all 2,974 cases.
- All 2,416 deterministic unit tests and type checking passed.
- All 58 installed-VSIX checks passed: 31 trusted, 26 restricted, and one
  disabled-extension case. The previously failing native resize/redraft check
  passed in both editing profiles; no tests were excluded.
- Dependency auditing reported zero vulnerabilities. Dependency policy and US
  English checks passed.

## Scope

Row heights remain automatic; manual height dragging was not added. The change
does not add settings, dependencies, network access, or persisted note metadata.
Native checks run on macOS. Browser coverage does not constitute a new native
Windows or Ubuntu certification.
