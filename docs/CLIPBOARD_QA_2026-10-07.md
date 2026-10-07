# Clipboard QA October 7 2026

This session reproduced and corrected clipboard failures in Markdown Live
Preview, starting from commit `0a300859eb70a168361c455f55f3ef940cbfc972`.
Native testing used macOS, VS Code 1.139.1 arm64, an isolated profile, and
disposable notes. Personal vault files and settings were not changed.

## Corrected failures

| Failure | Correction | Regression coverage |
| --- | --- | --- |
| Command+C and Command+X did nothing even when Edit menu Copy worked. | Invoke the synchronous native command during the trusted gesture, observe delivered clipboard events before other handlers, and prevent duplicate commands. | Shortcut unit tests, native VS Code to TextEdit transfer, command-dispatch tests. |
| Whole-table copying from the toolbar could copy only one caret line; locked selections could disappear during redraw. | Focus the editor, back the table selection with exact source offsets, and reject a stale structural selection after subsequent navigation or Select All. | Pointer and keyboard activation, repeated modifier presses, dirty cells, multiple tables, locked notes, and native copy/cut/paste. |
| Pasting over one word in a rendered cell replaced the entire cell. Spreadsheet data could overwrite neighboring content despite a partial selection. | Restore exact plain-text selection offsets before replacement. Refuse ambiguous formatted or partial-grid selections before mutation and explain source editing with F2. | Forward/backward mouse drags, Unicode offsets, rich cells, lists, images, grid formats, follow-on typing, and F2 retry. |
| Spreadsheet-shaped text pasted into source could become a Markdown table while large-note parsing lagged. | Use one bounded parser budget, inspect both selection endpoints, and fall back to literal text when syntax is unknown. Protect code, table source, frontmatter, HTML tags, comments, and processing instructions. | Large cold-parser notes, unfinished/oversized YAML, ordinary prose controls, grid-only rejection, lock and save-queue cases. |
| Find shortcuts could operate on a previous whole-table selection instead of the search field. | Require the table action to originate in the document, excluding nested editable controls. | Copy, Cut, Delete, and Backspace in both modes, then returning to copy the table. All eight cases failed before the fix. |
| A property field accepted newer input while preserving its previous value, but its latest text was not journaled. Correcting it back to the original value could also leave editing locked after a failed old request. | Continue bounded snapshots for that same field and coalesce a newer recovery copy after the previous acknowledgment. Leave unrelated conflict recovery intact and unlock when the corrected field needs no recovery. | Delayed and failed acknowledgments, blur, retry, a return to the original value, and unrelated source conflicts. |

Clipboard HTML is not imported. The changes do not add network access,
clipboard permissions, asynchronous clipboard reads, or a host-side clipboard
replay. Existing document, image, spreadsheet, lock, and host-message checks
remain in place.

## Native workflows

The native session used actual Command+C, Command+X, Command+V, and
Command+Shift+V, mouse dragging, arrow-based selection, and application switches.
Sources and destinations included the editor itself, a new TextEdit document
with plain/rich text, and a public page in native Chrome. Browser-session
clipboard APIs were not counted as operating-system clipboard evidence.

Confirmed workflows included:

- Copy into TextEdit; cut and immediate paste; copy followed by deletion and
  immediate paste; exact multiline and Unicode restoration.
- Rich external text, tabs, spreadsheet conversion, and literal paste without
  formatting. Spreadsheet-shaped text stayed literal inside fenced code.
- Mouse-selecting only `Beta` in `Alpha Beta Omega` and pasting `New` produced
  `Alpha New Omega`, preserving the other cell and surrounding paragraphs.
- Full-table copy, cut, and exact restoration; locked copy without document
  mutation; Select All superseding an earlier table selection.
- Copy/paste within Find without changing the document, plus reload verification.

All 18 exact source/disk checks, including baseline and fixed-build checks,
passed with delayed rechecks. The native helper recorded no page errors or
editor errors. Evidence remains locally under
`.vscode-test/clipboard-native-2026-10-07`; the disposable vault/profile were
removed when the runner finished. The TextEdit sample was saved in that
artifact folder rather than modifying or discarding another open document.

A follow-up native session added six exact source/disk checks under
`.vscode-test/clipboard-final-native-2026-10-07`. After reloading the final
bundle, Find copy/delete/paste left the table unchanged, whole-table cut/paste
restored its exact source, and locked-table copying transferred all 51 source
bytes into a separate blank note without mutating the locked note. Both native
sessions completed without page errors or editor errors.

