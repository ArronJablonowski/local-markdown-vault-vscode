# Code and adversarial UI QA — September 24, 2026

## Scope and method

This pass starts from `7080276` and reviews the editor, table rewriting, host
messaging, theme lifecycle, bounded file reads, and search. Confirmed defects
receive regression tests before the broader UI rerun. Desktop tests use real
VS Code keyboard and pointer events in disposable profiles and vaults; browser
tests use the bundled webviews with a simulated host. Personal notes and settings
are not fixtures. This is macOS testing, not a Windows/Linux certification.

## Confirmed defects and corrections

| Area | Reproduced defect | Correction and regression evidence |
| --- | --- | --- |
| Table selection | Select All in an editable cell could select the entire Markdown document. Subsequent typing could replace the note instead of the cell. | Scope Cmd/Ctrl+A to the active cell. Browser and native tests delete a selected cell, preserve neighboring cells and surrounding prose, and undo the deletion. |
| Table source integrity | Adjacent pipes and even-length backslash runs were not consistently escaped. Structural operations discarded authored overflow cells that GFM hides. | Use one linear parity-aware escaping function for input and serialization; preserve untruncated source rows through table rewrites and column moves. Unit and browser cases verify exact source, rendered column counts, and hidden source retention. |
| Code-block navigation | A previous block's closing fence could be mistaken for an opener and paired with the next code block. Escape could jump over unrelated prose. | Require the candidate to be the parsed opening code marker. Keyboard tests cover Enter and Cmd/Ctrl+Enter between adjacent unlabeled, labeled, and tilde fences. |
| Syntax highlighting | Changing the code palette did not update already visible code; slow older tokenization could overwrite newer colors or outlive its editor. | Refresh on configuration changes and guard requests by generation, document identity, version, and lifecycle. Contain tokenization failures. Unit races and a native palette-changing workflow cover the behavior. |
| CSS Themes sidebar | Slow reads could overwrite newer selections, target a disposed/recreated view, or reject in the background. Failed setting writes could leave the displayed value misleading. | Capture view identity and request generation; recheck trust after reads; contain failures and restore authoritative settings. Version cached CSS refreshes and dispose the store subscription. |
| CSS style preview | Closing or switching styles during asynchronous reads could throw or display old CSS under a new style name. A queued old-style edit could overwrite the new preview. | Guard open/read generations and panel/URI identity, cancel obsolete timers, and contain disposed-panel message failures. Eleven controlled lifecycle regressions exercise ordering, closure, replacement panels, trust loss, and rejected posts. |
| Message validation | Enum validation coerced arrays to accepted strings and could throw on specially shaped objects. | Require actual strings before enum membership checks. Reject malformed settings and preview/sidebar theme payloads without coercion. |
| Vault reads | A file could grow between its initial size check and an unbounded read. | Read no more than the opened file's checked size plus a one-byte growth sentinel. Preserve canonical/inode checks and reject growth, invalid limits, and oversized reads. |
| Vault search | Negated quoted phrases were parsed incorrectly; early approximate matches could consume the result limit before authoritative matching. Unreadable files could qualify as negative matches. | Parse negated phrases, defer exact phrase matching to file content, and apply result limits after verification. Retain the 500-candidate and eight-concurrent-read bounds; skip unreadable candidates. |

No dependency, CSP, network permission, resource boundary, or document size limit
was relaxed. The previous save-recovery and native Markdown Editor compatibility
safeguards remain in place; see [save safety QA](SAVE_QA_2026-09-24.md).

## Fresh typed-from-empty UI journeys

- **Field handoff:** headings, nested bullets and tasks, a callout, mouse text
  selection/copy, selected-text deletion and undo, and a negated exact-phrase
  vault search.
- **Inventory report:** type a 14-row, six-column table; select/delete/undo one
  cell; enter repeated pipes; verify saved Markdown and neighboring cells; use
  horizontal and vertical mouse-wheel scrolling and measure header alignment.
- **Recovery runbook:** type TypeScript and a Mermaid sequence diagram, leave
  code blocks using Enter, fold/expand, copy exact code to the system clipboard,
  and change visible syntax colors from the sidebar without editing the file.

These supplement the existing mixed-object notes, large documents, 100-file
rendering corpus, native file/folder operations, dialogs, and settings suites.
Browser undo tests assert the outgoing host-owned undo request and simulate its
reply. Native tests separately verify real VS Code undo and saved file contents;
the simulated host is not evidence of native persistence.

