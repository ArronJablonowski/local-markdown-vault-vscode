# Windows and Linux testing

Local Markdown Vault uses one universal VSIX for Windows, macOS, and Linux. Use a disposable local folder for the first test. Do not use a cloud-synchronized, network, or production folder.

## Install the test build

1. Download `releases/local-markdown-vault-0.2.0.vsix` from this repository.
2. Open VS Code 1.90 or newer.
3. Open **Extensions** with `Ctrl+Shift+X`.
4. Select the **...** menu, then **Install from VSIX...**.
5. Select the downloaded VSIX and reload VS Code when prompted.
6. Open a disposable local folder. Its name should appear at the top of **Document Vault**.

If the **...** menu is hidden, open the Command Palette with `Ctrl+Shift+P` and run **Extensions: Install from VSIX...**. Compare the download's SHA-256 value with `releases/SHA256SUMS` before installing it.

## Core test on both platforms

1. Create a folder and a Markdown note from the Document Vault toolbar.
2. Rename and move both items. Confirm that affected Markdown links update.
3. Type in Markdown Editor, click a task checkbox, and confirm each change reaches the file on disk automatically.
4. Create ordered, bulleted, nested, and task lists. Confirm Return continues each list and nested bullets use different marker shapes.
5. Enter and leave a fenced code block with Return and Arrow Down.
6. Open a wikilink, local image, callout, table, footnote, property block, and Mermaid diagram.
7. Delete the test note. Confirm it appears in the operating system's Recycle Bin or Trash and can be restored.
8. Rename a note by changing only letter case and verify its links and exact filename.
9. Change a note outside VS Code and verify the open editor and Document Vault update promptly.
10. Put the workspace in Restricted Mode and verify editing remains available while diagrams, custom CSS, and vault-wide mutations are disabled.

## Windows checks

- Test on a local NTFS folder.
- Confirm deleted entries appear in the Windows Recycle Bin.
- Test paths containing spaces, accented letters, and emoji.
- Confirm a junction or symbolic link cannot expose files outside the vault.
- Complete the keyboard and screen-reader checklist in `docs/ACCESSIBILITY.md` with NVDA.

## Linux checks

- Record the distribution, desktop environment, filesystem, VS Code version, and whether VS Code is a native, Snap, or Flatpak installation.
- Confirm deleted entries appear in the desktop Trash and can be restored.
- Verify that `Note.md` and `note.md` behave as distinct names on a case-sensitive filesystem.
- Confirm a symbolic link cannot expose files outside the vault.
- Complete the keyboard and screen-reader checklist in `docs/ACCESSIBILITY.md` with Orca.

## Report a problem

Include the operating system and version, filesystem, VS Code version, extension version, installation type, exact steps, expected result, actual result, and whether the workspace was trusted. Do not attach private vault content. Security issues should be reported privately using the process in `SECURITY.md`.
