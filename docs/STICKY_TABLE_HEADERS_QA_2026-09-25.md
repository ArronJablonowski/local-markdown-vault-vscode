# Optional sticky table headers — September 25, 2026

## Behavior

- `mdLivePreview.stickyTableHeaders` is a resource-scoped boolean, default `false`.
- CSS Themes → Settings exposes the same preference as an Off/On selector.
- Live Preview updates existing tables without editor reconstruction, document
  transactions, or clearing active table-cell drafts. Header positioning and the
  wide-table overlay are both disabled when the preference is off.
- Horizontal table scrolling is independent of the preference. When enabled,
  wide sticky headers retain measured column alignment and scroll synchronization.
- Built-in Markdown Preview uses VS Code's official Markdown renderer hook to
  mark generated tables only when the preference is strictly `true`. A setting
  change schedules a bounded 350 ms trailing refresh. Cached parser tokens are
  not permanently modified.
- Production exports only the renderer hook; development-only vault/test APIs
  remain unavailable. No dependency, network access, or new file-write path was
  added. Host/sidebar messages accept only the exact boolean setting payload.

## Verification

Reference environment: macOS, VS Code 1.139.0, Node.js 26.8.2. Native UI runs use
disposable profiles and notes, restoring changed settings and clipboard contents.

- Unit suite: 1,438 tests across 118 files passed.
- Source and integration-test TypeScript checks passed.
- US English and dependency-policy checks passed; dependency audit reported no
  known vulnerabilities.
- Production VSIX structural check passed: 63 archive entries.
- Browser suite against the production bundle: 525 tests passed.
- Native VS Code UI suite: 42 tests passed, including exact saved-byte checks
  after preference changes with an active table-cell draft.
- The final preview-refresh correction changes only the extension-host bundle;
  every other packaged payload is byte-identical to the full UI-tested build.
- Final installed-VSIX smoke suite: 16 tests passed across trusted, restricted,
  and disabled configurations, including built-in Preview off/on/off rendering.
- Final native settings regression rerun: 3 tests passed.
- Installed the tested VSIX in the user's VS Code and verified all 61 installed
  payload files against the archive (excluding VS Code's manifest metadata).
  Existing windows require **Developer: Reload Window** to activate the update;
  no user window was forcibly reloaded.

Coverage includes default-off behavior; narrow/wide tables in Editing and Locked
modes; multiple tables; repeated live toggles during vertical/horizontal scrolling;
unchanged Markdown, scroll position, and active cell drafts; sidebar persistence
and workspace overrides; and built-in Preview default-off/on/off rendering.

Initial UI assertions were corrected to match the existing implementation:
sidebar controls have implicit labels, and the sticky overlay container has zero
height by design. Tests check the overlay's hidden state, visible clipping child,
and measured header geometry rather than treating the zero-height container as
a visible box. No production behavior was changed to satisfy those assertions.

Packaged testing also exposed a VS Code Preview refresh race: an immediate forced
refresh can be ignored while its initial ordinary refresh timer is pending, then
the unchanged-document check leaves the old rendering visible. The extension's
single trailing refresh timer avoids that race, coalesces rapid setting changes,
and is canceled on disposal. The native regression changes the setting directly
after opening a preview, without a test-only delay or manual refresh. It selects
the authored Markdown table, not VS Code's separate YAML-properties table.
