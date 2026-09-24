# Sidebar visibility fix — September 24, 2026

## Cause and correction

The Vault listened to every VS Code tab-change event, including dirty/save
changes, and called `TreeView.reveal`. Even with `focus: false`, that API can open
a hidden sidebar, replace another sidebar container, or expand a collapsed view.

Automatic reveal now:

- Checks view visibility before resolving a file and again before revealing it.
- Ignores repeated dirty/save events for the same active file and vault.
- Waits 100 ms for file/visibility transitions to settle before starting a
  passive reveal. Hiding, switching, or disposal cancels this wait immediately;
  repeated dirty/save events do not restart it. At most one timer is retained.
- Discards obsolete asynchronous results after hiding, file/workspace changes,
  setting changes, or disposal.
- Uses request-only guarded tree entries and parents so provider callbacks can
  cancel an obsolete reveal after VS Code finishes waiting for a tree refresh.
  Ordinary tree entries are unaffected, and guards are removed on completion.
- Follows the active note when the user explicitly shows the Vault again, and
  follows genuine active-file/group changes only while the view is visible.

File watching, indexing, and autosave continue while the sidebar is hidden. No
filesystem authority, network policy, save behavior, or resource limit changed.

## Regression evidence

Before the fix, native tests typed text into Live Preview and verified the exact
saved file bytes, then failed because the sidebar reopened. A second test typed
with Search visible and verified that the Vault unexpectedly replaced Search.

Nineteen unit regressions cover hidden/collapsed views, dirty/save-event deduplication,
pending lookup races, active-file and vault changes, disabled auto-reveal, errors,
disposal, timer cancellation, guarded parents, and request cleanup. Native checks
exercise Live Preview typing, task checkboxes,
explicit saves, Text Editor typing, switching files while hidden, Search staying
visible, a collapsed Vault section, and explicit reopening with the correct
active note selected. Native tests use disposable macOS VS Code profiles/notes.

Final trace-free build verification on macOS 27 / VS Code 1.139:

- 1,302 unit tests across 112 files passed, including 19 focused reveal tests.
- All 39 native focused desktop tests passed, including both sidebar regressions.
- All 20 save-durability tests passed against the production bundle, including
  continuous typing, checkbox saves, interrupted writes, and recovery paths.
- Both native sidebar regressions passed again against the production bundle.
- All 15 installed-VSIX smoke tests passed: nine trusted, five restricted, and
  one with the extension disabled. Profile-specific skips are intentional.
- Production compilation, test type checking, US English verification, and
  whitespace checks passed.
- VSIX validation passed: 63 archive files, 3,704,845 compressed bytes.

The release package SHA-256 is
`37d4a4d99fb9d5508060119750db6dbcb0b52ffac59ce9717951994a3f80ab50`.

The release VSIX was installed in this system's VS Code. All 61 installed payload
files match the archive, allowing only VS Code's manifest installation metadata.
Reload the existing VS Code window to activate the fix. Changes and the installer
are committed locally; GitHub upload remains on hold.

The first visibility-guard-only candidate passed the isolated cases but reopened
the sidebar under a full-suite transition race. A settling delay alone did not
fix that race. Diagnostic tracing confirmed VS Code completed an older reveal
after the view became hidden. With guarded provider callbacks, the same native
five-test sequence passed: a request dispatched at 19:18:51.859 UTC was canceled
by a provider callback at 19:18:52.181 UTC after the view hid at 19:18:51.954 UTC.
The sidebar stayed hidden and saved bytes remained exact. Temporary trace logging
was removed before the final build. Hidden-state and exact-content assertions
were not weakened. Existing
Outline QA now explicitly opens Outline instead of depending on the old sidebar
hijack. A native-editor test also waits for its required clean document/tab state
before a deliberate close, without forcing a save or removing byte checks.

## API limitation

VS Code does not expose cancellation for a `TreeView.reveal` already dispatched;
it performs additional internal asynchronous work before showing the tree. A
user hiding a view after the last provider callback but before VS Code's final
internal reveal RPC can still race VS Code. The guarded callbacks cover the
observed refresh-wait race. This fix also suppresses repeated edit/save-triggered
reveals and cancels pending lookups; it does not force-toggle the user's
workbench to compensate for VS Code's internal behavior.
