# Image Paste and Drop — Original Design Overview

The original feature accepted an image from the clipboard or a drag-and-drop operation, saved it under an `assets/` folder beside the note, and inserted relative Markdown image syntax. The host generated collision-resistant filenames and performed the filesystem write and document edit.

The current implementation has stricter vault containment, MIME verification, image limits, transaction guards, and configurable attachment placement. Refer to the current source, security policy, and tests for authoritative behavior.
