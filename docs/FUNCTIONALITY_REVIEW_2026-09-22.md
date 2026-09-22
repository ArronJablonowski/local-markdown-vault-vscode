# Conversation requirements and code review — September 22, 2026

## Scope and conclusion

Reviewed the functionality requests in the project conversation against baseline
`52189a6`, the production manifest, editor routing, editing commands, clipboard
controls, autosave, vault implementation, security boundaries, and regression
suites. Fixes in this change are described below. This is a request-level and
risk-focused code review, not a claim that every source line or every possible
interaction has been exhaustively verified.

**Not all requested behavior is implemented in the user's preferred view.**
`markdownEditor` and `vscodeMarkdownEditor` select VS Code's built-in
`vscode.markdown.editor`. Our CodeMirror implementation is `mdLivePreview.editor`,
labeled **Markdown Live Preview**. Its tests, CSS, key handlers, lock setting,
and hardened rendering do not establish equivalent behavior in the built-in
editor. The earlier comparison report incorrectly conflated these views; that
claim is corrected. The selected default remains Markdown Editor.

No existing user notes or workspace preferences were intentionally changed by
this review. Automated mutation tests use fixture notes and isolated profiles.

## Request traceability

“Implemented” below means code and relevant automated coverage exist; it does
not mean pixel-identical Obsidian behavior or independent security certification.

