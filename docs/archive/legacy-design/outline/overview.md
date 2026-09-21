# Outline View — Original Design Overview

## Purpose

Provide an extension-owned heading list for the active Markdown Live Preview editor. VS Code's built-in Outline view targets text editors and does not cover this webview-based custom editor.

## Original feature set

- List ATX headings from levels 1 through 6.
- Move the editor cursor to a selected heading.
- Follow the active Live Preview tab.
- Refresh after document edits with a 150 ms debounce.
- Show an explanatory empty state when no Live Preview document is active.

## Interfaces

The Outline webview exchanged bounded `update`, `noDocument`, `ready`, and `jumpToHeading` messages with the extension host. The host forwarded validated jumps to the editor as `jumpToLine` messages.

This archived design describes the original July 22, 2026 implementation. Current behavior and security requirements are defined by the source, tests, and product documentation.
