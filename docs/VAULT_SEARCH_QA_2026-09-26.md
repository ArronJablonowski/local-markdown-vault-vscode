# Vault title and content search — September 26, 2026

## User workflow

Use the magnifying-glass button beside the Vault name, the file/folder context
menu, or **Local Markdown Vault: Search Document Vault** in the Command Palette.
The existing scoped `Cmd+Shift+F` / `Ctrl+Shift+F` shortcut also opens it.

Keyword mode is literal and case-insensitive. It searches filenames/titles and
full Markdown content, including YAML, code, tables, and callouts. A document is
returned once even when both its title and body match. Results include relative
paths, text excerpts, a matching-document count, and body-line navigation.
There is no 50-result UI cap, 200-result service cap, or 500-candidate cutoff in
this new full-document search.

The filter button explicitly enables advanced query syntax; the return button
restores literal keyword matching. Refresh reruns the current query. File/index
changes update an open search; changing exclusions closes stale results.

## Boundaries

- Search is read-only and local. It uses current unsaved text when available,
  without forcing a save or storing note bodies in the persistent index cache.
- Scope remains the safe Markdown index: up to 10,000 `.md` / `.markdown` notes,
  each at most 2 MiB, subject to existing metadata and memory limits. Excluded,
  oversized, non-Markdown, and unindexable files are outside that scope.
- The backend reports documents that become unreadable during a scan. The UI
  presents an incomplete-results warning rather than inventing empty content.
- Every read retains containment, symlink, size, UTF-8, and current-exclusion
  checks. Disposed or disabled indexes and incomplete rebuilds are not treated
  as successful empty searches.
- Only eight note reads run concurrently. Queries are bounded to 2,048
  characters, results retain bounded excerpts, old queries are canceled, and
  scan generations are serialized. Advanced regular expressions retain their
  existing bounded RE2-based engine.
- Enter cannot accept an obsolete result while the replacement query is busy.
  Empty and invalid queries display an explanatory row rather than a stale
  match or a permanently searching title.

## Issues addressed

1. The prior command was hard to discover, and its metadata-token candidate
   pass could miss code, punctuation, and late content. The new visible command
   scans authoritative note text and retains the old advanced service only for
   compatibility with existing internal callers.
2. Search results were silently capped at several layers. The new path returns
   every matching record in the supported index, with one result per document.
3. An exclusion change could race a search read before the index rebuilt.
   Reads now recheck current exclusions around asynchronous authorization and
   disk access; picker lifetime and index rebuild readiness are coordinated.
4. Case-fold expansion could shift navigation offsets after characters such as
   `İ`. Offset mapping now uses original document positions.
5. Fully quoted filter-looking text such as `"tag:work"` must remain literal in
   advanced mode. Unquoted filters retain their existing behavior.
6. Repeated advanced terms could remap a long Unicode prefix hundreds of times.
   Mapping now occurs once for the selected match, and repeated terms reuse
   their results. The same local 2 MiB stress case improved from approximately
   990 ms to 18 ms; a 290-term query completed in approximately 19 ms. These are
   local diagnostic measurements, not cross-platform performance guarantees.
7. Advanced regular expressions now preserve original metadata casing unless
   the expression explicitly enables case-insensitive matching.

## Validation

Tests run against synthetic notes in disposable macOS VS Code 1.139.1 profiles
with Node 26.8.2. No personal notes are used for mutation tests.

| Check | Result |
| --- | --- |
| Type checking and test compilation | Passed |
| Unit tests | 1,587 passed across 123 files |
| Browser rendering and editing tests | 559 passed |
| Dedicated native search tests | 13 passed on the production bundle |
| General native integration | 99 passed; 19 opt-in/platform cases pending |
| Focused desktop interaction tests | 47 passed |
| Index cache restart | 2 passed across two processes |
| Save durability | 20 passed, including denied-write recovery |
| Restricted workspace | 4 passed |
| Packaged VSIX | 16 passed: 10 trusted, 5 restricted, 1 disabled |
| US English and whitespace checks | Passed |
| Dependency policy and advisory audit | Passed; zero reported vulnerabilities |

The 13 native tests cover title-only, heading-only, body-only, combined and
case-insensitive matches; 526 results; late content beyond the token limit;
literal punctuation and emoji; current unsaved edits without a forced save;
external changes/deletion; excluded folders and outside-vault symlinks; toolbar
typing, counts, snippets, clear/cancel; mouse and keyboard acceptance; navigation
inside a paragraph, warning callout, and 12-line code block; mode toggling,
refresh, empty/invalid queries, rapid query changes, and inert hostile snippets.
Notes are checked for unchanged bytes after search-only interactions.

An initial native run passed 11 tests and failed one timing-sensitive assertion
that observed different stages of the same asynchronous title/item update. The
test now waits for the instruction row and idle title together. The final run
uses all 13 current tests and passes without weakening the required UI state.

All 201 executed native checks passed against the frozen production candidate.
Native runners were executed serially, each exited successfully, and disposable
fixtures were cleaned up. Expected denied-write errors were generated only by
the save-failure test. Mode-specific VSIX cases not applicable to a given phase
were intentionally skipped.

The refreshed `releases/local-markdown-vault-0.2.0.vsix` passed package validation
(64 archive entries). It was installed successfully in the local VS Code app;
all 62 installed extension files match the archive, allowing only VS Code's
added `package.json` installation metadata. The user's active window was not
forcibly reloaded. Save any active work, then run **Developer: Reload Window**
to activate the update in existing windows.

VSIX SHA-256:
`eb8ad24ef701012f3ab480a17f3c8e402a87d48bf7869c46aee86296e4cf1dfc`

Live Windows and Linux results are not claimed by this report. The dedicated
search runner is included in the cross-platform CI workflows.
