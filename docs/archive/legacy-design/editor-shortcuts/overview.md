# Editor Shortcuts — Original Design Overview

## Purpose

Add keyboard commands to the CodeMirror-based Live Preview editor without requiring extension-host communication.

## Original shortcuts

| Action | Shortcut | Behavior |
| --- | --- | --- |
| Toggle bold | `Ctrl+B` / `Cmd+B` | Add or remove `**` around each selection. |
| Toggle italic | `Ctrl+I` / `Cmd+I` | Add or remove `*` around each selection. |

An early search-and-replace integration was temporarily withdrawn in July 2026 because its panel did not yet match VS Code interaction and layout expectations. Search was subsequently redesigned and is covered by the current implementation and tests.