| UI area | Exercised behaviors |
| --- | --- |
| Markdown composition | Headings, paragraphs, emphasis, strikeout, highlights, Unicode/emoji completion, links, currency versus math, footnotes, properties, and typed blank-line/block escape. |
| Lists and callouts | Nested bullets, numbers and tasks; Tab/Shift+Tab, wrapping/alignment, continuation/escape, checkbox strikeout and saves, callout types/aliases/folding, and mixed objects inside callouts. |
| Tables | Cell edit/cancel/commit, Select All, deletion/undo, repeated pipes, hidden source preservation, source/options controls, row/column changes, alignment/sorting, large independent tables, horizontal scrolling, and sticky-header geometry. |
| Code and diagrams | Language labels, source controls, one-line/empty/long blocks, copy, eight-line folding, selection and escape; Mermaid families and draw.io pages, pan/zoom/reset/source, local-file refresh, malformed input, and hostile SVG/XML. |
| Navigation | Find/Replace persistence, Quick Switcher, filtered/quoted vault search, relative/wiki/heading/block links, aliases, embeds, local images, hover previews, backlinks, tags, and recent notes. |
| Editing lifecycle | Mouse selection/copy/cut, keyboard typing, undo/redo, rapid file changes, large clipboard/external replacements, locked/editing modes, source/preview mode changes, autosave, and recovery-copy workflows. |
| Vault controls | New note/folder, rename/move, relative/absolute path copying, native drag/drop and undo, refresh/rebuild, expand/collapse, and disposable trash cancel/confirm/nonempty-folder dialogs. |
| Themes and settings | Theme create/edit/save/duplicate/rename/apply/delete; every sidebar dropdown option; persisted native Boolean, sort, diagram, media, attachment-folder, and exclusion settings; remote-media opt-in and revocation. |
| Safety and accessibility | Restricted workspace, blocked media and dangerous protocols, malformed messages, hostile Markdown, resource limits, keyboard controls, focus, accessible labels, and automated accessibility scans. |

## Verification

| Gate | Result |
| --- | --- |
| Final isolated unit suite | 1,283 passed in 110 files, including unchanged performance thresholds |
| Type checking and development build | Passed |
| Browser rendering, interaction, and recovery suite | 483 passed against both development and final production bundles |
| New typed-from-empty native journeys | All three passed independently and again in the full native run |
| Focused native VS Code workflows | 37 passed |
| Native dialog/menu/settings groups | All 15 passed; persisted settings and trash outcomes verified |
| Isolated coverage run | All 1,283 tests passed; statements 54.88%, branches 59.57%, functions 56.85%, lines 56.32% |
| General extension-host integration | 97 passed; 18 conditional cases pending in this runner |
| Separate Restricted Mode run | All four passed |
| Cache-free restart | Seed and recovery phases passed |
| Production-bundle native save durability | All 20 passed with saved-content assertions, including denied-write recovery |
| Installed VSIX profiles | 15 passed: nine trusted, five restricted, one disabled |
| US English, dependency policy, diff, and archive checks | Passed; 797 locked dependencies and 182 production packages |
| Dependency audit | Zero known vulnerabilities reported by npm |

An instrumented coverage run overlapping a desktop test missed the 200 ms search
timing gate (294 ms). The same full coverage command passed after isolating it
from desktop/browser load, without changing assertions or thresholds. The normal
un-instrumented full unit run also passed in isolation. Coverage percentages
describe the configured unit-test coverage set, not native/browser coverage of
the entire product.

The general runner's pending cases belong to separate packaged/restricted/cache
jobs, not 18 unexplained failures. Those jobs are run independently because they
require different VS Code profiles or launch modes.

The rebuilt `0.2.0` VSIX is stored at
[`releases/local-markdown-vault-0.2.0.vsix`](../releases/local-markdown-vault-0.2.0.vsix).
Its checksum is recorded in [`releases/SHA256SUMS`](../releases/SHA256SUMS).
Installation into the local VS Code app succeeded, and all 61 installed payload
files were verified against the archive, normalizing only VS Code's added
manifest metadata. Existing VS Code windows were not forcibly reloaded: save
open work, then run **Developer: Reload Window** to use the updated runtime.
Changes and the installer are committed locally; GitHub upload remains on hold.

Representative native screenshots were visually inspected for the new inventory
and runbook, plus the typed research and planning notes. Table borders align
under horizontal scrolling; code labels/controls, callout tinting, task strikeout,
properties, math, and diagrams are visible. This is not a pixel-by-pixel review of
every generated image.

Two initial new-journey assertions were corrected rather than labeled product
fixes: typed phrase replacement spans multiple host undo transactions, and the
test's locator-hover helper scrolled a table back into view while attempting a
horizontal gesture. The final test uses pointer movement within the visible
table, verifies that the sticky overlay remains visible, and retains the same
two-pixel column-position/width tolerance. Atomic selected deletion is checked
with exact one-operation native Undo and on-disk byte comparisons.

## Reproduction and limits

```sh
npm ci
npm test
npm run typecheck
npm run test:e2e
npm run test:integration:focused
npm run test:ui:native
npm run test:integration:saves
npm run test:vsix
```

Run native UI jobs sequentially because desktop windows compete for keyboard
focus. Run strict performance unit gates separately from browser/desktop load.
Tests create and remove only disposable fixtures; dialog tests move their
synthetic file and folder to the operating system trash.

Passing this campaign does not prove every possible Markdown combination is
correct, certify zero data loss under power/process/storage failure, replace
manual VoiceOver review, or establish exact Obsidian parity. Continuous typing
uses host-owned undo history: one Undo need not remove an entire phrase typed
over several accepted edit transactions. Independent concurrent writers still
require conflict recovery and backups. Dependency-audit results are point-in-time
checks for known advisories, not proof that all dependencies are vulnerability-free.
