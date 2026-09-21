# Front Matter Preview — Historical Requirements

## Goal

Render YAML front matter at the beginning of a Markdown document as an editable property table while preserving ordinary Markdown as the stored source.

## Requirements

1. Recognize front matter only when the first line and a later closing line are exactly `---`.
2. Do not treat delimiter-like text elsewhere in the document as front matter.
3. Render a bounded key-value mapping when the cursor is outside the block.
4. Keep an empty mapping visually collapsed.
5. Show a safe error state when parsing fails.
6. Format scalar, list, and nested values without inserting active HTML.
7. Reveal the original YAML when the cursor enters the block or the user selects source mode.
8. Preserve the exact Markdown source unless the user explicitly edits a property.
9. Avoid overlapping CodeMirror block decorations.

Current security limits and typed-property behavior are defined by the product requirements, security policy, source, and automated tests.
