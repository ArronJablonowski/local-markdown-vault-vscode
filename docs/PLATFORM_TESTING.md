# Windows and Linux testing

Local Markdown Vault uses one universal VSIX for Windows, macOS, and Linux. Use a disposable local folder for the first test. Do not use a cloud-synchronized, network, or production folder.

## Install the test build

1. Download `releases/local-markdown-vault-0.2.0.vsix` from this repository.
2. Open VS Code 1.90 or newer.
3. Open **Extensions** with `Ctrl+Shift+X`.
4. Select the **...** menu, then **Install from VSIX...**.
5. Select the downloaded VSIX and reload VS Code when prompted.
6. Open a disposable local folder. Its name should appear at the top of **Document Vault**.

If the **...** menu is hidden, open the Command Palette with `Ctrl+Shift+P` and run **Extensions: Install from VSIX...**. Compare the download's SHA-256 value with `releases/SHA256SUMS` before installing it.

## Core test on both platforms

1. Create a folder and a Markdown note from the Document Vault toolbar.
2. Rename and move both items. Confirm that affected Markdown links update.
3. Type in Markdown Editor, click a task checkbox, and confirm each change reaches the file on disk automatically.
4. Create ordered, bulleted, nested, and task lists. Confirm Return continues each list and nested bullets use different marker shapes.
5. Enter and leave a fenced code block with Return and Arrow Down.
6. Open a wikilink, local image, callout, table, footnote, property block, and Mermaid diagram.
7. Delete the test note. Confirm it appears in the operating system's Recycle Bin or Trash and can be restored.
8. Rename a note by changing only letter case and verify its links and exact filename.
9. Change a note outside VS Code and verify the open editor and Document Vault update promptly.
10. Put the workspace in Restricted Mode and verify editing remains available while diagrams, custom CSS, and vault-wide mutations are disabled.

## Windows checks

- Test on a local NTFS folder.
- Confirm deleted entries appear in the Windows Recycle Bin.
- Test paths containing spaces, accented letters, and emoji.
- Confirm a junction or symbolic link cannot expose files outside the vault.
- Complete the keyboard and screen-reader checklist in `docs/ACCESSIBILITY.md` with NVDA.

## Linux checks

- Record the distribution, desktop environment, filesystem, VS Code version, and whether VS Code is a native, Snap, or Flatpak installation.
- Confirm deleted entries appear in the desktop Trash and can be restored.
- Verify that `Note.md` and `note.md` behave as distinct names on a case-sensitive filesystem.
- Confirm a symbolic link cannot expose files outside the vault.
- Complete the keyboard and screen-reader checklist in `docs/ACCESSIBILITY.md` with Orca.

## Report a problem

Include the operating system and version, filesystem, VS Code version, extension version, installation type, exact steps, expected result, actual result, and whether the workspace was trusted. Do not attach private vault content. Security issues should be reported privately using the process in `SECURITY.md`.

## Ubuntu NOC verification — October 14, 2026

The universal 0.2.0 VSIX was tested on Ubuntu 24.04.5,
x86-64, GNOME/Wayland, with VS Code Snap 1.141.2. The physical display was
1280 × 400; the observed workbench viewport was 1214 × 368 at scale 1.
VS Code used X11/Xwayland; native Wayland Electron was not covered.

- The large-note navigation run passed 135 checks and 7,035 arrow presses across
  120,089-, 300,295-, and 490,082-byte synthetic notes. Tables, fenced and indented
  code, Mermaid ER/flow diagrams, draw.io, callouts, math, lists, quotes, images,
  document edges, and selection/page navigation were covered. All saved note
  bytes remained unchanged; no page errors were recorded.
- The combined native clipboard/Vault run passed 25 checks with no page errors.
  Clipboard and editing checks cover Unicode copy/cut/paste, undo/redo,
  spreadsheet paste, code-copy controls, locked editing, tables, checkboxes,
  nested table lists, and exact saved content. A separate Vault workflow covers
  folder/note creation, meeting-note edits, Unicode filenames, folder renaming,
  and moving an edited note.

