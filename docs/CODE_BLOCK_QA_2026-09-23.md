# Code block QA — September 23, 2026

## Scope

This macOS pass combines native VS Code use in the disposable
`/tmp/local-markdown-vault-human-qa.pkxD2C` vault with browser-driven interaction
tests of the shipped webview. No code in the notes was executed, and no personal
notes were edited.

## Native VS Code checks

- Opened a mixed note containing Python, JavaScript, JSON, SQL, HTML, and Bash.
- Collapsed an eight-line Python block, copied it, and pasted into a scratch
  text editor. Verified all eight lines, indentation, and emoji; discarded only
  this unsaved scratch copy.
- Selected and replaced a JavaScript line using a mouse click followed by
  Home/Shift+End and typing. Tested undo.
- Deleted a selected Python line with Backspace and restored it with Command+Z.
- Copied Python through the toolbar and used Command+V to replace selected code
  in another block. Verified the saved Unicode and indentation on disk.
- Changed the block language through its source button and checked the label.
- Used consecutive Enter presses to leave the block and type an unrelated
  paragraph; verified the closing fence remained before that paragraph on disk.

Native accessibility-select and direct automation-paste helpers did not reliably
represent user input in this webview. Those attempts were not counted as passed
selection/paste tests; keyboard selection and actual Command+V were used instead.

## Automated coverage

- Repeated replacement, insertion, deletion, and exact clipboard output across
  Python, JavaScript, TypeScript, JSON, HTML, CSS, SQL, Bash, PowerShell, Rust,
  C++, and an unknown language label. This tests editor behavior, not execution
  or language-specific compiler correctness.
- Empty, 1-, 7-, 8-, 9-, and 100-line blocks; backtick and tilde fences;
  collapse/expand, exact copying, and the eight-line threshold.
- Mouse-drag selection and deletion, adjacent prose preservation, narrow layouts,
  long lines, Unicode sequences, and inert HTML with no remote-image request.
- Preview updates that shorten and lengthen an existing code element, including
  changes while collapsed.

## Defect fixed

Markdown Preview retained an outdated collapse/expand line count after the same
code element changed length. The control now refreshes its count without losing
its folded state, and subsequent toggles use the current count.

This is a bounded QA pass, not a claim of exhaustive correctness on every platform
or every language. Native Linux and Windows interactions were not tested here.

## Verification results

- All 21 new code-block browser tests passed.
- Full suites: 1,005 unit tests and 402 browser tests passed.
- Compilation/type checking, US English verification, and package integrity
  checks passed.
- Packaged VS Code checks passed: 9 trusted, 5 restricted, and 1 disabled-extension
  test.
