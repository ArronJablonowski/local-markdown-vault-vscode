# Extensive code and UI QA — September 25, 2026

## Scope

This campaign starts from `74780ea`. It combines source review, new regression
cases, full automated rendering/interaction coverage, and native VS Code
keyboard/mouse workflows in disposable profiles and fixtures. Personal notes
are not used as fixtures. Native evidence is from macOS; Windows and Linux are
not independently certified by this run.

The baseline passed 1,438 unit tests, 42 native UI workflows, 20 native save
durability cases, four Restricted Mode cases, and 15 native menu/dialog/settings
groups. New tests seek combinations not covered by those passing baselines.

## Confirmed defects

| Area | Correction |
| --- | --- |
| Link and image destinations | Remove parser-confirmed angle wrappers and Markdown punctuation escapes before handing destinations to existing authorization. Body, table, reference, and embed rendering use the same normalization. Never decode URL escapes or grant resource access during normalization. |
| Rename link rewriting | Encode newly introduced filename whitespace and URL/Markdown delimiters; preserve authored titles and fragments. Recognize balanced or escaped parentheses instead of truncating the original destination. |
| Rename concurrency | Recheck open document versions after save participants run and immediately before applying prepared edits. Abort on stale positions, rolling staged paths back rather than applying edits to changed text. |
| Embedded tables | Split pipe-delimited cells using backslash parity and preserve trailing escaped pipes instead of merging columns or dropping visible text. |
| Nested callout interaction | Preserve the rendered callout control when folding after committing an unfinished nested table draft, so the callout can be reopened without changing Markdown. |
| Table links | Restore Cmd/Ctrl-click activation through the existing host navigation boundary; preserve plain-click cell editing and avoid duplicate activation. |
| Malformed-input performance | Exclude nested opening brackets from simple link scans, eliminating quadratic backtracking during link rewriting and indexing. A 100,000-bracket indexing regression stalled for over 13 seconds before the fix; the entire targeted 14-test suite completed in 18 ms afterward. |

No dependency, CSP, network permission, filesystem boundary, or input limit was
relaxed. Newly normalized destinations still pass through the existing host and
media checks. The rename conflict is a correctness/data-integrity issue, not a
claim of arbitrary code execution.

## Fresh regression workflows

- Type a handoff note from an empty document using bold shortcuts, nested lists,
  soft breaks, block escape, mouse word selection, copy, and replacement.
- Lock an unfinished table cell, unlock it, and check a neighboring task while
  checking exact outgoing Markdown.
- Fold and reopen a nested callout containing an unfinished table edit.
- Reorder a table column inside a callout, preserving inline markup, alignment,
  and neighboring text, then follow its link.
- Preserve invalid numeric property input while locking and opening a callout.
- Mouse-select and cut Unicode code text, then check the renderer's response to
  a simulated host Undo; separate native suites verify actual Undo persistence.
- Copy exact quoted tilde-fenced code while collapsed and after display changes.
- Rename a note to a filename containing spaces, a hash, and parentheses;
  undo/redo the transaction and follow both rewritten link spellings in VS Code.
- Run an actual native save participant during a case-only rename and verify
  conflict rejection preserves the formatted text and allows a subsequent retry.

The broader suite covers properties, lists/tasks, callouts, footnotes, math,
emoji, links/embeds/images, tables/spreadsheet paste, code, Mermaid and draw.io,
search/navigation, themes/settings, vault file/folder operations and drag/drop,
autosave/recovery, hostile inputs, and automated accessibility checks.

## Final verification

After the reported outage, the saved source was inspected again rather than
assuming earlier tool runs had completed. A separate read-only review found no
incomplete production edits or new actionable issues and passed 88 focused tests.
The full unit suite passed 1,472 tests across 121 files; both source and test
TypeScript checks passed. The fresh production package passed archive validation
and all 539 browser tests. Native verification used VS Code 1.139.1 on macOS;
build and unit checks used Node.js 26.8.2.

| Post-outage check | Result |
| --- | --- |
| Native VS Code interaction workflows | 44 passed |
| Native save durability and recovery | 20 passed |
| Native menus, dialogs, and settings groups | 16 passed, including the new sticky-header preference |
| General extension-host integration | 97 passed; 17 dedicated-profile cases and two case-sensitive-filesystem cases skipped in this runner |
| Restricted Mode | 4 passed in its separate runner |
| Cache-free restart | Seed and recovery phases passed |
| Installed VSIX in isolated profiles | 16 passed: 10 trusted, five restricted, one disabled |
| US English and dependency policy | Passed |
| Dependency advisory audit | Zero known vulnerabilities reported |

The 17 dedicated-profile cases were exercised by the separate packaged and
Restricted Mode jobs. The two case-sensitive-filesystem cases were not executed
on this macOS volume and remain a cross-platform validation limitation.

The final package differs from the fully tested production package only in its
changelog; all runtime payloads were compared byte-for-byte. The rebuilt VSIX is
at `releases/local-markdown-vault-0.2.0.vsix`, with its SHA-256 in
`releases/SHA256SUMS`. Installation into the user's VS Code succeeded and all 61
installed files matched the archive, normalizing only VS Code's added manifest
metadata. No existing user window was forcibly reloaded; **Developer: Reload
Window** activates the update.

The native case-only rename test logged a VS Code Local History copy attempt
against its already-moved temporary staging path. The test verified exact note
contents and successful retry; no note-content loss was observed. This diagnostic
is not being represented as proof that VS Code creates a history snapshot for
every transient staging URI. Save-denial diagnostics in the durability suite are
intentional failure injections into disposable files.

Native screenshots from the research-note and inventory-table journeys were
visually inspected in addition to automated geometry assertions. They showed
rendered properties, math, tables, Mermaid, and aligned horizontally scrolled
headers. This is not a pixel-by-pixel review of every view.

## Limits

Passing these checks does not prove every Markdown combination is correct or
guarantee no data loss during power, process, storage, or independent concurrent
writer failures. The existing local recovery protections remain enabled. This
campaign does not replace manual VoiceOver testing or claim exact Obsidian
parity. Dependency auditing reports known advisories at the time of the check,
not proof that dependencies contain no vulnerabilities.
Wikilink `#` and `^` remain fragment syntax; use ordinary Markdown links with
encoded filenames when a filename contains those literal characters.
