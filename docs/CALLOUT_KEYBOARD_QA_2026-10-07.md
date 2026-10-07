# Callout keyboard QA — October 7, 2026

## Fixes

- Collapsing a callout after a table edit could strand the cursor inside its hidden body. Individual folding now commits the active field first, validates the current callout position, and moves affected selections to the visible header. Invalid drafts remain available instead of being hidden.
- Expanding a nested callout with the cursor on its header could expose raw `> >` markers above the rendered title. Rendered headers now consistently hide their entire quote prefix.

## Coverage

Added 14 browser regressions covering character-by-character meeting notes, arrow-key corrections, repeated Enter to leave callouts, Shift+Enter, task-list indentation, nested folding, long-note navigation, table drafts, invalid properties, and field edits that shift a callout's position. Tests cover narrow and wide layouts with default and Obsidian styling.

The focused callout and fold suite passed 102 tests. An earlier 13-test version of the new suite also passed five repetitions (65 runs).

Final-build regression checks passed: 1,039 browser tests (excluding native clipboard cases), 2,037 unit tests, source and test type checks, US English verification, and dependency-policy verification. The dependency-policy check is not a fresh advisory audit.

Native macOS VS Code testing used disposable notes and actual keyboard/mouse input. It covered note creation, arrow-key corrections, entering and leaving callouts, nested table edits, folding, and keyboard expansion. Three exact saved-file checks passed. The final nested-callout note remained 229 bytes with SHA-256 `f508abb6c1827e6873706ab517ed4f55b2b976da21ebb1481025a5e8aad69732` after folding and expansion. Personal notes were not edited.

## Scope

The packaged VSIX passed clean-profile smoke checks in trusted, restricted, and disabled configurations. Release SHA-256: `f3baa544d987da07bd6fb5b61fce9bb11c44e3e6fbc7bc9fd87ff656a113a9dd`.

These checks target callout editing and rendering in Markdown Live Preview. Native Windows/Linux behavior and every possible Markdown combination were not tested in this session. Passing tests do not guarantee absence of all defects or data loss.
