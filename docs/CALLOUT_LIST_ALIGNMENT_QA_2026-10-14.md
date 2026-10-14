# Callout and list alignment QA — October 14, 2026

## Confirmed issue and fix

Enter preserved the Markdown list prefix correctly, but the active line revealed
quote and task syntax while the preceding line showed rendered markers. This
shifted the new item's caret horizontally, especially inside callouts.

Quote, bullet, and task markers now stay rendered while the caret is in the body.
Navigating into a marker or selecting its source still reveals it for editing.
Home and Shift+Home retain access to the full list prefix, without changing
visual-line navigation within wrapped items. Markdown content and save handling
are unchanged.

## Coverage

The new 45-case matrix uses real browser key events against the shipped webview
bundle and stylesheet, not mocked rendering. It covers `-`, `*`, `+`, unchecked
and checked tasks, root and nested lists, spaces and tabs, and one/two levels of
quoted callouts. It asserts exact source, resets completed tasks on continuation,
and measures alignment within one pixel immediately after Enter, during typing,
and after moving the caret away to reveal both rendered markers.

Existing tests additionally cover callout types and aliases, folding, nested
callouts, mouse replacement/deletion, arrow navigation, Shift+Enter, Tab and
Shift+Tab, wrapped lists, themes, checkboxes, tables, math, and code inside callouts.

The final 45-case alignment run passed. The focused callout/alignment run passed
117 tests. The final full rendering suite passed all 1,125 tests; all 2,079 unit
tests, type checking, package verification, and packaged extension smoke tests
also passed. Browser tests do not certify native OS
clipboard behavior or disk durability; those remain separate test categories.
This session's rendering tests ran locally, not on the remote NOC display.

## Follow-up: native Ubuntu NOC editing

The next session installed the latest VSIX in the NOC user's regular VS Code
profile and a separate QA profile. Native tests ran on the actual 1280 × 400
display (1214 × 368 workbench viewport, DPR 1), using disposable notes and real
keyboard/mouse events. Source and disk hashes were checked after edits.

The initial 45-case native matrix passed, including Enter, Tab/Shift+Tab,
Home/End, arrow navigation, whole-line selection/deletion, individual
backspaces, mouse placement, and continued typing. No page errors occurred.

Screenshot inspection identified another issue: editing anywhere in a callout's
body revealed its title as raw Markdown and removed its folding button. Source
reveal now applies to the title line, not the whole callout. The styled header
and folding control remain available while editing bullets and tasks beneath it.
The regression matrix also asserts that the title remains rendered while typing.

The fix passed the 211 focused browser tests and the full 1,125-test rendering
suite. All 2,079 unit tests passed on a quiet rerun; an earlier concurrent
build/test run exceeded the search performance timing gate. Package verification
and packaged-extension smoke tests passed. No dependency or OS sandbox settings
were changed. The Snap launcher's existing `--no-sandbox` limitation remains;
this is functional QA, not a secure-deployment certification.

Native follow-up includes the original 45 cases plus four meeting workflows
(`note`, `warning`, `abstract`, and a nested warning), testing Shift+Enter from
the title, continued bullets/tasks, nesting/outdenting, folding/unfolding,
checkbox changes, and body redrafting. Use the Linux clipboard/lock runner with
`MDLP_LINUX_CALLOUT_LIST_QA=1`, `MDLP_LINUX_QA_ASSERT_CALLOUT_TITLES=1`, and
`MDLP_LINUX_QA_TEST_GREP=^Callout/list` alongside its existing host/display options.

The final native run passed all 49 workflows (1,106 explicit navigation/control
keypresses, plus character-by-character typing). No page errors occurred. All
58 synthetic files matched their expected saved contents. The largest measured
sibling text/caret horizontal difference was 0.015625 pixels, below the one-pixel
gate. Screenshots confirmed styled titles, tinted panels, nested folding
controls, and completed-task strikethrough. The tested webview SHA-256 is
`b79d2596fc04db236efb8ba976e7d1e4c9bccfc05c4dc0506e8426e8a9c8cab7`.

Local evidence is retained under `.vscode-test/noc-callout-list-2026-10-14` and
`.vscode-test/noc-callout-list-fixed-2026-10-14`. These ignored artifact folders
contain synthetic notes, screenshots, saved-content hashes, and reports; they
are not user vault data. Temporary remote test windows/vaults are cleaned up.