| Conversation request | Current implementation / evidence | Status and limitations |
| --- | --- | --- |
| Engineering PRD and phased roadmap | `PRODUCT_REQUIREMENTS.md` | Present; original baseline and research history retained |
| Local-only storage; no sync, accounts, uploads, telemetry, or plugins | Ordinary files; production network and dependency policy gates; `SECURITY.md` | Implemented for extension-owned behavior; VS Code itself and other extensions are outside this guarantee |
| Defend against hostile Markdown, URLs, images, paths, messages, SVG, XML, CSS, YAML, and exhaustion | Validation modules, canonical containment, bounded parsers/queues, sanitized SVG/CSS, browser malicious corpus, Restricted Mode and packaged tests | Implemented in Live Preview and vault actions; not inherited by the built-in Markdown Editor |
| Dependency review, SBOM, secret/static scanning, reporting | Lockfile policy, npm audit, CycloneDX command, GitHub workflows, `SECURITY.md` | Present; zero advisories in this run does not prove absence of vulnerabilities |
| Native Document Vault; create/delete files and folders, rename/move, drag/drop, trash, sorting, reveal | `VaultService`, `VaultTreeProvider`, `registerVault`, integration vault suite | Implemented; folder confirmation and containment covered; manual native Trash restoration remains a release gate |
| Documents-folder default vault | `defaultVaultLocation`, `defaultVaultFilesystem`, `defaultVault` | `Documents/Markdown Vault`; existing workspaces preserved; missing startup activation fixed in this review |
| Vault title matches Finder folder; prompt tree updates | `vaultName`, immediate watcher refresh plus coalesced reconciliation | Implemented; tested external create/rename/delete convergence |
| Atomic moves with link updates, dirty documents, undo/redo | `LinkRewriteService`, move plans, case-rename coordinator; host transaction tests | Implemented within supported local filesystem model |
| Wikilinks, aliases, unresolved-note creation, heading/block links and embeds | Resolver, index, widgets, host navigation; wikilink/embedding suites | Implemented in Live Preview; bounded/cycle-safe embeds |
| Properties, callouts, math, footnotes, tags, tasks, tables | Dedicated parsers/widgets and browser suites | Implemented in Live Preview |
| Quick Switcher, search, backlinks, unlinked mentions, recent notes, tag navigation, hover | Vault index/search/knowledge trees and tests | Implemented; native navigation is shared, rich editing remains view-specific |
| README, source installation, installation without administrator privileges, updating another system | README source/VSIX installation and update steps | Present; use Extensions > Install from VSIX; GitHub ZIP alone is source, not an installable extension |
| GitHub backups and installable VSIX | Git remote, `releases/` artifact and SHA-256, packaging verification | Existing workflow retained; test and package before replacing the release artifact |
| US English in UI, comments, code, folders and docs | US English verification script and localization/source tests | Automated gate available; proper names, identifiers and retained legal/vendor material are not arbitrarily rewritten |
| macOS initially, Linux and Windows subsequently | Platform-neutral package, filesystem abstractions, hosted matrix | Earlier cross-platform evidence recorded in release checklist; this review runs on macOS, not fresh Windows/Linux hardware |
| Automatic numbered lists, checkboxes and nested bullet shapes | Markdown keymap, task widgets, nested-marker CSS; editing/compatibility tests | Implemented in Live Preview |
| Strike through completed tasks in Markdown Editor | Live Preview task decorations and CSS | **View gap:** built-in Markdown Editor is not patched by this implementation |
| All viewing modes selectable; Markdown Editor default; Text Editor choice persists | `editorOpenPolicy`, CSS Themes settings, editor associations, host integration tests | Implemented; source split preservation and association scope bugs fixed here |
| Configurable initial locked/editing toggle | `defaultEditingMode`, persisted state, locked-mode tests | Implemented for Live Preview only; cannot promise control of the built-in editor's separate toggle |
| Save every content change, including checkbox toggles | Host document-change autosave, 500 ms debounce, canonical vault check | Implemented for eligible open Markdown documents across views after activation; startup fixed here. Disabled setting, oversize/outside-vault/untitled files and save failures remain deliberate exceptions |
| Escape code/highlight/sections at the bottom with repeated Enter | `codeFenceEditing`, `inlineHighlightEditing`, `sectionEditing`; interaction suites | Implemented for supported Live Preview structures; code-content preservation defects fixed here. Not a universal escape guarantee for arbitrary malformed Markdown or built-in Markdown Editor |
| Shift+Enter blank/continuation line | `softLineBreak`, keymap, interaction tests | Implemented in Live Preview, with list/quote continuation rather than a new marker |
| Mouse/keyboard selection, copy/paste/delete whole blocks and tables | CodeMirror, `blockSelection`, table selection controls, interaction tests | Implemented in Live Preview; unfinished-fence data-loss and multi-cursor interception fixed here |
| Copy control on every code block, including one-line blocks, in all views | Live Preview host-acknowledged clipboard; built-in Preview contribution | Live Preview covered in real VS Code. Preview browser tests cover contributed controls; built-in Markdown Editor parity remains unverified |
| Sticky table headers | Table CSS in Live Preview and contributed Preview CSS; scrolling tests | Implemented on these surfaces; not proven in built-in Markdown Editor |
| Collapse code blocks longer than eight lines | Live Preview controls and Preview contribution; boundary/keyboard tests | Implemented on these surfaces; not proven in built-in Markdown Editor |
| Reusable tab by default, optional separate tabs | `vault.openBehavior`, configured opener, real-host tests | Implemented for extension navigation. Explicitly pinned/dirty tabs and VS Code's own global preview behavior remain host-controlled |
| Obsidian-like theme | Bundled `obsidian-dark.css`, scoped theme sanitizer/store | Available for Live Preview, not an Obsidian application theme or built-in-editor patch |
| 100 varied test files and comparison with Obsidian | Exactly 100 `.md` fixtures plus manifest/readme; all-file browser suite; comparison report | Automated corpus coverage exists. Historical Obsidian inspection sampled ten representatives; not all 100 files were manually compared in both applications |
| Extensive same-file interactive QA and visual parity with Obsidian | Interaction suites, desktop tests, historical comparison notes | **Partial:** no claim of complete pixel/interaction parity; no fresh Obsidian UI comparison during this review |
| Accessibility, VoiceOver, release readiness | Axe, packaged keyboard/high-contrast checks, accessibility/release checklists | Automated checks available; human VoiceOver/NVDA/Orca and independent-review gates remain open |
| 10,000-item performance budgets | Unit performance suite, filesystem runner, recorded reference-machine measurements | Existing evidence retained; not a fresh five-run filesystem benchmark in this review |
| Restore missing menu, command palette and installation help | README instructions and native VS Code controls | Host UI support, not a custom replacement menu |

## Confirmed defects fixed