One reload displayed a recovery warning. Inspection found a preserved
intermediate draft replacing selected `Unicode` with `De`, the opening letters
of `Developer: Reload Window`. The saved file still held the expected text.
This is consistent with the test driver typing before the command palette
received focus, not demonstrated save truncation. Repeating the reload with
explicit palette-focus checks preserved the exact 65-byte note and produced
no recovery warning. Recovery/save code was not changed to suppress it.

## Verification results

- All 2,001 unit tests passed across 143 files. A parallel run first missed
  the 500 ms broken-link performance gate at 516 ms; the quiet full rerun passed
  without code or threshold changes.
- All 1,995 deterministic tests passed across 142 files.
- The final minified production bundle passed all 1,009 non-native-clipboard
  browser tests and all five real-browser clipboard cases: 1,014 unique cases.
- All 13 focused command/selection browser cases passed 20 repetitions each
  with one worker, for 260 checks. These use event-local clipboard transfers
  and do not count as operating-system clipboard testing.
- The expanded 21-case command/selection suite passed five repetitions each
  after the Find fix, plus 119 related clipboard/table cases. The five final
  recovery regressions passed ten repetitions each, plus all 36 existing
  recovery/immediate-save cases.
- Production browser bundle SHA256:
  `a884a8acc84b36c49ec4da8cb8ef5680b1be52bc8dce989f537eaf0b545bcfb6`.
- Source/test type checks, US English checks, dependency policy, and whitespace
  checks passed. Packaging verified 64 archive files.
- Installed-VSIX smoke tests passed 16 applicable checks: 10 trusted, five
  restricted, and one disabled-extension check. Mode-specific cases were
  intentionally skipped in profiles where they do not apply.
- Final native-key save comparison passed all 20 cases. The strict host-API
  stress failure below remains separate and unresolved.

Source fixes were committed as `a658cc5` and `bfa1120`. The packaged VSIX is
`releases/local-markdown-vault-0.2.0.vsix`, SHA256
`afcb2e9bad3bf6cee50b5d9b4f967d00730c694f9e560f514dd8f375b0f217ff`.
It was force-installed into the local VS Code app. All 62 extension payload
files matched the archive; only VS Code's added package installation metadata
was excluded from comparison. Existing personal windows were not reloaded;
save open work and reload the window to activate the updated build.

New coverage is in `clipboardKeyDispatchQa.spec.ts`,
`clipboardLargeContextQa.spec.ts`, `clipboardOctoberQa.spec.ts`,
`recoveryPendingInputQa.spec.ts`, `clipboardShortcuts.test.ts`, and
`spreadsheetPaste.test.ts`.

## Remaining limits and dependency findings

The initial default native save integration run passed 19 tests and failed the
full-recovery-storage case. Isolated execution passed, but a preceding invalid
property recovery made the failure repeat. Closing through the extension-host
command API immediately after the final field input could leave no exact fallback
copy. This remains an unresolved intermittent failure, not a confirmed fix.
Cross-channel close/message ordering is a hypothesis; the exact upstream drop
location was not proven.

On the final production bundle, a full strict run passed all 20 cases, but three
fresh paired runs then produced one pass and two reproductions of the same
missing fallback. The passing full run therefore does not close this finding.

The same immediate action using a native Command+W key event passed the paired
reproduction and all 20 save scenarios. The strict API-close assertion remains
the default test; `MDLP_SAVE_QUOTA_UI_CLOSE=1` explicitly selects the native-key
comparison. No idle wait or weaker text assertion was added. This distinction
must remain visible when reporting save coverage.

Partial selections in formatted rendered table cells are intentionally refused
when source offsets cannot be determined safely. Press F2 and select the cell
source before retrying. Ambiguous or oversized opening YAML headers can also
disable inferred table conversion later in the note; literal text paste remains
available. These safeguards favor preserving content over guessing intent.

Native Windows/Linux, every external application, and every clipboard manager
were not exercised in this session. ChatGPT desktop and a live Excel workbook
were not fresh native sources in this pass. Native host Undo caret restoration
from the prior QA report remains separate follow-up work. Passing tests are not
a guarantee against every possible data-loss scenario.

Dependencies were not changed. The production audit reports two Low entries
for one [KaTeX advisory](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7)
propagated through Mermaid. Direct KaTeX 0.18.7 is patched; Mermaid's nested
KaTeX 0.16.47 is affected. The advisory requires existing prototype pollution;
no exploit path was demonstrated here. Strict Mermaid settings and final SVG
sanitization remain in place, but do not erase the dependency finding.

The full `security:audit` gate still fails with eight High development-tool
entries and the two Low production entries. Development findings include
`braces`, `http-cache-semantics`, and `source-map-js`. A reviewed dependency
update with diagram tests and a refreshed SBOM remains required before claiming
a clean security audit or Marketplace readiness. The audit's suggested Mermaid
downgrade was not applied to this clipboard fix.
