# Adversarial UI QA — September 25, 2026

## Scope

This is a fresh interaction campaign starting from `35f22ab`, not a restatement
of the preceding code-review campaign. It uses disposable vaults and VS Code
profiles on macOS with VS Code 1.139.1. Personal notes are not test fixtures.

New workflows type notes from an empty editor, use actual keyboard and mouse
input, switch editor modes with the native picker, select mixed rendered
content, use the system clipboard, and verify the saved Markdown after edits
and Undo. Browser workflows exercise the same production editor bundle with a
simulated host; separate native workflows cover actual extension-host saving.

## Confirmed editor defects and fixes

| Defect | Correction and regression coverage |
| --- | --- |
| Locked YAML properties still opened editable inputs through F2 or double-click. | Check the current editable state before creating a draft. Test lock/unlock cycles, property links, booleans, and absence of recovery messages for rejected edits. |
| Clicking directly from an unfinished cell in one table to another swallowed the second click. | Preserve the intended cell across the first table's commit and widget replacement, including source-offset changes. Test both directions and exact source contents. |
| Adding rows/columns to a table at the end of a note unexpectedly revealed raw Markdown. | Provide a blank caret destination after the resized table, leaving the table rendered and editable. |
| Regex Find selected hidden table source without making it visible. | Recognize CodeMirror's search-selection metadata for Enter, Next, Previous, and Find All. Do not rerun user regexes in a second matcher. |
| Find located text inside collapsed callouts but left the text hidden. | Expand the matching callout's UI state and collapsed ancestors without rewriting the saved fold markers. Preserve unrelated collapsed callouts. |
| Note autocomplete appeared while typing literal bracketed code. | Exclude code, HTML, and actual Markdown link/image destinations. Preserve ordinary and embedded wikilinks with automatically paired closing brackets, aliases, headings, and block suggestions. |
| Closing immediately after typing could discard the last accepted characters. | Await outstanding native writes even after tracking closes, including successor writes from a reopened document. Reopen after the save barrier and replay once only if its contents exactly match the immutable pre-edit baseline. Preserve a separate recovery copy on conflict. |

The first completion fix was too broad: existing full-suite tests caught it
rejecting auto-paired wikilinks. The guard was narrowed and new paired-link/embed
tests added before release. The final browser suite includes these regressions.

The close/save defect was reproduced twice, including with input-event and
host-document traces: the final text reached both the renderer and the closed
extension-host mirror, while the saved file retained older text. It was not
dismissed as test flakiness. Deterministic tests now cover the clean-but-closed
mirror, overlapping old/new document saves, bounded retries, and an independent
writer whose contents must never be overwritten.

## Fresh workflows

- Type a handoff table, leave a cell unfinished, select Text Editor once, type
  more source, then return to Live Preview. Compare exact saved bytes.
- Type prose, fenced code, and a table; mouse-select across all of them; copy
  exact Markdown; delete; restore the entire original note with one Undo.
- Type YAML and two tables, attempt locked property editing, edit across both
  tables, and reveal a regex match without changing the source.
- Cancel property edits repeatedly, edit neighboring properties, resize a final
  table, navigate its options using the keyboard, and reject locked deletion.
- Type a report using nested lists and search/replace; preserve case-sensitive
  whole-word matches and regex capture replacements.
- Navigate emoji suggestions with the keyboard, edit Mermaid source, change
  diagram zoom, check a neighboring task, and toggle the document lock.
- Recover search after an invalid regex; find matches across nested collapsed
  callouts and tables; leave unrelated folded sections closed.

The full browser suite additionally covers math, footnotes, links, images,
embeds, draw.io, Mermaid families, all supported callout types, tables and
spreadsheet paste, code controls, list indentation/wrapping, whitespace,
settings/themes, hostile input, and automated accessibility checks.

## Verification record

- Full browser interaction suite against the final production bundle: 559 passed.
- Full unit suite, including the final save-ordering changes: 1,493 passed
  across 121 files.
- Native menus, settings, and vault gestures: 21 checks passed. The runner
  completed but correctly returned a failing status for the separate known
  native Undo defect described below.
- The initial close/save correction passed 100 immediate-close iterations in
  five fresh native test runs. Final production-build results are recorded below.
- Final production native save suite: 20 passed, including another 20
  immediate-close iterations, unfinished cell drafts, configuration reloads,
  slow native saves, denied filesystem writes, and full recovery storage.
- General production integration suite: 97 passed, with 19 pending checks
  reserved for dedicated profiles or unsupported filesystem cases.
- Final production focused native suite: 47 passed, including the new typed
  handoff, mouse copy/delete/Undo, locked-property, and cross-table journeys.
- Restricted-workspace suite: four passed. Restart/cache privacy: both phases
  passed in fresh native processes.
- Installed VSIX suite: 16 passed across trusted (10), restricted (five), and
  disabled (one) profiles. Mode-inapplicable cases are skipped in each profile.
- Source/test TypeScript checks and whitespace-error checks passed.
- Dependency policy and US English checks passed. The advisory audit reported
  zero known vulnerabilities; no dependency changes were needed.

Intermediate failing checks are investigated rather than counted as successful
release evidence.

One first production native run missed the draw.io SVG at the first scroll
bottom in a long note, although no rendering error appeared. The targeted
four-note retest and the following full-suite complex-note check passed without
additional waiting. The test now records before/after DOM evidence and allows
a bounded asynchronous-render observation period before asserting both SVGs;
it does not force parsing, move the caret, or redraw the editor. No production
diagram change was made, and this intermittent observation is not counted as
an eighth confirmed defect or fix.

## Remaining native Undo limitation

The new multi-selection drag journey exposed a separate VS Code limitation:
native Undo can restore the moved files without restoring links in a saved,
never-displayed note. The normal move and a fresh move back through the Vault
both pass exact path, link, and content checks. This limitation remains
unresolved; it is not counted as a successful QA check. The native UI runner
records it in `knownIssues` and exits unsuccessfully even when every unrelated
gesture completes. See [the reproducible diagnostic and workaround](NATIVE_VAULT_UNDO_LIMITATION.md).

No synthetic text edits, raw snapshot overwrites, global Undo interception, or
indefinitely pinned hidden editors were introduced to conceal that failure.
A dedicated extension-owned Undo/Redo Vault Move workflow requires a separate
UI decision; the user was asked about that option.

## Installable artifact

The verified production build is `releases/local-markdown-vault-0.2.0.vsix`
(64 archive entries, including the native Undo limitation document).
SHA-256: `09151b4f657636b568ddc0c37abdec99114d9978bc39080e16455ef74da99324`.
This is a test build with the limitation above, not a claim of Marketplace
release readiness. The QA report and test fixtures are excluded from the VSIX.
The VSIX was installed into the local VS Code app. All 62 extension payload
files match the tested archive (excluding VS Code's added installation metadata).
The user's running window was not forcibly reloaded.

## Limits

This campaign is not a claim that every possible Markdown combination is
bug-free. Native testing is on macOS, not an independent Windows/Linux or
VoiceOver certification. No CSP, network restrictions, path authorization,
payload limits, or recovery protections are relaxed. Passing save tests cannot
guarantee against power loss, storage failure, or independent concurrent writers.
