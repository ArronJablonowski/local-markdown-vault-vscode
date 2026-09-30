# Large-note object-boundary QA — September 30, 2026

## Scope and method

This campaign starts from `8f41a02` and targets editing immediately above,
below, and across Markdown objects in Markdown Live Preview on macOS. Tests
use disposable notes and isolated VS Code profiles; personal notes are not
modified.

The native runner creates three mixed notes of approximately 115 KB, 285 KB,
and 485 KB, with an optional 1.9 MB end-of-file stress note. It uses individual
typed characters, keyboard shortcuts,
mouse clicks, drags, and scrolling to revise them. Read-only editor probes
measure selection and layout. Saved-text checkpoints compare the entire file
against an independently updated expected document, not just the edited line.

Objects include large tables, fenced and indented code, Mermaid entity and
flow diagrams, draw.io diagrams, nested callouts, display math, lists, and
tasks. Separate browser tests cover properties, Setext headings, horizontal
rules, nested containers, default and Obsidian-style themes, and files up to
416 KB. Mermaid entity diagrams provide table-shaped records; they are not
ordinary Markdown tables.

The editing sequences remove separators one key at a time, temporarily merge
paragraphs with object syntax, reconstruct the original Markdown, rewrite
adjacent prose, and replace mouse-selected text. Native checks include macOS
word-delete and line-delete shortcuts followed immediately by typing, Undo,
code copy/fold controls, and escaping objects at the end of a note.

Browser tests use the production webview bundle and CSS. Host-message Undo,
clipboard acknowledgments, and synthetic cancellation events are explicitly
test-harness checks, not claims of native operating-system interaction. The
native runner separately exercises real VS Code shortcuts and the system
clipboard, preserving and restoring the original clipboard text.

## Findings

Four-space and tab-indented code was parsed correctly but lacked the code box
and controls supplied for fenced code. The renderer now handles parser-owned
`CodeBlock` nodes, including one-line blocks and eight-or-more-line folding.
Copy extracts the parser's code text, excluding Markdown indentation and
quote/list prefixes while preserving indentation inside the code. Surrounding
paragraphs remain ordinary text; literal HTML inside code stays inert.

Initial background parsing of a large note could replace displayed source
with a diagram during an active mouse drag. A recorded reproduction moved a
paragraph by about 472 pixels while the mouse button remained down and
extended the selection into the following paragraph. The correction defers
presentation-only decoration changes during a primary text-selection gesture
and refreshes after release or cancellation. Document edits continue to be
accepted and rebuilt immediately. This guards parser-driven decoration changes;
it does not claim to freeze every asynchronous SVG size change.

Regression testing of that correction caught a stale painted bullet and
immediate Home/Delete reading still-hidden heading markers after a click.
Deferred presentation now refreshes before paint and before the next keyboard
command. Tests assert the first painted frame and exact source after removing
heading and inline-formatting delimiters without an intervening wait.

The first three-note native run also exposed Command+Enter inserting a blank
line inside the final fenced code block of a 285 KB note instead of escaping.
A unit reproduction confirmed that the command consulted an incomplete
syntax tree, missed the fence, and fell through to normal blank-line insertion.
An added 1.9 MB stress note showed that the original 50 ms parsing budget was
also insufficient. Explicit escape now synchronously allows up to 250 ms for
a current parser result. If that budget is exhausted, it preserves the caret
and text, consumes the shortcut, and displays an accessible warning instead
of inserting code whitespace. It never queues a later caret jump or discards
subsequent typing. Ordinary Enter remains available on a parse timeout.
Unit regressions cover closed and unfinished final fences, final blank code
lines, and unrelated prose between fences. The failure evidence is retained
separately from subsequent validation.

Rapid autosaves also made the Vault file list briefly disappear. Each content
change invalidated in-flight directory reads, which could return an empty list
even though all files still existed. Content changes now share a settled
refresh; superseded reads retry under current vault authority, exclusions,
and filesystem checks. Three attempts bound a request under continuous
external changes. Create/delete events still refresh immediately, and a
switched, disposed, or unauthorized vault still fails closed.

Final screenshot review also exposed speculative math rendering before the
parser identified code, tables, or collapsed callouts, followed by stale math
decorations after parse-only updates. Math now waits for confirmed tree
coverage and refreshes when background parsing advances. It observes the same
held-selection guard and still processes document edits immediately. Large-note
body formulas regain their rendered form after parsing without requiring an
extra click. Regression tests preserve the existing expression budgets and
exercise repeated edits next to code, tables, and callouts.

## Expected behavior versus defects

Removing blank lines or Markdown delimiters can legitimately change the
meaning of a document. Tests assert the exact intermediate source, then
restore the structure and verify that styles and widgets recover. In
particular, splitting a paragraph before indented code may trim indentation;
tests explicitly retype the intended spaces rather than count normal editor
indentation handling as a defect.

Test-only corrections included using the existing code-control label
**Switch to code mode**, counting one styled line for a Setext heading, and
waiting for a rendered object before measuring a normal drag. The separate
initial-parsing regression deliberately starts a gesture before rendering
finishes so it does not hide the confirmed mid-drag layout problem.

The final math rerun exposed a measurement-timing error in the boundary test,
not an additional editor regression. Its animation-frame callback sampled a
paragraph before CodeMirror's queued same-frame measurement. Passive sampling
after those callbacks retained the original strict geometry bounds: all 12
cases passed, with nine pre-measure outliers among 1,710 samples settling in
the same frame. The test now records both positions and saves diagnostics
before assertions; it never forces editor layout to obtain a passing result.

