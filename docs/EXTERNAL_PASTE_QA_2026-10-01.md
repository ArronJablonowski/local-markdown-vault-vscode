# External Clipboard Paste QA

This review investigates Command+V failures in Markdown Live Preview. It found
clipboard-format selection bugs, lost table-cell focus, and two fast-typing
data-loss defects. The fixes preserve plain Markdown, local attachments, document
locking, and existing clipboard validation. The reported source application was
not identified, so this review does not claim to reproduce that exact application.

## Reproduced defects and fixes

### Choose usable text from external clipboard formats

Some applications provide both readable text and an alternate image. The image
handler previously consumed the paste, inserting an attachment or rejecting the
image instead of pasting the available text. Readable text now takes precedence.
Image-only data still uses the existing validated attachment workflow.

A shared reader examines only TSV, CSV, plain text, and URI text. Empty format
metadata no longer masks a nonempty fallback. Nonempty, malformed, explicitly
declared CSV/TSV still fails validation rather than silently changing formats.
URI-only content remains literal text and now works in rendered table cells.

An image accompanied by empty CSV/plain-text metadata could also erase selected
table-cell content. Rendered cells now reject that unsupported image paste
before mutation and display a warning. HTML-only, unsupported, and empty
clipboards preserve selected Markdown and explain why nothing was pasted.

### Keep the destination through table commits

A cell paste saves the new source and replaces the rendered table widget. It
previously left the old cell unfocused, so the next Command+V could insert text
below the table. The handler now resumes through the mounted widget's own
editing handler and restores the normalized insertion point in the same cell.
Tests include mid-cell Unicode, escaped pipes, unchanged replacements, multiple
tables, and typing immediately after a paste.

Tab previously reused a stale widget handler. A following paste could overwrite
the draft typed into the next cell. Resolving the live handler fixes that stale
state. Native testing then exposed a separate rendering-frame delay: immediate
keystrokes arrived at the page body before the next cell was focused. The normal
handoff is now synchronous. A bounded fallback checks the document, page focus,
connection, and editability before attempting a later handoff.

### Preserve the first character when replacing a rendered block

Select All followed by typing over a newly pasted table could leave the first
inserted character selected. The next character overwrote it. This was a real
typing defect, not a failed clipboard delivery: native event traces showed the
first character inserted successfully with an incorrect resulting selection.

A narrow transaction guard collapses that accidental selection after an ordinary
typed replacement of exactly one selected range containing a rendered block.
It preserves transaction effects, annotations, history policy, and scroll intent.
Composition, paste, history, remote updates, partial replacements, intentional
formatting selections, and multiple selections are excluded. Existing lock and
recovery guards still reject prohibited edits.

## Native macOS coverage

The external-paste runner uses real Command+V in a disposable VS Code 1.139.1
profile. It seeds native clipboard representations for text, HTML, RTF, UTF-16,
PNG, and mixed formats, then compares the full editor source and saved file.
It also copies selections with Command+C from a separate, visible Chromium
window and returns to VS Code without clicking the destination again.

The 25 cases cover:

- Unicode, emoji, combining accents, CRLF, whitespace, and UTF-16-only text.
- HTML/plain-text and RTF/plain-text combinations; text with valid or malformed
  alternate images; HTML-only and empty clipboard rejection.
- Spreadsheet conversion, indented code, repeated pastes with immediate typing,
  a roughly 300 KB Markdown note, and an image-only local attachment.
- Paste immediately after mouse unlocking, consecutive table-cell pastes,
  immediate Tab followed by typing and paste, and a typed table draft retained
  across copying from another application.
- Actual browser-generated multiline, rich-text, table, and code selections.

The runner preserves all existing macOS pasteboard items and representations
in memory and verifies their restoration. Diagnostic text comes only from
synthetic fixtures. Personal notes, settings, and windows are not modified.

## Security and compatibility boundaries

