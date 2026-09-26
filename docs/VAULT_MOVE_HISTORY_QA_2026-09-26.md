# Vault move history QA — September 26, 2026

## Scope

Implemented the approved dedicated **Undo Vault Move or Rename** and **Redo Vault Move or Rename** commands. Both appear in the Vault title's **…** menu, file/folder context menus, and Command Palette. They do not intercept ordinary text Undo/Redo shortcuts.

Validation used macOS, VS Code 1.139.1, Node 26.8.2, synthetic notes, and isolated test profiles. Personal notes and the normal VS Code profile were not used for destructive testing. This report does not claim live Windows or Linux validation; those platforms have the new regression suite in CI.

## Behavior and safety checks

- Up to 50 transactions are held in memory per vault/window. No note snapshots or additional content files are retained by move history.
- Undo/Redo plans a new move against current note contents, including incoming links in notes that were never displayed. Later saved and unsaved writing is preserved.
- Multi-item moves are one history entry. New successful moves clear Redo. Reloads, workspace changes, and unexpected native rename events invalidate history.
- Replays validate workspace generation, Workspace Trust, source and parent identity, containment, current document versions, exclusion/link-update policy, and destination collisions. Replacement files, folders, and symlinks cannot silently inherit a previous entry's authority.
- Failed preconditions leave the transaction available for a safe retry when appropriate. Unverifiable identity after a successful fresh move clears history instead of falsely reporting that the move failed.
- History commands become unavailable while busy, without history, or in Restricted Mode. They act on the latest transaction, not whichever item happens to be selected.

## Issues found and corrected

1. **Expired drag cancellation:** a completed drag's cancellation token must not prevent a later Undo. Replays now use fresh lifecycle/history guards; the original drag still honors cancellation.
2. **Case-only rename events:** VS Code can emit the original capitalization for the destination of a staged case-only rename. The observer accepts only the two validated spellings of that exact operation; final filename spelling is still verified.
3. **Wikilink shadowing:** a newer root note or duplicate basename could cause fresh inverse planning to retarget an unrelated wikilink. Planning now checks current root-path precedence/basename uniqueness and retains a disambiguated destination and explicit Markdown extension.
4. **Fresh-move compatibility:** persistent replay identity requirements must not accidentally prohibit existing fresh-move behavior for supported symbolic links or providers with weak identity information. Such successful moves remain allowed but are not recorded as replayable history when identity cannot be verified.
5. **Conflict reporting regression:** broader native QA found that a new identity check returned a raw filesystem error if a case-only source disappeared at the staging boundary. Both identity boundaries now preserve the classified conflict with safe vault-relative endpoints; a unit regression complements the existing native test.

## Results

| Check | Result |
| --- | --- |
| Type checking and integration-test compilation | Passed |
| Unit tests | 1,532 passed across 122 files |
| Browser rendering/editing regressions | 559 passed |
| Dedicated native move-history suite | 21 passed, then all 21 passed again on the final production bundle |
| Production general integration suite | 98 passed; 19 opt-in tests skipped by this runner |
| Production focused desktop UI suite | 47 passed |
| Production save-durability suite | 20 passed |
| Production Restricted Mode suite | 4 passed, including both history command guards |
| Installed-VSIX smoke suites | 16 passed: 10 trusted, 5 restricted, 1 disabled |
| Mouse/keyboard Vault gesture checks | 6 passed; known native Undo failure remains separately reported |
| US English repository verification | Passed |
| Dependency policy | Passed: 797 locked / 182 production packages |
| npm advisory audit | Zero reported vulnerabilities |
| VSIX manifest/content verification | Passed: 64 archive entries |

The packaged smoke runs also have 23 profile-specific skips; they are not counted as passes. General integration's opt-in skips are separate from the explicitly executed standalone suites above.

The 21 dedicated native regressions cover repeated Undo/Redo, never-displayed links, folder trees and binary attachments, case-only file/folder renames, later saved/dirty edits, missing/replaced/symlink sources, replaced parent folders, collisions, concurrent invocations, branching history, policy changes, and ambiguous/root-shadowed wikilinks. The native suite is registered in both CI workflows.

Actual workbench gestures include multi-selection dragging, Undo through the Command Palette, Redo through a right-click menu, exact file/link readback, canceled drags, collision rejection, Unicode names, invalid rename/folder inputs, and move-picker cancellation. Both history menu items were verified disabled after an unrelated native Undo invalidated history.

One initial UI run stopped on a transient Command Palette focus/visibility timeout after the dedicated Undo/Redo check had passed. An unchanged rerun completed all six gesture checks. That initial run is not counted as a pass; it remains an automation stability limitation.

The first production general-integration run had 97 passing tests and one failure in case-only conflict reporting. The correction described above passed the full rerun without weakening that native assertion.

Native host logs included missing-temporary-file local-history warnings during intentional case-rename races, and expected permission-denied errors during save-failure tests. The corresponding final-path/content and recovery assertions passed; a passing result does not mean the host emitted no diagnostic warnings.

## Release artifact

- Package: `releases/local-markdown-vault-0.2.0.vsix` (3,719,660 bytes, 64 archive entries).
- SHA-256: `a5eeb77e1cd22ffdc727c9c07bd9c370a0f635c0b60b822c0c5312d73069f57d`.
- Installed successfully into the local VS Code application. All 62 installed extension payload files match the tested VSIX, excluding only VS Code's added manifest metadata.
- The user's existing VS Code windows were not forcibly reloaded. Save work and run **Developer: Reload Window** to activate the updated extension in an already-open window.

## Known limitation

VS Code's built-in file-operation Undo can still restore moved files without restoring links in saved, never-displayed notes. The gesture runner intentionally reports this as a failure and exits nonzero, rather than hiding it in a green result. The dedicated Vault commands are the tested alternative; ordinary native Undo was not fixed or replaced. See [the native Undo limitation](NATIVE_VAULT_UNDO_LIMITATION.md).

History is not a backup or a crash/power-loss recovery mechanism. External atomic replacement can intentionally invalidate a history entry. No test suite proves the absence of all bugs or data-loss scenarios.
