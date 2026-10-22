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