Clipboard HTML and RTF are not imported. No scripts, formulas, remote clipboard
URLs, macros, or image snapshots are executed to obtain a text fallback. There
is no network conversion, asynchronous clipboard read, or delayed key replay.
Existing image validation, attachment containment, document limits, spreadsheet
limits, stale-operation checks, and read-only guards remain in place.

The tests do not launch Excel or Word themselves. Their common clipboard
representations are fixtures; separate browser copying is exercised live.
Native Windows UI testing is not part of this review. Passing these checks is
evidence for the tested scenarios, not a guarantee against every possible
clipboard format, storage failure, or future data-loss defect.

## Verification

| Check | Result |
| --- | --- |
| Unit tests | 1,762 passed across 136 files |
| Complete browser suite | 764 passed; 5 native-clipboard checks passed separately; all repeated on the production build |
| Additional table stress | 246 browser checks passed, including 60 exact-source repetitions for each rapid-typing regression |
| Native macOS external paste | 25 passed on both development and production builds; 48 full source-and-disk checks per run; no page/editor errors; clipboard restored |
| Native macOS clipboard/lock regression | 20 passed on both development and production builds |
| Native Linux clipboard/lock regression | 22 passed in ARM64 VS Code 1.140.0; 33 exact source/disk checkpoints; all 8 final files matched |
| Save durability integration | 20 passed, including denied writes, recovery, closing, and immediate switching |
| Type checking | Source and test configurations passed |
| Dependency checks | Lockfile policy passed; npm audit reported no known vulnerabilities |
| Installed package smoke tests | 16 passed across trusted, restricted, and disabled profiles |
| Release package | Archive validation passed; all 62 installed payload files matched on macOS and Linux |

The Linux runner used the DGX Spark's private Xvfb session, native GTK clipboard,
and real Ctrl+C/Ctrl+V gestures. Its three new regression cases test consecutive
cell pastes, immediate Tab/typing/paste, and five pasted-table replacement rounds.
Linux clipboard sources are separate synthetic notes, not a live external
application. No page errors occurred; the workbench logged an unrelated bundled
Copilot API-proposal mismatch.

The first expanded Linux run failed because its test opener searched for a
virtualized tree row below the visible viewport. The runner now uses Quick Open
with the exact synthetic file path. A fresh run passed all 22 cases; the earlier
startup evidence is retained. No production tree change was made for this test
harness issue.

## Reproduction commands

Run native clipboard tests serially on macOS; do not compete with another test
or a user's copy/paste operations. The native runner restores the clipboard on
normal and handled-error exits.

```sh
npm run test:ui:external-paste
npm run test:ui:clipboard-lock
npm run test:integration:saves
```

The focused browser tests use event-local clipboard fixtures without reading or
replacing the OS clipboard:

```sh
npm run compile
npx playwright test test/e2e/externalPasteQa.spec.ts test/e2e/externalPasteTargetsQa.spec.ts --workers=1
```

Local evidence includes `.vscode-test/external-paste-verified-2026-10-01`,
`.vscode-test/external-paste-full-browser-2026-10-01`, and
`.vscode-test/external-paste-lock-regression-2026-10-01`. Baseline failure
artifacts are retained separately; no failing behavior was hidden by adding
delays before immediate typing or by weakening full-source assertions.

Final macOS evidence is under `.vscode-test/external-paste-production-2026-10-01`,
`.vscode-test/external-lock-production-2026-10-01`,
`.vscode-test/external-paste-production-browser-2026-10-01`, and
`.vscode-test/external-paste-production-native-browser-2026-10-01`.
Linux evidence is under `.vscode-test/linux-external-paste-final-a1b34c2-rerun`.

The release is `releases/local-markdown-vault-0.2.0.vsix`, SHA256
`a1b34c26927b15919786ebe1bbf21b6845066aa29779a784257199d452ae8f4c`.
The native production runs used its exact compiled bundles. The archive was
installed in the normal macOS and DGX Spark VS Code extension directories,
and every payload was compared with the ZIP on both systems, allowing only
the installer's added `__metadata` in `package.json`. Existing personal
windows were not reloaded; use
**Developer: Reload Window** to activate the update.
