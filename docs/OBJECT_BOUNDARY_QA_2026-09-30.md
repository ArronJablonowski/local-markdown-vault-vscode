# Large-note object-boundary QA — September 30, 2026

## Scope and method

This campaign starts from `8f41a02` and targets editing immediately above,
below, and across Markdown objects in Markdown Live Preview on macOS. Tests
use disposable notes and isolated VS Code profiles; personal notes are not
modified.

The native runner creates three mixed notes of approximately 115 KB, 285 KB,
and 485 KB. It then uses individual typed characters, keyboard shortcuts,
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
accepted and rebuilt immediately.

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

## Reproduction and evidence

Run `npm run test:ui:object-boundary` for the native journey. It defaults to
VS Code 1.139.1, matching the installed application during this campaign.
`MDLP_QA_VSCODE_VERSION` selects another test version;
`MDLP_BOUNDARY_FIRST_ONLY=1` runs the first note; and
`MDLP_BOUNDARY_ARTIFACTS` chooses a folder under `.vscode-test/` for reports,
screenshots, and edited synthetic notes.

Browser regressions are in `objectBoundaryBlocksQa.spec.ts`,
`objectBoundaryInlineQa.spec.ts`, `objectBoundaryRevealQa.spec.ts`, and
`indentedCodeQa.spec.ts`. The native script is
`scripts/run-object-boundary-ui-qa.mjs`.

This campaign does not certify every Markdown combination, native Windows or
Linux interaction, or immunity from all future data loss. Exact saved-text
comparisons establish the behavior of the exercised sequences.
