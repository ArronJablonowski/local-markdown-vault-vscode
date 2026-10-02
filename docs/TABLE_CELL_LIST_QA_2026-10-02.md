# Table Cell List QA

## Findings and fixes

The reported table displayed literal `<ul><li>...</li></ul>` instead of bullets.
Live Preview previously supported safe line breaks in cells, but not list
structure. It now renders balanced, attribute-free unordered and ordered lists
in table headers, table bodies, and embedded tables. Nested unordered lists use
disc, circle, and square markers with compact spacing and aligned indentation.
Existing horizontal scrolling and optional sticky headers are preserved.

Testing also reproduced an unchanged-edit bug: pressing Enter after F2 could
immediately reopen the cell's raw source. The table keyboard handler now ignores
an event already consumed by the cell editor. Enter completes the edit without
rewriting the source or adding an undo entry.

Saved Markdown remains authoritative. Editing, canceling, copying, neighboring
cell changes, and table operations do not rebuild list source from rendered DOM.
Source mode still displays the original tags.

## Security boundaries

The change does not enable general HTML rendering. A dedicated parser accepts
only valid `ul`, `ol`, and `li` relationships without attributes. It validates the
entire cell before creating any list DOM. Text uses the existing safe inline
renderer and existing link/image authorization hooks; no HTML injection API,
remote service, or new dependency is introduced.

Malformed, incomplete, attributed, or oversized list structures fall back to
literal source. Code spans, fenced examples, escaped tags, comments, and link
labels are not interpreted as structural lists. Other HTML remains inert.
Parsing is bounded to 65,536 UTF-16 code units, 1,000 opening list/item nodes,
and 32 simultaneously open elements per cell.

Tests cover event attributes, unsafe URLs, remote images, scripts, SVG,
malformed nesting, literal examples, and exact/over-limit boundaries. These
checks support the stated boundaries; they are not a guarantee against every
possible security or storage failure.

## Verification

| Check | Result |
| --- | --- |
| Unit tests | 1,794 passed across 137 files |
| Complete development browser suite | 776 passed; 5 OS-clipboard checks passed separately on production |
| Focused production browser regression | 156 passed: 12 new and 40 existing table checks, each repeated three times |
| Native macOS production UI | 11 passed in VS Code 1.139.1; 11 exact source-and-disk checks; no page/editor errors |
| Source and test type checking | Passed |
| Dependency checks | Lockfile policy passed; npm audit reported no known vulnerabilities |
| Package validation | Passed |
| Installed-package smoke tests | 16 passed across trusted, restricted, and disabled profiles on the final rerun; see intermittent failure below |
| macOS installation | All 62 installed payload files matched the release archive |
| Native Linux | Pending: Spark SSH connections timed out; no remote files changed |

Browser coverage includes default and Obsidian themes, nested and ordered lists,
edit/cancel/copy/undo, embedded tables, malformed markup, and a 45-row, eight-column
table with large list cells. Sticky-header geometry is checked while scrolling
vertically and horizontally.

The native Mac runner uses keyboard and mouse interactions in a disposable VS
Code profile: F2, Enter, Escape, typed list additions, backspace deletions,
neighboring edits, source controls, locking, and real copy/paste. Every save
checkpoint compares the complete source and file on disk. It preserves and
verifies restoration of the user's clipboard. Screenshots were reviewed for
bullet alignment, nesting, spacing, and clipping. No personal notes were edited.

The Linux runner now contains 24 cases, including two new list regressions.
Its syntax and language checks passed, but the new cases and updated installation
could not run because the DGX Spark was unreachable. Native Windows testing was
not performed in this review.

One final smoke run timed out discovering the built-in Markdown Preview table
before it could assert the sticky-header setting. The earlier run and an
unchanged rerun both passed all 16 cases. This is an unresolved intermittent
preview-discovery failure, not evidence that its cause was fixed. The failure
and rerun logs are retained as `/tmp/mdlp-table-lists-release-vsix.log` and
`/tmp/mdlp-table-lists-release-vsix-retry.log`. No assertion was weakened.

## Reproduction and evidence

```sh
npm test
npm run compile
npx playwright test test/e2e/tableCellLists.spec.ts --workers=1
npm run test:ui:table-lists
npm run package
npm run test:vsix
```

Run native clipboard tests serially, without competing copy/paste activity.
The new list tests live in `src/webview-editor/tableCellLists.test.ts`,
`test/e2e/tableCellLists.spec.ts`, and `scripts/run-table-list-ui-qa.mjs`.

Local evidence is retained under:

- `.vscode-test/table-lists-full-browser-2026-10-02`
- `.vscode-test/table-cell-lists-production-2026-10-02`
- `.vscode-test/table-lists-native-production-2026-10-02`
- `.vscode-test/table-lists-native-browser-2026-10-02`

The native report contains all 11 source/disk hashes and clipboard restoration
confirmation. Earlier failing runs are retained separately. The release archive
is `releases/local-markdown-vault-0.2.0.vsix`; its final checksum is recorded in
`releases/SHA256SUMS`.

The final archive's SHA256 is
`a4b9184a355e347b27db321edbebd1aa9a531bb499a25eec6de97e0fbf0bdb33`.
All 30 compiled payloads match the production build used for the native and
focused browser tests; final repackaging changed README security wording only.
The Mac installation was compared byte-for-byte with the archive, allowing only
the installer's `__metadata` field in `package.json`. Existing windows were not
reloaded. Use **Developer: Reload Window** to activate the update.