Navigation used the `e3c0f37` baseline. A first-run settings race was then fixed
by applying the default-editor association before exposing Vault commands.
The updated build passed the complete 25-check workflow in a fresh profile
without preloaded editor associations. Its webview bundle is unchanged from
the navigation-tested build.

Navigation ran on the actual short display. Clipboard/file workflows used a
private X11 virtual display and disposable profiles/vaults; QA tools were
extracted into a user-owned cache, not installed as system packages. GTK probes
must use `GDK_BACKEND=x11` so they inspect the test clipboard instead of the
desktop's Wayland clipboard. Snap launchers need `--wait` to keep the private
display alive. Short displays may hide the Vault activity icon in VS Code's
overflow menu; **Focus on Document Vault View** remains available in the Command
Palette.

The tested Snap package's own launcher adds `--no-sandbox`. These tests validate
functionality, not a fully sandboxed Electron deployment. No additional OS
protections were disabled. Orca, Trash restoration, other Linux packaging
formats, Windows, and the existing full-recovery-storage immediate-close edge
case were not qualified by this run. This is not a Marketplace or secure-release
sign-off.

The follow-up native callout/list run on the same NOC display passed 49 workflows
after fixing callout-title source reveal during body edits. Enter, Tab/Shift+Tab,
cursor alignment, list-line deletion, mouse edits, nested callouts, heading soft
breaks, folding, and checkbox changes were exercised with exact source/disk
checks. The updated package was installed in the NOC user's regular profile.
See [callout/list QA](CALLOUT_LIST_ALIGNMENT_QA_2026-10-14.md) for evidence and
coverage details. The sandbox and platform limitations above still apply.

## Ubuntu clipboard and automatic-save QA — October 15, 2026

Native copy/paste testing uses the NOC host's installed VS Code with a disposable
profile, vault, X11 display, and user-space window manager. The private display
isolates the test clipboard from the NOC desktop clipboard. GTK supplies an
external application's clipboard selection; Chromium is not used to seed it.
No administrative installation or personal note edits are involved.
The disposable paste/save profile treats the generated fixtures as trusted;
the NOC user's Workspace Trust settings are unchanged. Restricted-mode coverage
remains in the packaged-extension smoke suite.

Confirmed issues and fixes:

- A rendered table cell saved pasted content, but subsequent ordinary typing
  remained only in its field/recovery snapshot until a commit boundary. Cell
  input now commits through the normal document/save pipeline without waiting
  for Enter or blur, and restores the active cell, caret, raw in-progress text,
  frozen column widths, and horizontal scroll position. Unfinished IME input
  waits for composition end. Escape still restores the editing session's value.
- An emptied cell's insertion offset was after all padding spaces. Restoring
  cut text shifted the padding to one side. The empty-cell insertion point now
  preserves padding on both sides.
- Regression testing protects ordinary mouse placement in prose after leaving
  a cell and the Lock/Edit transition after a live-saved cell edit. Existing
  tests that required table changes to remain uncommitted until Enter now
  require the updated source before Enter instead.

Native workflows cover small and roughly 120 KB notes containing callouts,
nested bullets, rendered tables, and fenced code. They use native Copy, Cut,
Paste, plain-text Paste, Unicode, immediate typing after paste, Undo/Redo,
immediate tab close/reopen, spreadsheet paste, locked editing, code-copy
buttons, checkbox changes, and exact source/disk comparisons. External GTK
clipboard workflows additionally click back into prose before plain paste
and immediate close/reopen. The original native clipboard/Vault workflows
remain enabled in the same run.

Use the Linux clipboard/lock runner with `MDLP_LINUX_PASTE_SAVE_QA=1` and its
existing private-display/window-manager options. Evidence is retained in the
ignored `.vscode-test/noc-paste-save-*-2026-10-15` artifact directories. The
initial failing runs are retained alongside the retests, not hidden. A Quick
Open retry handles native focus settling after tab closure; it does not pause
between the tested paste/typing and close. The navigation failures in the
initial large-note run had exact expected disk contents, not lost text.

