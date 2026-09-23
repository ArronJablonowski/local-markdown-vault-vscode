# Hands-on VS Code QA — September 23, 2026

## Environment and scope

Used the installed Local Markdown Vault extension in the regular macOS VS Code
application, operated through native mouse clicks, mouse dragging, keyboard
shortcuts, typing, and clipboard paste. This was not only a browser harness run.

Created four Markdown files through VS Code's New File and Save dialogs in
`/tmp/local-markdown-vault-human-qa.pkxD2C`: `Everyday.md`, `Diagrams.md`,
`Clipboard.md`, and `Research.md`. Existing personal notes were not edited.

The new folder initially opened in Restricted Mode. After explicit user approval,
trusted only this disposable folder and continued the hands-on checks below.
Personal vault trust and global security settings were not changed.

## Hands-on coverage

| Area | Actions and observations |
| --- | --- |
| Text formatting | Created headings, bold, italic, highlight, inline code, nested bullets, ordered steps, and paragraphs. Inspected the rendered notes. |
| Tasks | Clicked a checkbox; verified checked state, strikethrough, and the saved `[x]` marker. |
| Tables | Clicked a cell, used F2, typed text, and committed with Enter. Verified the updated source on disk. |
| Callouts | Expanded/collapsed a warning and nested tip with mouse clicks. Discovered disappearing headers after edits elsewhere. |
| Selection/clipboard | Drag-selected a paragraph, copied with Command+C, pasted with Command+V, deleted a keyboard selection, and undid the deletion. |
| Code | Copied an eight-line block with its toolbar button, pasted it into `Clipboard.md`, and compared the saved content. Collapsed and expanded the block. |
| Links | Followed a wikilink from `Diagrams.md` back to `Everyday.md`. |
| Properties | Edited the YAML status from `draft` to `reviewed` through the property editor. Discovered disappearing footnote/header controls afterward. |
| Math | Created inline and display formulas and inspected their rendered representation. |
| Locking | Locked the note, attempted typing, and verified the attempted text was absent from disk; unlocked again. |
| Viewing mode | Switched to Text Editor on the first selection and verified plain Markdown appeared. |
| Vault tree | Verified newly saved files appeared; copied a file's absolute path from its context menu and pasted it into a temporary text buffer. |
| Restricted Mode | Mermaid/draw.io remained non-executing source; mutation and custom-theme controls stayed unavailable. |

## Reproduced defects and fixes

1. Editing a table cell caused the following callout header to disappear while
   its Markdown remained intact. The callout marker was also receiving ordinary
   link decorations, overlapping the header widget. Rendered callout titles now
   exclusively own their inline source range.
2. Changing YAML properties could similarly remove footnote navigation. Bare
   bracket syntax without a URL no longer becomes an empty-destination link over
   another feature's widget. Undefined reference-like text stays literal.

The exact table and property editing sequences are regression tests in
`test/e2e/humanWorkflowQa.spec.ts`. Existing HTML sanitization, local-resource
boundaries, and Workspace Trust restrictions are unchanged.

## Verification after the fix

Installed the rebuilt VSIX and reloaded only the disposable QA window. Repeated
both native-app failure sequences: edited the table cell again and changed the
YAML status to `verified`. The callout title stayed visible; the footnote forward
and return buttons remained visible and navigated successfully. Changes were
confirmed on disk.

- 1,001 unit tests passed.
- 373 browser tests passed, including both new regression cases.
- Package integrity, type checking, and US English checks passed.
- Installed-package smoke checks passed: 9 trusted, 5 restricted, and 1
  disabled-extension check. These automated checks supplement the hands-on work.

## Trusted-mode continuation

- Verified Mermaid flowchart and draw.io XML rendering in the actual app;
  exercised actual-size, zoom in/out, pan, and reset controls.
- Created `QA Archive` through the vault command and `Move Test.md` through the
  folder context menu; typed linked content and confirmed autosave.
- Renamed `Everyday.md` to `Everyday Renamed.md`. Verified saved wikilinks updated
  in three notes, including an aliased link.
- Moved `Research.md` into the new folder, then renamed the populated folder to
  `QA Renamed`. The tree and open-note paths updated immediately.
- Trashed the disposable Move Test note. Tested both Cancel and confirmation on
  nonempty-folder deletion, then trashed QA Renamed and its remaining Research
  note. These test items are recoverable through macOS Trash; no personal files
  were deleted.
- Source editing exposed another real defect: selecting text in an already
  revealed block could re-render it and move replacement typing outside the
  source. The remembered source-editing state must take precedence over the
  protection for dragging across a still-rendered widget. Fixed that ordering
  and added Mermaid, draw.io, table, and unit regression tests.

### Final verification

Installed the updated package and repeated source selection and replacement in
VS Code. Mermaid rendered the edited `Verified` node; draw.io rendered the edited
`Verified QA` label. Both changes were also confirmed in the saved Markdown.

- 1,002 unit tests and 376 browser tests passed.
- Type checking, package integrity, and US English checks passed.
- Packaged-extension smoke checks passed: 9 trusted, 5 restricted, and 1
  disabled-extension check.
- The new browser regressions cover selecting and replacing revealed Mermaid,
  draw.io, and table source without prematurely returning to rendered mode.

## Limits

This is a bounded macOS workflow pass, not a claim that every possible document,
platform, or interaction is perfect. Custom-theme editing, every possible diagram
family, and cross-platform native interactions were not exhaustively exercised
in this continuation. Only the explicitly approved disposable folder was trusted;
no global security protections were disabled.
