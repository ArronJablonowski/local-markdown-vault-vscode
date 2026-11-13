# Large Markdown preview recovery QA

## Reproduced failure

On macOS with VS Code 1.146.0, open a large Markdown document in **Markdown Live
Preview**, then run **Developer: Reload Webviews**. The previous release leaves
the active editor blank. The host session survives, but the JavaScript renderer
is new and empty. Its startup message was rejected as a duplicate, so no document
snapshot was delivered. Both clean and recently edited large documents failed
this supported reload test with the previous VSIX.

This is a confirmed cause of a blank Live Preview. The user's affected file is
on another Mac and was unavailable for a direct comparison; the tests do not
establish that every reported failure has this cause.

## Fix

- Give each renderer context a random, non-persisted identity. Same-context
  duplicate startup messages remain rejected; a replacement context can recover.
- Drain accepted mutations and save or preserve the previous context's pending
  draft before publishing the current document to the replacement.
- Coalesce recovery initialization, rate-limit replacement requests, validate
  identity shape and message keys, and retry lost startup messages at most four
  times. A valid initialization stops all startup retries.
- Register host message and disposal handlers before assigning executable
  webview HTML. Keep existing CSP, workspace restrictions, and size limits.

No synchronization, network access, dependency, or document-format change was
introduced. The identity is a local lifecycle marker, not an authorization token.

## Large-file coverage

The installed VSIX was tested in both trusted and restricted VS Code profiles:

- Clean and rapidly edited large Live Preview documents, with LF and CRLF line
  endings, survive **Reload Webviews** and match the saved file afterward.
- An unfinished table-cell edit inside a callout survives reloading a large
  mixed note and is saved to the original file.
- Built-in **Markdown Preview** opens multi-megabyte prose and code files,
  a 12,000-row table, and 1,200 mixed-format sections. Both first and last
  headings render, scrolling reaches the end, and source bytes remain unchanged.
- Built-in Preview completed these generated cases without a blank pane. Cold
  prose previews took roughly 16–18 seconds in the clean test profile; the fix
  does not claim to eliminate VS Code's large-document rendering cost.

Tests use VS Code's own reload command. Direct iframe navigation is not used as
an equivalent, because it bypasses VS Code's webview setup.

## Regression and safety checks

- All 2,416 deterministic unit tests passed, including new identity validation,
  bounded retries, duplicate rejection, coalescing, hidden-view recovery, pending
  save ordering, and divergent-draft preservation checks.
- All 2,940 browser tests passed with the new renderer bridge.
- All 58 native installed-VSIX checks passed: 31 trusted, 26 restricted, and one
  disabled-extension case. The original regressions ran without exclusions.

Existing Live Preview document limits remain in place. This round verifies
macOS; it is not a new native Windows or Ubuntu certification.
