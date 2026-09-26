# Native Undo limitation for vault moves

Status: **native VS Code limitation remains; use the dedicated Vault Undo/Redo commands.**

Confirmed on macOS with VS Code 1.139.1 during September 25, 2026 QA:

1. Create `Alpha.md`, `Beta.md`, and an unopened `Index.md` containing `[Alpha](Alpha.md) and [Beta](Beta.md)`.
2. Select both notes in the Document Vault and drag them into `Destination`.
3. Wait for automatic saving. Both files move and Index's links correctly update on disk.
4. Use VS Code's **Undo** command while the moved note is active.

The notes return to their original locations, but Index's links can remain pointed at `Destination`. No note text was lost in this reproduction, but the resulting links are broken. Reopening Index after Undo does not restore them.

The native editor disposes Index's saved, never-displayed text model. VS Code's singleton text-edit undo element becomes invalid, and the grouped file operation subsequently undoes without that text edit. Keeping Index displayed before the operation passes the same regression. Native Undo also bypasses `onWillRenameFiles`, so reloading documents in that event is not a reliable fix. No raw-file overwrite, synthetic edit, or indefinite hidden-editor workaround was added.

## Safe workflow

Use **Local Markdown Vault: Undo Vault Move or Rename** or **Redo Vault Move or Rename** in the Command Palette. The same commands appear in the Vault's **…** menu and item context menu. They operate on the most recent vault transaction, not the selected item's editing history. A multi-item drag is one transaction.

Each command plans a fresh inverse or forward move and recalculates affected links against current note contents. Later writing is preserved; no stored note snapshots overwrite files. Collision, entry identity, parent identity, trust, policy, and vault lifecycle checks remain in force.

History is limited to 50 operations and stays in memory in the current window. It is cleared when the extension reloads or the vault changes. A new successful move clears Redo; unexpected native/external renames invalidate history. Changing automatic link updates or exclusions can make replay unsafe and is rejected. File replacement (including an external editor's atomic replacement) can invalidate an entry even when its displayed name has not changed.

If history is unavailable, **move the files back through the Document Vault tree or Move Vault Item command**, with automatic link updates enabled. Do not rely on native Undo for the scenario above, and do not mix native file-operation Undo with dedicated Vault history. The dedicated commands do not replace ordinary text Undo/Redo shortcuts.

## Reproduce

After building the extension and integration tests, run:

```sh
MDLP_VAULT_UNDO_LIFETIME_TEST=1 node scripts/run-focused-desktop-integration.mjs
```

This opt-in diagnostic intentionally fails the unopened-index case and passes the displayed-index control. It is not silently included as a passing default test. The human UI runner separately records the defect in `knownIssues` while continuing unrelated gesture tests.
