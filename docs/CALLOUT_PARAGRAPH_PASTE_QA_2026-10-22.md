# Callout paragraph paste QA — October 22, 2026

## Confirmed issue and correction

Before the fix, pasting multiple paragraphs into a callout retained the quote prefix only on the first paragraph. Blank separators and subsequent paragraphs escaped the callout. Four browser reproductions failed against the original bundle, including normal and nested callouts at small and approximately 100 KB sizes.

The editor now adds the destination callout's continuation prefix to pasted lines, including blank lines. Nested quote and list/task containers are retained; fenced code does not interpret a literal leading dash as a list marker. Replacing the entire source and pasting outside callouts retain literal clipboard behavior. A paste ending at an existing quoted-line boundary does not duplicate that line's prefix.

The handler uses plain clipboard text, not clipboard HTML. Existing spreadsheet conversion takes precedence. Locked documents remain read-only. Original payload, quote expansion, and resulting document are checked against the existing 20 MiB document limit. Quote expansion is measured before allocating the expanded string. If bounded parsing cannot establish the context of an explicit quote, the editor leaves the document unchanged and asks the user to retry rather than silently breaking its structure.

## Coverage

- Browser cases cover normal/nested callouts with approximately 100 B, 100 KB, 1 MB, and 2 MB pastes, exact source comparisons, folding, and an outside sentinel.
- Additional cases cover CRLF normalization, Unicode/emoji, bullets, tasks, list-nested callouts, fenced code, source replacement, locked mode, line-boundary selection, inert hostile HTML, and rejection of quote-amplified oversized text without partial insertion.
- Unit cases exercise prefix expansion, newline normalization, final-prefix reuse, literal HTML, and size rejection.
- The Ubuntu runner uses an external GTK clipboard owner in an isolated X11 desktop and actual VS Code keyboard paste. It follows paste immediately with typing, verifies exact disk content, folds/unfolds the callout, and closes/reopens the tab to verify saved content. Normal and nested callouts use regular and plain-text paste respectively.

## Native test constraints

Native QA uses disposable notes and profiles, not personal notes or the user's clipboard. Initial driver failures exposed asynchronous clipboard ownership and virtualized offscreen headings; the runner now waits for clipboard readiness and navigates to the heading before folding. These were corrected in the test driver. The corrected six-case native run passed at approximately 1 KB, 100 KB, and 1 MB; the final production-bundle run also includes approximately 2 MB.

Ubuntu runs on the authorized NOC host in a private 1440×900 X11 desktop. This is functional clipboard/editor coverage, not a Wayland or sandbox security certification. Closing/reopening a tab does not establish guarantees against power loss or forced process termination.

## Final results

- Type checking and production packaging passed; package contents verified.
- Unit suite: 2,089 passed.
- Browser suite: 1,167 passed, one existing large sticky-table alignment check timed out. Both editing and locked variants passed on focused rerun. All 17 new callout paste cases passed.
- Native Ubuntu production bundle: eight passed, zero failed; 65 keyboard actions and eight exact clipboard checks. Sizes range from approximately 1 KB to 2 MB in normal and nested callouts.
- Packaged VS Code smoke checks passed in trusted, restricted, and extension-disabled profiles (10, five, and one checks respectively; profile-inapplicable cases intentionally pending).
- US English verification and whitespace checks passed.
- Installed webview SHA-256 matches on Mac and Ubuntu: `667f860822209f338328b03d90dcc6911acfa9d21e99af4cbc172f324f126739`.
- Native artifacts: `.vscode-test/noc-callout-paragraph-paste-release-2026-10-22` (local, untracked).

Existing VS Code windows were not forcibly reloaded. Reload the window to activate the installed bundle. No personal Markdown files were changed by these tests.

## Follow-up UI/rendering QA: literal code continuation

Further interaction testing confirmed that multiline paste inside an indented
code block in a callout dropped the required code indentation after the first
line. Subsequent lines could render as prose or bullets. Shift+Enter also treated
literal leading dashes as list markers inside quoted code, adding unintended
indentation. Callout-looking code could enter the heading-continuation path.

The correction derives code prefixes from parser-owned `CodeText`/`CodeMark`
spans rather than guessing from code content. It preserves quote/list containers,
literal indentation, tabs, and code at an end-of-line boundary. Both paste and
Shift+Enter use the same helper; ordinary paragraphs, lists, and callout headings
retain their existing continuation behavior. HTML stays literal, and locked
documents and resource limits are unchanged.

Nine new browser workflows cover space/tab indentation, nested callouts,
blank-line pastes, immediate typing, end-of-code paste, Shift+Enter, list-nested
fence openings, and literal callout/HTML text. They compare exact source and
rendered code classes. Tab fixtures follow Markdown tab stops: a single tab
after `> ` is not necessarily an indented code block. Five unit cases cover the
parser-owned container and indentation calculation.

The native large-redraft runner now pastes multiline code from the macOS
clipboard into callouts and continues it with Shift+Enter in approximately
110 KB, 260 KB, and 470 KB notes. All 35 native checks passed, with 3,336 typed
characters, 456 key actions, 47 pointer actions, no page errors, and exact disk
comparisons. The full browser suite passed all 1,179 tests.

Native control QA additionally exercises all configured viewing-mode aliases,
lock defaults, five code palettes, whitespace visibility, tab reuse, sorting,
remote-resource settings, exclusions, attachment location, trash confirmations,
and multi-file drag/drop. Fixture-driven watcher refresh can detach native tree
rows; the runner retries only that navigation, never file mutations or byte
assertions.

The previously documented VS Code filesystem Undo limitation remains: native
Undo can restore moved files without restoring links in an unopened/disposed
document. The extension's dedicated Vault Undo/Redo restored paths, links, and
exact file bytes during this run. The separate out-of-band close/recovery race
documented in the dependency QA report is not claimed fixed by this change.

Local evidence: `.vscode-test/large-redraft-ui`,
`.vscode-test/human-native-ui`, and Playwright's `test-results` directory.
All test notes/settings belonged to disposable profiles; personal notes and
settings were not modified. The large-redraft runner restores the clipboard.

Final follow-up results: 2,098 unit tests passed, 1,179 browser tests passed,
and 46 focused production-bundle paste/security checks passed. Native settings
checks covered all added enum values. The extended full-control run reached
25 successful checks before a watcher/menu navigation timeout; after waiting
for the newly created folder to appear in the tree, the six gesture groups
completed with only the already documented native Undo limitation. That
platform limitation intentionally leaves the gesture report marked not fully
passed; it is not hidden or counted as fixed. Timing-sensitive unit/performance
checks were repeated under normal machine load after an overloaded parallel run.

Follow-up VSIX SHA-256:
`96fb0d54ebc306c1dc76696f75c6f3e71284bd3ed666383da662e1991d1c31b1`.
Follow-up webview SHA-256:
`3fcd27b88a72871b414eaa1ec8df243dadf4baa215904c1a3cfea0d06112e2e7`.
