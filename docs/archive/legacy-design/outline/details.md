# Outline View — Original Detailed Design

## Heading extraction

`extractHeadings(text)` scans lines for level 1–6 ATX headings and ignores fenced code blocks while tracking the fence marker and length. It returns one-based line numbers suitable for CodeMirror navigation.

## Active editor coordination

The editor provider identifies the active `mdLivePreview.editor` tab, obtains headings from its document, and forwards validated line jumps to the corresponding session. A stale or out-of-range line is ignored safely.

## Outline provider

The provider listens for tab and text-document changes, refreshes after a short debounce, and posts either heading data or an empty state. The webview renders keyboard-operable entries and sends a bounded heading-selection message to the host.

This archived note reflects the original July 22, 2026 design and is retained for historical context only.
