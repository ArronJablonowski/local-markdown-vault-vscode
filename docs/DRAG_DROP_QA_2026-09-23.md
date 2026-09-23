# Vault drag-and-drop QA — September 23, 2026

## Confirmed defects and fixes

1. Real file drags failed before reaching the drop handler. VS Code serializes
   transfer data, but each transferred TreeItem referred to itself through its
   Open command arguments. The workbench reported a circular-JSON error. Transfer
   data now contains only URI strings, with size, count, type, URI, filesystem,
   workspace, and trust checks at the destination. Direct handler tests alone
   missed this defect; the mouse-driven VS Code test reproduced it.
2. Selecting a folder and a descendant attempted overlapping moves. Descendants
   are now covered by their selected parent instead of being moved separately.
3. A symbolic-link drop target was treated as a file and redirected the move into
   its parent. Such targets are now explicitly rejected.
4. The drop cancellation token was ignored. It is now checked before work starts
   and included in the transaction's current-operation checks.

## Verification

- Native macOS VS Code mouse movement, button-down/up, and hover exercised file
  and folder drops in the real Document Vault tree. Filesystem checks confirmed
  the new locations and preserved children. Undo from an affected note restored
  the folder move.
- Eleven host scenarios exercise actual DataTransfer serialization: file moves
  and link rewriting; parent-plus-child selections; multiple and duplicate
  selections; spaces in filenames; dropping onto a file's parent; collision
  rejection; self/descendant rejection; same-parent no-ops; malformed/stale data;
  cancellation; symbolic links; oversized selections; hostile serialized values;
  and empty-space drops to the root. Several scenarios cover multiple cases.
- Six selection-normalization unit cases verify hierarchy preservation and prefix
  boundaries. The complete unit suite passed 1,025 tests.
- Fixtures were isolated disposable files, not personal notes.
- All 15 packaged-extension checks passed across trusted, restricted, and disabled
  configurations. The tested VSIX was installed locally; reload existing windows
  to activate it.

## Behavior and limitations

Dragging changes filesystem locations, not arbitrary visual positions. The tree
continues to sort by its configured name/date order, with folders first. No custom
manual-order feature was added in this pass.

Undo was verified from a note affected by link rewriting. An Undo command issued
with only the custom tree focused did not restore the move in the test; do not
assume tree-focused keyboard Undo works. Root drops and hostile payloads were
checked at the host-handler boundary, not with native mouse gestures. Native
Windows/Linux testing and cross-window/external-file import are outside this pass.
