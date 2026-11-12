# YAML opening defaults QA

`mdLivePreview.collapseYamlByDefault` defaults to `true`. It controls newly
opened notes; changing it preserves manual choices in an existing editor.
Frontmatter properties hide behind an accessible disclosure. YAML code previews
retain six lines, full-source copying, and manual expand/collapse controls.

Validation:

- Type checking and 2,385 deterministic unit tests passed.
- The 2,842-test browser run passed 2,836 cases initially. Six existing tests
  assumed expanded properties or the old sidebar settings shape; after updating
  their setup, all six passed. Their complete affected workflow suites also passed.
- All 17 focused YAML browser checks passed, including callout nesting, `yml`,
  uppercase labels, CRLF input, seven-line blocks, pending property edits,
  sidebar configuration, built-in Preview, and global expand/collapse.
- Dependency audit reported zero vulnerabilities; dependency policy, US English,
  and staged secret checks passed.
- Packaged checks excluding the separately documented existing history failure:
  20 trusted-mode, 15 restricted-mode, and one disabled-extension test passed.
  Editor discovery reads CodeMirror's full document so virtualization cannot
  hide the identifying heading from the QA tool.

## Existing native Undo failure

On macOS, VS Code 1.146.0, the installed-package smoke test named
`undoes and redoes saved YAML, table, and task edits without losing neighboring content`
fails at its first Undo: `name: demoX` remains in both the editor and saved file
instead of reverting to `name: demo`. The edited content remains saved.

This reproduced with both the new package and the previously committed package
from `389870d` (SHA-256
`57e0f3917fa814a3fab09e0cf7c8befb92a6e85d0ed54cc78aa91dfbd57dd582`).
It is unresolved and must not be reported as a passing native history check.
The normal smoke suite retains this test; a separate diagnostic run excludes
only this known failure to exercise the remaining trust modes. Additional
synthetic-fixture diagnostics now report the expected, saved, and editor text
when the history assertion fails.
