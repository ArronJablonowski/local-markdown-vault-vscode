# Clipboard and Document Lock QA

This review exercises copy, cut, paste, and the Lock/Edit toggle in Markdown
Live Preview. Tests use disposable notes and isolated VS Code profiles, not
personal vault content. The review found clipboard data-integrity defects,
an asynchronous image-paste race, misleading locked-table controls, and a
large-selection rendering crash, and a caret-placement defect on short formatted
lines. The corrections preserve existing clipboard validation and local-only
attachment handling.

## Native interaction coverage

The macOS runner uses keyboard and mouse actions in VS Code, including native
clipboard events. It checks mouse selections, reversed keyboard selections,
whole-document copy, cut and immediate paste, Undo/Redo, Unicode, emoji, code
copy buttons, spreadsheet conversion, and image paste. A 265,224-byte mixed
note contains headings, lists, tasks, tables, callouts, code, Mermaid, and
draw.io fences. The runner copies that note, pastes it into another file,
replaces it by typing, and compares the complete editor source with the saved
file. It preserves and verifies the original macOS clipboard formats on exit.

Linux checks run in the DGX Spark's ARM64 VS Code under a private Xvfb display.
They use native GTK clipboard reads and real Ctrl-key gestures. The Linux
clipboard is separate from the desktop session. Both platforms test shifted
paste immediately followed by typing, without waiting between those actions.
Neither native runner disables the Electron sandbox.

Lock tests cover the mouse button, Space and Enter activation, typing, deletion,
cut, paste, history commands, tasks, table cells, image paste, copying, and
unlocking. A pending table-cell draft must commit and save when Lock is clicked.
Browser tests additionally exercise properties, dropped images, source reveal,
Find/Replace, folded objects, malformed transfers, and controlled asynchronous
read failures.

## Confirmed defects and corrections

### Preserve selected content on unsupported paste

CodeMirror could treat clipboard data without usable plain text as an empty
replacement, deleting the selection. HTML-only, unknown, and empty transfers
now leave selected Markdown intact and show a warning. Explicit CSV/TSV-only
transfers also cannot delete selected code or multiple selections when no
plain-text representation exists. Clipboard HTML remains inert and is not
imported.

### Keep copied Markdown separate from spreadsheet data

An incidental tab inside copied Markdown could cause the entire note to be
converted into a table or rejected by spreadsheet size limits. Automatic TSV
recognition now requires multiple fields in every nonempty record. A bounded
first-record check preserves clearly non-grid large notes. Explicit CSV/TSV
still uses the existing size, row, column, and cell limits.

### Deliver shifted paste once at the current selection

Native macOS testing found that Command+Shift+V did not emit a paste event.
The trusted shortcut now requests synchronous native paste when necessary,
without asynchronous clipboard reads or host key replay. A per-editor gesture
marker applies plain-text semantics only to that paste and clears on completion,
another key, key release, focus loss, or disposal. It bypasses automatic table
conversion, including multi-cell expansion inside a rendered table.

### Keep image insertion tied to the right document state

Pending image reads now track their insertion position through edits, wait for
text acknowledgments, and cancel when the destination is deleted or the editor
locks or closes. One bounded operation runs per editor, with sequential reads
and a timeout. The host checks the source version and text before attachment
creation and before insertion. If the document changes, owned attachments are
rolled back and the user is asked to retry. Failed document edits also roll
back attachments and show a warning.

Tests force version changes, closure, disposal, failed document edits, partial
attachment creation, and typing queued during image I/O. Stale queued typing
uses the existing resync or closing-draft recovery path; it is not inserted at
an outdated offset.

### Invalidate stale syntax highlighting after replacement

Native testing reproduced a stack overflow and disrupted typing after a large
selection was replaced. Old host-generated code tokens were all remapped onto
the replacement character, creating thousands of overlapping decorations.
New regressions supply host highlighting tokens explicitly; the ordinary
browser harness did not previously supply them and therefore missed the crash.
Edited code blocks now discard obsolete tokens until fresh highlighting arrives;
untouched blocks retain their mapped colors. Each visible token is emitted once,
even when folded content splits the viewport into several visible ranges.

### Remove unavailable table mutations while locked

Locked tables previously displayed mutation buttons even though the document
guard rejected their actions. Those controls are now hidden while selection,
copying, scrolling, folding, and read-only source viewing remain available.
Unlocking restores editing controls.

### Stabilize typing on short formatted lines

