# Obsidian Interaction Parity

This document records the editing-behavior comparison for Local Markdown Vault's **Markdown Editor** mode. The comparison target is Obsidian 1.13.7 on macOS in Editing view with Live Preview enabled. Test notes are disposable and contain no user documents.

## Research baseline

The interaction model follows Obsidian's official documentation:

- [Views and editing mode](https://obsidian.md/help/edit-and-read) defines Editing view, Live Preview, Source mode, and the rule that Markdown syntax becomes visible around the caret.
- [Editing shortcuts](https://obsidian.md/help/editing-shortcuts) defines copy, cut, paste, undo, redo, navigation, selection, deletion, and macOS bold and italic shortcuts. It also specifies line-wise copy and cut when no text is selected.
- [Basic formatting syntax](https://obsidian.md/help/syntax) defines Enter and Shift+Enter behavior, automatic list continuation, tasks, nested lists, formatting, highlights, and fenced code.
- [Advanced formatting syntax](https://obsidian.md/help/advanced-syntax) defines editable tables and their row, column, movement, alignment, and sorting operations.
- [Obsidian Flavored Markdown](https://obsidian.md/help/obsidian-flavored-markdown) identifies the CommonMark, GitHub Flavored Markdown, LaTeX, wikilink, embed, task, highlight, callout, and table syntax expected from the editor.

## Native comparison method

The same disposable Markdown note was opened in Obsidian 1.13.7 and in the packaged Local Markdown Vault editor. The macOS comparison used real clicks and key events, including mouse drag selection, Cmd+C, Cmd+X, Cmd+V, Cmd+A, Cmd+B, Cmd+I, Cmd+Z, Cmd+Shift+Z, Return, Shift+Return, Tab, Shift+Tab, Backspace, Delete, arrows, Home, and End. File contents were then read from disk so visual success could not conceal an incorrect Markdown result.

The automated browser suite repeats the extension side with the production webview bundle. It verifies the exact Markdown copied or produced, the rendered state, and the messages sent to the VS Code host.

## Parity matrix

| Interaction | Obsidian 1.13.7 result | Markdown Editor requirement | Automated coverage |
|---|---|---|---|
| Type, replace, Backspace, Delete | Mutates the selected source range | Same exact source mutation | `interactionParity.spec.ts`, `editing.spec.ts` |
| Mouse-drag a word, copy, replace, or delete | Native text selection; typing replaces it | Same | `interactionParity.spec.ts`, `editing.spec.ts` |
| Keyboard selection and copy | Shift+arrow extends selection; copy preserves exact text | Same | `interactionParity.spec.ts`, `obsidian100Compatibility.spec.ts` |
| Copy or cut with no selection | Copies or cuts the current Markdown line | Same line-wise behavior | `interactionParity.spec.ts` |
| Cmd+B and Cmd+I | Wraps a selection or starts a pair; repeating after typed content exits the pair | Same, including caret movement past the closing marker | `interactionParity.spec.ts`, `emphasisShortcuts.test.ts` |
| Return in numbered and task lists | Continues with the next number or a new unchecked task | Same | `editing.spec.ts`, `interactionParity.spec.ts` |
| Return on an empty list item | Ends the list | Same | `editing.spec.ts` |
| Shift+Return | Inserts a soft continuation without a new list marker | Same indentation and source bytes | `editing.spec.ts`, `interactionParity.spec.ts` |
| Tab and Shift+Tab in lists | Indents and unindents the item; nested bullets change shape | Same | `interactionParity.spec.ts`, `obsidian100Compatibility.spec.ts` |
| Click a task checkbox | Toggles the marker and completed-task strike-through | Same, followed by automatic save | `rendering.spec.ts`, packaged integration tests |
| Fenced code editing | Normal typing remains inside the fence; a user can leave the block and copy its content | Same, with an additional explicit escape shortcut and copy control | `editing.spec.ts` |
| Highlight editing | Syntax reveals at the caret and normal text can be entered afterward | Same | `editing.spec.ts`, `obsidian100Compatibility.spec.ts` |
| Tables | Cells are editable and structural actions operate on the selected row or column | Same source-preserving operations and keyboard access | `rendering.spec.ts` |
| Select an entire rendered table or fenced block | Selection can be copied or removed | Same; the extension exposes deterministic whole-block selection | `rendering.spec.ts`, `editing.spec.ts` |
| Undo and redo | Restores editing operations | Flush pending edits first, then use VS Code's document undo stack | `interactionParity.spec.ts`, integration tests |

## Viewing-mode ownership

**Markdown Editor** now means Local Markdown Vault's extension-owned, Obsidian-style editor and is the default. **VS Code Markdown Editor** remains available as a separate option for Microsoft's `vscode.markdown.editor`. This distinction is necessary because an extension cannot safely inject editing behavior into another extension's editor surface.

The older **Markdown Live Preview** option remains as a compatibility alias for the same Local Markdown Vault editor, so existing settings continue to work.

## Release gate

A parity change is releasable only when:

1. the exact source result matches the observed Obsidian result or a documented security/accessibility exception;
2. mouse-only, keyboard-only, and mixed interaction tests pass;
3. automatic save and undo/redo preserve normal VS Code document behavior;
4. the malicious-Markdown and message-validation suites still pass; and
5. the packaged VSIX passes its installation and smoke tests.