| Severity | Defect and impact | Fix / regression coverage |
| --- | --- | --- |
| High data-integrity | An unclosed fenced block treated its last code line as a closing delimiter; deleting a partial selection could delete an unselected final line | Require two parser-recognized fence marks before selection expansion; unit regression preserves unselected text |
| Medium | Multi-cursor deletion could widen only the primary selection and discard other selection semantics | Fall back to ordinary CodeMirror handling for multiple selections; unit regression |
| Medium | Empty-section Enter handler interpreted code containing `- `, `> ` or indentation as removable Markdown markup | Exclude fenced and indented code ancestors; unit cases for each form |
| Medium | Escape in an unfinished code fence could jump backward to just after its opener | Require a genuine closing mark; unit regression verifies no incorrect dispatch |
| Medium | Startup/default-vault/autosave behavior could depend on first opening an extension-owned view | Explicit startup and Markdown activation events; manifest regression and packaged test waits for automatic activation before calling `activate()` |
| Medium | Default-editor conversion closed matching source tabs in every editor group | Let VS Code replace only the requested tab; retain preview/focus flags and test an intentional source split |
| Medium | Merging effective editor associations into global settings leaked unrelated workspace associations into the user's settings | Merge only existing global values; host test verifies a workspace-only pattern stays out of user settings |
| Low | Delayed editor conversion could outlive the originating tab | Check that the original tab is still in its group before retries; read configuration for that resource |
| Medium | Autosave authorization could outlive a switch to a different workspace | Recheck the currently supported vault root after asynchronous canonical-path authorization |
| Low | Preview copy/collapse controls retained a detached code node after incremental rendering replaced it | Rebuild controls when the code-node identity changes; browser regression copies updated text |
| Documentation/security assurance | Comparison wording implied our tests and security protections applied to the built-in Markdown Editor | Explicit view boundary in README and comparison report; unresolved requests recorded above |

These findings include correctness and data-integrity defects, not evidence of
remote code execution. Path checks cannot eliminate every filesystem race with
another local process; no claim is made that the extension protects against a
host already compromised by another extension or local program.

## Validation and remaining release gates

Local results on macOS arm64, Node.js 26.8.2, VS Code 1.138.0:

- `npm run test:all`: passed — 962 unit tests across 91 files; 83 real-host
  integration tests; two cache-restart phases; four Restricted Mode tests;
  171 browser tests; verified production package; installed VSIX smoke tests
  with nine trusted, five restricted, and one disabled-profile check.
- `npm run test:integration:focused`: 11 desktop journeys passed, including
  actual OS clipboard contents with browser clipboard denied, checkbox
  autosave, hostile Markdown, network-policy revocation, and move undo/redo.
- Additional final editing-suite rerun: 36 browser tests passed, including the
  new real-keyboard regression preserving code that resembles an empty bullet.
- `npm run security:dependencies`: passed for 797 locked packages.
- `npm audit --json`: zero reported advisories across all severity levels.
- `npm run language:verify` and `git diff --check`: passed.
- Unit-only statement coverage is 57.6%; host/browser tests add behavioral
  evidence but do not make that metric complete coverage. Passing tests are
  not a guarantee of correctness for untested inputs.

The complete automated suite includes unit/coverage, type checking, real VS Code
integration, cache restart, Restricted Mode, browser security/accessibility/
interaction tests, all 100 fixtures, packaging validation, and installed VSIX
trusted/restricted/disabled smoke tests. The focused desktop interaction suite
is run separately because `test:all` does not include it.

Do not label the entire request list complete until:

1. The preferred-view gap is resolved as an explicit product decision. Retain
   the built-in default with documented limits, or use our extension-owned
   editor for the requested Obsidian parity. Do not silently rename one to the
   other or inject unsupported code into VS Code's built-in editor.
2. Fresh same-file manual Obsidian comparisons cover the remaining corpus and
   mouse/keyboard cases, especially selection across widgets and malformed
   document sections.
3. This candidate passes fresh Windows/Linux validation and the manual
   accessibility/native Trash-restoration gates in `RELEASE_CHECKLIST.md`.
4. Built-in Preview copy behavior is tested on each target VS Code/platform;
   its contribution still uses that view's browser clipboard permissions,
   unlike Live Preview's acknowledged host clipboard service.

The extension remains a development release, not a security certification or
Marketplace-ready sign-off.