The broad regression run caught a callout whose closing paragraph stayed inside
the section. Ten normal-speed repeats passed, but CPU-throttled repetitions and
per-key source traces reproduced cursor displacement, not merely delayed CSS.
A zero-size noneditable widget at the changing end of a short formatted line
could move the native caret backward, causing subsequent characters to appear
before an already typed marker. A nonmoving, style-free span now provides the
same height-measurement protection without placing a widget at the caret.
Follow-up checks retain the large-note layout tests as well as typed callout,
list, task, and section-exit tests.

## Lock semantics and limits

Lock is a local editing control, not a filesystem permission or a security
boundary against another editor. Previously accepted host operations may finish
after locking, and external file changes still appear. Unsubmitted image reads
are canceled. New local editing gestures must not change the document while
locked.

This session does not establish zero possible data loss. It does not run native
Windows UI tests or launch Excel itself; it exercises Excel-style CSV/TSV
clipboard data. Controlled browser and host tests cover races that cannot be
timed reliably by hand, while native tests verify real clipboard delivery,
the image-paste happy path, locking, and saved files.

## Verification status

The final production build passed the following checks on October 1, 2026:

| Check | Result |
| --- | --- |
| Unit tests | 1,738 passed across 134 files |
| Browser regression tests | 739 passed, including 5 native-clipboard cases run separately |
| Native macOS clipboard and lock journeys | 20 passed in VS Code 1.139.1; 25 exact source and disk checks; no page or editor errors |
| Native Linux clipboard and lock journeys | 19 passed in VS Code 1.140.0 on the ARM64 DGX Spark; 18 exact source and disk checkpoints and all 4 final files matched; no page errors |
| Native save durability tests | 20 passed, including denied writes, delayed saves, switching, closing, and draft recovery |
| Installed VSIX smoke tests | All 16 passed in two consecutive isolated runs across trusted, restricted, and disabled profiles |
| Type checking | Source and test configurations passed |
| Dependency checks | Lockfile policy passed; npm audit reported no known vulnerabilities |
| Packaging | 64 archive entries, including 62 extension payload files; package validation passed |

Additional targeted checks included 20 CPU-throttled callout-typing repetitions,
81 repeated clipboard regressions, and explicit typing/deletion across the
19-, 20-, and 21-character decoration threshold. The final broad browser run
also includes the threshold regression.

An earlier parallel run exceeded the 200 ms indexed-search performance gate at
206.9 ms. The complete isolated unit rerun passed without changing the gate.
The smoke test also used an immediate assertion for a newly created folder's
asynchronous expansion. It now waits after exactly one ArrowRight press and records
tree identity and focus diagnostics on failure; it does not retry the gesture
or suppress errors. Both isolated full smoke reruns passed without the earlier
workbench TreeError; no production tree change was made on this evidence. The
initial failure evidence remains in local logs.

The release archive is `releases/local-markdown-vault-0.2.0.vsix`, with SHA256
`a98d9f8059573b6491bf0ada0f7fb616c8ee9baa26a6383c3418470388fcbb03`.
The macOS and Linux native runners used the matching production bundles.
This exact archive was installed into the normal macOS and Spark VS Code
extension directories. All 62 installed payload files were verified on each
system, allowing only VS Code's installer-added `__metadata` in `package.json`.
Personal windows were not reloaded, and user settings were not changed. Existing
windows require **Developer: Reload Window** to load the update.

Final production native evidence is retained locally under
`.vscode-test/clipboard-lock-final-production-2026-10-01` and
`.vscode-test/linux-clipboard-lock-final-a98d9f8`. Final browser artifacts are
under `.vscode-test/clipboard-final-production-browser` and
`.vscode-test/clipboard-final-production-native-browser`.

## Reproduction

Use `npm run test:ui:clipboard-lock` on macOS. The Linux runner is
`scripts/run-linux-clipboard-lock-qa.mjs`; its header lists the required SSH
host, key, and candidate extension-directory variables. These scripts create
and remove only their own temporary profiles and synthetic notes.

Focused browser coverage is in `clipboardFidelityQa.spec.ts`,
`clipboardPipelineQa.spec.ts`, `lockClipboardQa.spec.ts`, and
`codeHighlightReplacementQa.spec.ts` under `test/e2e`. Host ordering and rollback
cases are in `src/editor/documentSyncImageOrdering.test.ts`. Local native reports,
screenshots, and initial failure evidence are retained under `.vscode-test`.
