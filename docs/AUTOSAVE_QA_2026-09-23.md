# Markdown autosave QA — September 23, 2026

## Findings and fixes

- Live Preview restarted a 250 ms timer on every edit, and the host restarted a
  500 ms save timer. Continuous typing could indefinitely postpone persistence.
  Both now schedule work on the next event turn without an idle-typing delay.
- Faster synchronization needs explicit ordering: only one edit batch is in
  flight; later edits remain queued until its acknowledgment supplies the next
  document version. Undo/redo waits behind those pending edits.
- VS Code sometimes publishes the dirty flag after the content-change event.
  A real desktop test reproduced a checked task in the document but not on disk.
  Autosave now observes that later dirty-state notification as well.
- Path authorization and saving are serialized together. Edits arriving during
  either operation request a follow-up save. Already-dirty documents are saved
  when tracking begins. Failure notifications do not trigger a retry loop.
- Failed or security-ineligible automatic saves now produce a visible warning
  instead of only an internal diagnostic. The document remains available for a
  manual save; the extension does not bypass path containment or size limits.
- Valid property edits were discarded when clicking away. They now commit on
  focus loss; Escape still cancels, and invalid values retain validation errors.
- A background vault-index refresh could reveal source beneath a table cell
  during typing, commit only a prefix, and remove keyboard focus. Keyboard input
  in rendered table/property controls now preserves their rendered editing state.

## Verification

New unit tests cover continuous edits, delayed dirty-state notification, a slow
authorization check, edits during an in-flight save, already-dirty documents,
false/throwing save failures, failure-notification loops, disabled autosave, and
symlink rejection. Browser tests cover delayed acknowledgments, ordered undo,
continuous typing, property focus loss, and a vault refresh during cell editing.

Isolated macOS VS Code tests read actual file bytes with VS Code's own autosave
disabled. They verify that text appears on disk before continuous typing ends,
that switching files preserves the completed text, and that tasks, callout tables,
list edits, complex tables, mouse cut/paste, undo/redo, and vault moves persist.
All fixtures are disposable; personal notes and application settings are untouched.

Final regression results: 1,019 unit tests, 417 browser tests, and nine focused
real-VS-Code scenarios passed. The diagram scroll check was corrected to wait for
an asynchronously mounted SVG before scrolling its widget out of the viewport.
All 15 packaged-extension checks passed across trusted, restricted, and disabled
configurations. The tested VSIX was installed locally; an existing VS Code window
must be reloaded to run the updated extension code.

## Scope and limits

“Immediate” means no intentional typing-idle delay, not synchronous durable disk
storage. IPC, filesystem writes, and VS Code save participants remain asynchronous.
This is not a guarantee against power loss, process termination, storage failure,
or conflicting edits from another application.

Autosave applies to Markdown document changes inside the supported local vault
when `mdLivePreview.autoSave` is enabled. Unsaved/unsupported locations require a
manual save. Table and property fields still have explicit draft/commit semantics:
Enter, Tab (tables), or leaving a valid field commits to Markdown; Escape cancels
the draft. Text still being edited inside an uncommitted field is not yet saved.
This pass does not claim per-keystroke durability for those field drafts.

Native testing in this pass was on macOS, not Windows or Linux.