Rich table-cell math is an existing feature limitation: the table's inline
renderer displays dollar notation literally. This patch prevents inconsistent
speculative math in table source; it does not add table-cell math support.
The compatibility guide now states this limitation and the math resource limits.

## Reproduction and evidence

Run `npm run test:ui:object-boundary` for the native journey. It defaults to
VS Code 1.139.1, matching the installed application during this campaign.
`MDLP_QA_VSCODE_VERSION` selects another test version;
`MDLP_BOUNDARY_FIRST_ONLY=1` runs the first note;
`MDLP_BOUNDARY_LARGE_EOF=1` includes the 1.9 MB stress note; and
`MDLP_BOUNDARY_ARTIFACTS` chooses a folder under `.vscode-test/` for reports,
screenshots, and edited synthetic notes.

Browser regressions are in `objectBoundaryBlocksQa.spec.ts`,
`objectBoundaryInlineQa.spec.ts`, `objectBoundaryRevealQa.spec.ts`, and
`indentedCodeQa.spec.ts`. The native script is
`scripts/run-object-boundary-ui-qa.mjs`.

## Final native results

The final native run passed all 58 checks in VS Code 1.139.1. It used 5,029
individually typed characters, 1,309 key commands, and 461 pointer actions.
All 977 layout/selection samples retained all four Vault files. There were
no saved-text mismatches, page errors, or console errors. Samples detected no
within-word vertical jumps exceeding the runner's 8-pixel threshold; that
threshold is not a claim of pixel-perfect rendering at every moment.

| Synthetic note | Initial bytes | Initial lines | Coverage |
| --- | ---: | ---: | --- |
| Boundary report 1 | 115,090 | 3,556 | Nine object types, both boundaries, final table escape |
| Boundary report 2 | 285,593 | 8,724 | Nine object types, both boundaries, final code escape |
| Boundary report 3 | 485,622 | 14,784 | Nine object types, both boundaries, final callout escape |
| Boundary report 4 | 1,900,241 | 57,288 | Cold-parser final code escape and immediate typing |

Before Command+Enter in the largest note, background parsing had reached only
3,007 characters. Escape still placed the subsequent typed prose below the
closed code block, and the complete saved document matched the expected text.

The authoritative native report, screenshots, and synthetic notes are local
artifacts under `.vscode-test/object-boundary-final-verified-2026-09-30/`.
Earlier native evidence is retained under
`.vscode-test/object-boundary-release-2026-09-30/`.
The successful full browser run is under `.vscode-test/object-boundary-verified-browser/`;
real-clipboard cases ran separately under
`.vscode-test/object-boundary-final-clipboard/` to avoid clipboard contention.
Generated artifacts are ignored by Git. Source, reproducible tests, and this
report are committed; source fixes were backed up in `d9d12ad` and the math
follow-up in `e623633`.

## Validation gates

| Check | Result |
| --- | --- |
| TypeScript source and integration-test compilation | Passed |
| Unit tests | 1,645 passed |
| Browser suite | 665 passed: 660 regular checks and five serialized clipboard checks |
| Native boundary journey, VS Code 1.139.1 | 58 passed |
| General native integration | 99 passed; 19 intentionally pending |
| Focused desktop interactions | 47 passed |
| Save durability and failure handling | 20 passed |
| Restricted workspace integration | Four passed |
| Packaged VSIX smoke tests | 16 passed: 10 trusted, five restricted, one disabled |
| Package content verification | 64 files; no forbidden development or sensitive files |
| Dependency audit | Zero reported vulnerabilities |
| Lockfile/dependency policy, US English, and diff checks | Passed |

The general suite's pending cases require the separate packaged/restricted
profiles or a case-sensitive filesystem; they are not counted as passes.
The additional integration runs use the cached VS Code 1.140.0. Its logs
include built-in chat-provider warnings and a missing bundled ripgrep warning;
these are not extension assertions, and the complete logs are retained.
Permission-denied messages in the save suite are intentional failure injection.
The denied-write test confirms that dirty text remains recoverable and an
explicit Save succeeds after write permission is restored.

One save-suite rerun found a test-only recovery-picker mistake: the second
opening counted currently rendered rows without filtering the virtualized
list. The target draft was offscreen, not missing. Failure artifacts retained
both the unchanged original note and the exact recovered invalid property text.
The test now searches for the filename and waits for its visible focused row,
as it already did when opening the recovery copy the first time.

The changes do not enable remote resources, raw HTML execution, or broader
filesystem access. Parser waits and filesystem retries remain bounded, and
regressions cover exhausted budgets, read-only editing, disposed views,
excluded paths, and symlink changes.

## Delivery

The refreshed `releases/local-markdown-vault-0.2.0.vsix` contains 64 archive
files and passed the trusted, restricted, and disabled package checks. It was
installed in the local VS Code app. All 62 installed extension payload files
match the tested archive, allowing only VS Code's added `__metadata` manifest
field. Existing windows were not forcibly reloaded; save work and reload the
window to activate the new code in already-open tabs.

VSIX SHA-256:
`a914ea4b17497391c9aaf0a7e3dd274e2d9aeab476cc95d208303528ee35c0bc`

This campaign does not certify every Markdown combination, native Windows or
Linux interaction, or immunity from all future data loss. Exact saved-text
comparisons establish the behavior of the exercised sequences.
