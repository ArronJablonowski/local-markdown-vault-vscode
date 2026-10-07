# Expand All and Collapse All QA

The Markdown Live Preview toolbar now has a global folding button beside
Lock/Edit. It folds callouts and code blocks containing at least eight lines,
including nested and offscreen objects. Folding changes editor presentation,
not Markdown source. It remains available in locked notes.

## Interaction rules

- If any eligible object is expanded, the button offers Collapse All. When all
  are collapsed, it offers Expand All. Individual folding updates this state.
- Mouse clicks, Enter, and Space activate the button. Labels and completion
  announcements support assistive technology; keyboard focus stays visible.
- Collapsing moves selections out of hidden content. A preceding Find result
  does not immediately reopen the collapsed section.
- Active table-cell edits commit before their widget disappears. Invalid
  property drafts block folding and remain available for correction.
- Tables and rendered diagrams are not independently folded. They disappear
  with their containing callout. Diagram fences displayed as ordinary code
  retain code folding when they meet the length threshold.
- Expand All clears existing code folds even if an edit shortened that block
  below eight lines. New and externally updated documents invalidate old targets.
- Whole-document parsing yields in bounded slices. An unfinished parse reports
  a visible warning without applying partial folds. Intervening user navigation
  cancels the pending action. Collection is limited to 10,000 objects and
  200,000 visited syntax nodes; larger documents retain individual controls.

## Automated results

- 36 new parser-backed unit tests passed, including exact fold ranges,
  unfinished fences, nesting, frontmatter, inert source, diagram policies,
  and the object-count boundary.
- 16 new browser interaction tests passed. An earlier implementation build
  also passed ten repeated runs of these tests, totaling 160 cases.
- All 2,037 unit tests across 144 files passed.
- All 1,025 browser tests excluding the separate native-clipboard group passed
  against the final implementation build.
- Source and test type checks, US English verification, dependency-policy
  verification, and whitespace checks passed. Dependency policy verification
  is not a new vulnerability audit.
- Packaged-extension smoke checks passed in isolated trusted, restricted, and
  extension-disabled VS Code profiles.

## Native macOS checks

Mouse and keyboard actions in an isolated VS Code Extension Development Host
verified collapse, expansion, nested callouts, eight-line code, locked notes,
and an in-progress table edit. Four exact editor-to-disk checks passed. The
original 340-byte fixture remained unchanged after presentation-only actions;
the 354-byte edited fixture retained its table draft after collapse and expansion.
No personal notes were modified.

The local diagnostic report at `.vscode-test/fold-all-2026-10-07/report.json`
retains one harness-input error: an initial hash verification omitted the
required byte count. The corrected check passed; the report recorded no editor
or page errors. This feature QA does not supersede the save-durability limitations
documented in [clipboard QA](CLIPBOARD_QA_2026-10-07.md).

## Package

The installable artifact is `releases/local-markdown-vault-0.2.0.vsix`.
It was installed in the local VS Code app. Existing windows require a reload
to load the new webview bundle; no personal window was reloaded during QA.

- VSIX SHA-256: `f94f4499a7962d9c72ee58a902d88a4ac744b3a780a60a8379b44c86506c40f6`
- Webview bundle SHA-256: `3952d1a83577add9d65f93410a02241965311cf36c2038f9a157a8ce8f180718`
