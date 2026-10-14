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