Zero-delay Close can encounter VS Code's native Save confirmation while an
automatic write is in flight. The driver records those confirmations and
chooses Save, never Don't Save or Cancel. These are safety-prompt close tests,
not claims of silent close without prompting. Ordinary mutation/save checks
verify disk contents without pressing Save. Earlier driver versions did not
handle the confirmation or wait for tab closure before Quick Open; those failed
runs do not establish silent data loss. The paste/save stress suite now opens
files through the native Vault tree instead of racing Quick Open's asynchronous
preview and result-list updates. It focuses the tree control (not an unfocusable
tree item) and verifies that the exact editor tab exists before testing Close.

This run does not certify native Wayland clipboard behavior, every external
application's HTML/RTF clipboard flavor, power-loss durability, or the existing
full-recovery-storage immediate-close edge case. The Snap sandbox limitation
documented above is unchanged. Passing clean-close tests is not a guarantee
against every possible form of data loss.

Final qualification: all 43 native workflows passed, with no page errors and
all 29 synthetic files matching expected source/disk contents. The run used a
1440 × 900 private workbench at DPR 1, 499 explicit navigation/control keypresses
(plus character typing), and 38 native clipboard reads. Seven immediate closes
encountered the native Save safeguard and were explicitly confirmed. Normal
editing checks saved without Save/Enter/blur. The full browser suite passed
1,128 tests, the unit suite passed all 2,079 tests, and type checking, package
verification, and final packaged-extension smoke tests passed.

The final native report and screenshots are under
`.vscode-test/noc-paste-save-completed-2026-10-15`. The verified webview SHA-256 is
`9574d9492aabc7f6098d3516f0a7170e5fe28fbfa68439dc1ad6c64cef37e0e4`.
The same build was installed in the NOC user's regular VS Code profile and on
the development Mac. Existing windows were not forcibly reloaded.

### Ubuntu large mixed-note switching stress — October 15, 2026

The native Linux clipboard runner now supports `MDLP_LINUX_RAPID_MIXED_QA=1`
together with `MDLP_LINUX_PASTE_SAVE_QA=1`. Three disposable reports of roughly
120, 300, and 450 KB contain hundreds of repeated meeting sections with nested
callouts, indented tasks, tables, TypeScript fences, Mermaid flowcharts, inline
math, tags, bold text, and Unicode. Nine workflows edit the top, middle, and
bottom using native typing, Backspace, selection, Copy, Paste, and Enter. Each
workflow switches files immediately after typing and again immediately after
paste-plus-typing, then compares the saved file and reopened editor with the
exact expected source. Document mutations do not use editor dispatch APIs.

An initial assertion read the 450 KB file before its asynchronous final save
completed: the pasted text was present but the following word was still in
flight. A subsequent disk read confirmed the word arrived. The runner now
waits up to 12 seconds for exact disk convergence after switching, records the
remaining save latency, and still performs the switch without a preceding save
probe or manual Save. This is not a claim of synchronous disk persistence on
every keystroke. The initial failed report is retained for comparison.

This qualification uses the real Ubuntu VS Code application in a private
1440 × 900 X11 workbench, not the physical NOC monitor or native Wayland.
The same clipboard/sandbox/power-loss limitations documented above apply.
No production source or installed extension build changed in this QA round.

Final result: all nine mixed-note workflows passed; all 25 fixture files
matched exact expected disk contents, with no page errors. The driver recorded
163 explicit navigation/control keypresses plus character typing and nine
native clipboard reads. Post-switch convergence probes took 155–231 ms,
including SSH/read overhead; these are not end-to-end keystroke-save timings.
The workbench logged an unrelated bundled Copilot API-proposal mismatch.
The 89 targeted autosave/save-ordering unit tests and type checking passed.
Report and screenshots: `.vscode-test/noc-rapid-mixed-final-2026-10-15`.
