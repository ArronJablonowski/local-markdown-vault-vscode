# Test Infrastructure — Original Design Overview

The original unit-test foundation used Vitest and fast-check in a Node.js environment. It focused on DOM-independent functions and constructed the same CodeMirror Markdown and GFM syntax trees used by production code.

The initial scope covered CSS adaptation, front matter detection, and table-cell parsing through example-based and property-based tests. Current test commands and release gates are documented in the root README and release checklist.
