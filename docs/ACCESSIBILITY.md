# Accessibility verification

Local Markdown Vault uses native VS Code controls for the Document
Vault and knowledge-navigation trees, and semantic HTML controls inside the
Live Preview webview. Accessibility is a release requirement, not an optional
enhancement.

## Implemented behavior

- Document Vault files, folders, and symbolic links have localized,
  vault-relative screen-reader labels. Absolute filesystem paths are not used
  as accessible names or hover text.
- Backlinks identify linked versus unlinked mentions and announce the relative
  source path and line. Tags announce their full nested tag and note count.
  Broken links announce the target, reason, relative source path, and line.
- Callout toggles, tasks, properties, footnotes, embeds, table controls, source
  toggles, and search controls use semantic elements or explicit roles,
  accessible names, and state attributes.
- Mermaid and draw.io zoom, reset, page, and fit/native controls use localized
  descriptive names rather than exposing their visual glyphs to assistive
  technology. The fit/native name updates with the current mode.
- Mermaid, draw.io, YAML, math, and embed failures use `alert` or `status`
  semantics. Normal editing does not announce each keystroke.
- Rejected image paste and drop operations use a localized `alert` that explains
  whether the file type, empty input, batch count, byte limit, or read failed.
  A subsequent valid image operation clears the stale warning.
- Native file operations and completed index rebuilds report completion through
  VS Code's accessible notification surface using concise, localized,
  vault-relative messages. Failures use VS Code warning or error messages.
- High-contrast colors and focus outlines use VS Code theme variables. Controls
  remain focusable at 200 percent zoom.

## Keyboard paths

| Surface | Keyboard operation |
| --- | --- |
| Live Preview focus | Tab indents Markdown while editing. Press Escape, then Tab to move from the editor into rendered controls; continue with Tab or Shift+Tab. `Ctrl+M` (`Shift+Option+M` on macOS) toggles CodeMirror's persistent Tab-focus mode. |
| Document Vault | Arrow keys navigate; Enter opens; F2 renames; Delete moves to Trash (`Cmd+Backspace` on macOS); context-menu **Move Vault Item…** opens a searchable folder picker. |
| Quick Switcher | `Ctrl+O` / `Cmd+O`, type to filter, arrows select, Enter opens or explicitly creates a note, Escape closes. |
| Vault Search | `Ctrl+Shift+F` / `Cmd+Shift+F` while the editor or Vault has focus; type to filter, arrows select, Enter opens, Escape closes. |
| Tasks and callouts | Tab to the control; Space or Enter toggles it. |
| Properties | Tab into a property; Enter starts editing; Enter commits; Escape cancels and returns focus. Single wikilinks and every item in a wikilink list expose separate named links plus one edit control, so navigation and editing are independently keyboard reachable. Malformed list or typed-number input retains focus and exposes a localized, screen-reader-associated error until corrected. |
| Footnotes and links | Tab to the link; focusing a resolved wikilink shows the same delayed, local-only preview as pointer hover and associates it as an accessible description; Enter follows the link. Footnote return controls restore the reference location. |
| Tables | Tab reaches source-backed cells; arrow keys move through the grid; Enter or F2 starts editing; Tab and Shift+Tab move between cells while editing; Enter commits; Escape cancels; focusing a cell enables the named row and column toolbar operations. |
| Rendered blocks | Each diagram, table, and property block provides a keyboard-accessible source-mode escape hatch. |
| CSS Themes | Native radio controls select a theme with Tab, arrow keys, and Space; separately named buttons edit, duplicate, rename, or delete it. |

## Automated release gates

The Playwright accessibility suite runs Axe against representative Live Preview
content using WCAG 2 A/AA, WCAG 2.1 AA, and WCAG 2.2 AA rules. It also focuses
every enabled interactive control at 200 percent zoom in high-contrast mode.
Unit and integration tests verify localized strings, command contributions,
keyboard shortcuts, and safe error states.

The clean-profile packaged-VSIX gate additionally selects VS Code's real
built-in high-contrast theme, drives the workbench to at least 200 percent
effective zoom, and follows the Escape-then-Tab path through task, callout,
table, and source-mode controls. It verifies visible focus, viewport access,
accessible source-control names, and restores the disposable profile's theme
and zoom afterward. A second installed-VSIX journey operates typed-property
validation and cancel, callout and task toggles, table-grid movement and edit
cancel, both directions of footnote navigation, and the diagram source escape
entirely through keyboard input. It then proves the dedicated fixture is clean
and byte-identical. Separate installed-VSIX journeys use VS Code's native
`aria-activedescendant` tree model to reach a newly created note and folder with
Home/Arrow keys, open the note with Enter, expand the folder with ArrowRight,
and, on macOS and Windows, operate the CSS Themes sidebar with Tab plus native
radio-group arrow keys. The CSS journey also reaches the separately named edit,
duplicate, rename, and delete controls without a pointer and restores the
original selected theme. Linux Electron currently exposes editor webviews but
not sidebar `WebviewView` out-of-process frames to the loopback Playwright/CDP
session, so Linux enforces the sidebar's semantic keyboard behavior in the
platform-independent browser suite and verifies that the installed view can be
revealed in the extension-host suite; manual Orca review remains required.

Automated scans do not prove screen-reader usability. A release is not signed
off solely because Axe reports no critical violations.

## Manual release checklist

Run the following against the packaged VSIX, using a vault that contains
folders, symlinks, backlinks, unlinked mentions, nested tags, a broken link,
properties, a collapsed callout, a task, a table, Mermaid, and an invalid
diagram.

1. Complete every keyboard path above without using a pointer and verify that
   focus is always visible and never trapped.
2. On macOS with VoiceOver, verify the Document Vault and each knowledge tree,
   then the representative Live Preview document at 100 and 200 percent zoom.
3. On Windows with NVDA, repeat the tree, editor, dialog, completion, and error
   announcement flows.
4. On Linux with Orca where Linux packaging is supported, repeat the native
   tree and core editing flows.
5. Repeat with VS Code light, dark, high-contrast, and high-contrast-light
   themes. Check text, focus, selected, hover, disabled, and error states.
6. Trigger successful create, rename, move, and trash operations and verify one
   concise completion announcement for each. Trigger a rejected move, an
   unsupported image paste, and a renderer error and verify a single actionable
   error announcement for each.
7. Confirm that accessible labels and tooltips contain vault-relative paths,
   not user-profile or other absolute filesystem paths.

Record the VS Code version, operating system, assistive-technology version,
extension VSIX checksum, failures, and retest result in the release record.

## Reporting accessibility problems

Use the project's issue tracker for ordinary accessibility defects. Security or
privacy issues involving content disclosure, unsafe navigation, or filesystem
access should follow the private process in `SECURITY.md`.
