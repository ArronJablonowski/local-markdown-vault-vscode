# Editor Shortcuts — Original Detailed Design

## Emphasis toggling

`computeEmphasisToggle` removes markers included inside a selection, removes adjacent markers surrounding a selection, or inserts a new marker pair. An empty selection places the cursor between the new markers. `toggleEmphasisCommand` applies the operation to every CodeMirror selection in one transaction.

The keymap registers `Mod-b` and `Mod-i` before the default keymap so the extension behavior wins consistently.

## Historical search experiment

The original experiment used `@codemirror/search`, `searchKeymap`, and a custom `Mod-h` command that focused the replacement field. That wiring was removed on July 23, 2026. The modern search implementation supersedes this archived design.

Nested bold and italic markers are handled as independent marker types; the original helper did not attempt semantic conversion of combined markers.
