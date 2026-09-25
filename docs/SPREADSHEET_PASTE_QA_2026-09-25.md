# Spreadsheet paste — September 25, 2026

## Scope

Markdown Live Preview converts copied Excel-style TSV and structured CSV into
ordinary local Markdown tables. A body paste creates a table with a first-row
header. A rendered-cell paste overwrites a rectangle, expands dimensions, and
preserves unaffected source cells, alignment, and container prefixes.

Ambiguous plain single-column data and single-row CSV remain ordinary text;
explicit CSV/TSV clipboard MIME types can represent those shapes. This feature
does not import spreadsheet files directly, execute formulas/macros, or retain
Excel formatting/merged-cell layout. Tests use Excel-compatible clipboard text;
they do not claim automated testing inside Microsoft Excel itself.

## Safety and saving

- No dependency, network permission, filesystem permission, or host clipboard-read
  capability was added. Pasting is initiated by the user's normal paste gesture.
- Clipboard HTML is never imported. Values are escaped as literal Markdown;
  generated line breaks and numeric whitespace references are constructed by
  trusted code. Numeric references render as text nodes, never parsed HTML.
- Quoted CSV/TSV parsing and expanded-table dimensions are bounded before grid
  allocation. Serialized output is bounded before mutation, including existing
  table content, so one table paste fits in one host edit message.
- Removed quadratic backtracking from the Markdown-versus-CSV detector. A
  200,000-space adversarial record that previously exceeded two seconds now
  completes in approximately five milliseconds on the reference machine. A
  child-process timeout regression checks the actual parser without risking a
  frozen test runner.
- Limits: 256 KiB input, 1,000 rows, 200 columns, 10,000 expanded cells, and 512 KiB
  output, in addition to the existing 20 MiB document limit.
- An ordered edit queue isolates table paste from preceding/following typing,
  even with delayed acknowledgments. Saving, Undo, and Redo drain in order.
  Queued edit groups and retained insertion estimates are bounded.
- Rejected cell commits retain the active draft instead of clearing it before
  transaction acceptance. Whole-table identity checks reject stale widget writes.

## Tab-switch save race

The native clipboard test reproduced an accepted cell paste disappearing during
an immediate switch to another pinned tab. Event traces confirmed that the paste
handler completed and the expanded table rendered before the old iframe became
hidden; both the host document and disk nevertheless retained their original
bytes. This was not an undelivered clipboard event or a preview-tab replacement.

The editor now retains hidden editable webviews, so hiding a tab does not destroy
its outgoing message transport. The host retains the ready handshake until an
actual security-policy reload and continues deferring background syntax
highlighting and metadata delivery. Style-preview contexts remain disposable.
Native testing also established that a retained hidden VS Code iframe can still
report `document.hidden === false`. A strictly validated host `panelVisibility`
message therefore controls background diagram work, rather than relying only
on the browser's Page Visibility API. New Mermaid and draw.io stages defer while
hidden, and widget destruction cancels deferred stages. Mermaid's 16-entry queue
remains bounded; queued deadlines pause while hidden, but an already-running
render still has its two-second deadline. Late/deferred errors stay contained in
the diagram error UI, and DOM-identity cleanup handles CodeMirror widget reuse.
This is an intentional memory-versus-save-safety tradeoff; document, message,
queue, parser, and recovery limits remain enforced. No CSP, resource-root, trust,
or network restriction is relaxed. Retention is not a guarantee against an
abrupt process termination or a tab close before any save message reaches VS Code.
The native regression keeps the immediate switch without waiting for a save or
adding a paste-event delivery barrier.

## Verification

Reference: macOS 27.0, VS Code 1.139.0, Node.js 26.8.2. Native tests use disposable
profiles and notes; clipboard contents are restored afterward. Windows and Linux
native clipboard behavior was not exercised in this session.

- TypeScript source and integration-test compilation passed.
- Unit suite: 1,402 tests across 115 files passed, including seeded quoted CSV/TSV
  round trips, literal-value escaping, rectangular expansion, ordered edit groups,
  limits, hidden-tab synchronization, and visibility-controlled rendering.
- Browser suite against the production bundle: 519 tests passed, including 31
  spreadsheet-paste cases and regressions for rejected widget commits and
  host-driven hidden-panel diagram suspension.
- Native VS Code UI suite: 41 tests passed. Real OS clipboard pastes created and
  expanded tables, saved exact Markdown, and undid in one step. The cell-paste
  case repeated immediate switching three times without a save/event barrier.
- US English and dependency-policy checks passed. `npm audit --audit-level=high`
  reported zero vulnerabilities. No dependencies were added or changed.
- Production VSIX structural verification passed: 63 archive entries; 3,711,869
  compressed bytes and 14,490,646 uncompressed bytes.
- Installed-package smoke suite: 15 tests passed across trusted, restricted, and
  extension-disabled profiles. Each profile intentionally skips tests belonging
  to the other modes.

- Native save-durability suite: 20 tests passed against the final production
  bundle, covering rapid typing, immediate switching/closing, uncommitted table
  and property drafts, slow and denied saves, exact Unicode/BOM/CRLF bytes,
  recovery capacity, Undo/Redo, and autosave-disabled manual saves.
- Installed the final VSIX in the user's VS Code and verified all 61 extension
  payload files against the tested archive (allowing VS Code's manifest metadata).
  Reload Window is required to activate the replacement in an already open app.

One final save-suite attempt timed out opening a property input with the mouse,
before typing or switching tabs; the original host document remained unchanged
and clean. A diagnostic repeat passed all 20 cases. The save-focused case now
uses the documented F2 action on its verified focused value cell; separate native
UI coverage retains double-click property editing. No production mouse-handler
fix is claimed for the intermittent activation timeout. Immediate switching and
exact-content assertions remain unchanged.
