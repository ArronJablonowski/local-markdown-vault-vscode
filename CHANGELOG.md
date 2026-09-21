# Changelog

- Exercise native Document Vault Home/Arrow/Enter navigation across packaged platforms and CSS Themes Tab/radio-arrow/action reachability against installed macOS and Windows VSIX builds; retain platform-independent Linux sidebar keyboard coverage and leave manual VoiceOver/Orca judgment for accessibility sign-off.

- Verify the shipped Document Vault can create a Markdown note and folder through native input boxes and expose both entries with accessible file/folder labels; strengthen manifest coverage that trusted file, folder, and symlink rows expose the Trash-only action alongside the existing native macOS Trash commit gate.

- Exercise typed-property validation and cancel, callout and task toggles, table grid navigation and edit cancel, footnote navigation, and diagram source escape entirely through keyboard input in a clean-profile installed VSIX, while proving the dedicated accessibility fixture remains byte-identical.

- Keep in-vault Markdown links, wikilinks, Document Vault opens, and newly created notes in Live Preview when it is configured as the default editor, while leaving attachments with VS Code's normal opener.

- Add a real macOS VS Code desktop journey for local knowledge navigation: an alias filters the native Quick Switcher, keyboard list navigation opens the existing note, the empty picker shows the recent note, a unique body phrase populates vault search, native Backlinks distinguishes linked from unlinked mentions and opens the source note, and the Tags tree opens a prefiltered search containing its nested-tag result.
- Preserve valid structured vault-search results in the native picker after the extension query engine evaluates `tag:`, `task:`, `property:`, and other filters; VS Code's secondary fuzzy matcher no longer hides rows whose rendered text does not repeat the query syntax.
- Extend the installed-VSIX smoke gate with an isolated disabled-extension profile: an existing Obsidian-style vault opens in VS Code's ordinary text editor, Markdown remains byte-identical, and `.obsidian/app.json` remains byte-identical in trusted, Restricted Mode, and disabled runs.
- Localize the Command Palette category and add AST-backed localization gates covering every manifest command, setting, view, and trust description plus argument completeness and placeholder parity for all extension-host and webview English/Japanese messages.
- Add a real macOS compatibility journey proving that an encoded relative Markdown link opens its in-vault target, a local PNG reaches Live Preview only through validated host-delivered bytes, two split custom editors mount for the same note, and an external replacement converges in both panes.

- Reconcile externally created, renamed, and deleted folders in both the native Document Vault tree and the local metadata index, including Unicode and emoji paths. Directory-renamed notes are matched by verified filesystem identity, overlapping subtree scans recheck every candidate, and a bounded debounced prune closes provider event-coalescing races without changing note bytes.

- Strengthen Restricted Mode coverage so the inert diagram/custom-CSS browser gate also types a real plain-Markdown edit and verifies that the validated edit message still crosses the boundary while privileged rendering remains disabled.

- Add a real-host macOS network-policy journey proving that an HTTPS image activates only after an explicit workspace-scoped opt-in, emits exactly its expected intercepted request, and returns immediately to blocked-media state when the opt-in is revoked without changing the tracked workspace settings.

- Exercise all six checked-in malicious Markdown fixtures in the real macOS VS Code custom editor, including the 4,096-embed stress case, while observing requests and proving no code execution, command-triggered workbench closure, active unsafe URL, outside-vault disclosure or mutation, or adjacent filesystem change.

- Tighten the webview CSP review: remove inline-style permission from Outline, nonce every live-theme-preview style block, retain CSS-only inline permission solely for CodeMirror runtime layout and isolated theme-card rendering, and regression-test the exact resource roots and network directives.

- Add a real-host macOS hostile-Markdown journey proving that raw HTML stays inert and editable, `javascript:`, `command:`, unsafe data URLs, and outside-vault file URLs never remain active; default-blocked remote media emits no sentinel network request; and traversal attempts cannot disclose or modify an adjacent outside-vault canary.

- Add a reproducible macOS-only desktop integration runner for native text undo/redo, real Live Preview keyboard edit/undo/redo/save and external-change synchronization with the backing `TextDocument`, one-step vault move/link undo/redo, and case-only rename undo/replay/inverse behavior without requiring Accessibility permission.

- Add a two-launch isolated-profile integration gate proving that deletion of the rebuildable cache is recovered at the next VS Code startup, restoring private body search and navigation from Markdown without persisting sensitive values or changing `.obsidian` settings.

- Add a macOS extension-host probe proving that an authorized vault deletion moves the exact unchanged Markdown file into the operating-system Trash and cleans up only its UUID-named test artifact.

- Add real extension-host evidence that the persisted vault cache omits frontmatter values, task text, and body-derived search tokens, and that deleting it followed by a rebuild restores local search and navigation.

- Keep the strict one-second large-note viewport gate enabled on the documented reference Mac while treating shared-runner wall-clock timings as informational; hosted CI still exercises all five mounts, editability, and host-message behavior.

- Prevent case-only rename staging and automatic dirty-document saves after the active vault or Workspace Trust becomes stale, while retaining exact rollback if authorization changes during staging.

- Recheck active-vault and Workspace Trust authorization before every note, folder, intermediate-directory, and attachment filesystem creation, in addition to the existing post-write commit checks.

- Bind the exclusive attachment-write primitive to the active vault and Workspace Trust at commit time, removing the exact file before returning when authorization becomes stale.

- Revalidate the active vault and Workspace Trust at the trash commit boundary so a trust or workspace transition cannot authorize a delayed deletion.

[日本語](#日本語) | English

All notable changes to this extension are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## Unreleased

- Exercise native Document Vault Home/Arrow/Enter navigation across packaged platforms and CSS Themes Tab/radio-arrow/action reachability against installed macOS and Windows VSIX builds; retain platform-independent Linux sidebar keyboard coverage and leave manual VoiceOver/Orca judgment for accessibility sign-off.
- Verify the shipped Document Vault can create a Markdown note and folder through native input boxes and expose both entries with accessible file/folder labels; strengthen manifest coverage that trusted file, folder, and symlink rows expose the Trash-only action alongside the existing native macOS Trash commit gate.
- Exercise typed-property validation and cancel, callout and task toggles, table grid navigation and edit cancel, footnote navigation, and diagram source escape entirely through keyboard input in a clean-profile installed VSIX, while proving the dedicated accessibility fixture remains byte-identical.
- Open Quick Switcher, vault-search, Backlinks, and other indexed Markdown targets directly in Live Preview when it is the configured default editor; retain one bounded newest line jump through the webview startup handshake so a fresh search result reliably places the CodeMirror caret on its matching line.
- Show the same delayed, sanitized, local-only wikilink preview when a rendered link receives keyboard focus, associate it as an accessible description, and verify the behavior in both the shipped browser bundle and an installed clean-profile VSIX.
- Roll back the exact newly created note, folder, or intermediate note path when its active-vault or Workspace Trust commit guard becomes stale; directory rollback is identity-checked, reverse-order, and deliberately non-recursive.
- Bind native vault commands, Quick Switcher creation, and indexed-note navigation to the vault that started them, rechecking Workspace Trust at mutation commit boundaries so a workspace change cannot act on or reveal a stale vault.
- Make the created-date sort integration probe wait for the watcher-driven tree refresh to converge, eliminating a Linux CI race without weakening the production stale-read guard.
- Cancel an in-progress metadata reset/rebuild when its workspace changes, preventing stale success notices and old-vault work from suppressing recent-note tracking in the new vault.
- Cancel Document Vault expansion and move-destination discovery when the workspace changes, and close the native move picker through an explicit cancellation token before old-vault folder names can remain visible.
- Bind asynchronous Document Vault directory reads, date sorts, and active-file resolution to the current vault generation so an old workspace cannot surface stale filenames after a workspace switch or refresh.
- Bind asynchronous Backlinks and Broken Links calculations to the current vault generation, cancel ongoing old-vault reads and obsolete broken-link scans, and discard stale results after index, active-note, filter, sort, or watcher changes.
- Validate public Backlinks, Broken Links, and Tags command arguments at runtime, require targets to exist in the current vault index, and reject malformed paths, line numbers, tag-query injection, and stale tags before navigation or search UI opens.
- Harden opt-in local diagnostics so embedded, quoted, space-containing, and encoded absolute paths plus credential-like strings are redacted as whole values, while malformed event and field names cannot smuggle sensitive fragments into the bounded log.
- Re-resolve native-tree command arguments and drag payloads through the active vault, ignoring supplied file-type and parent metadata while safely rejecting malformed, stale, outside-vault, and oversized selections.
- Replay an undone case-only rename as a fresh validated vault transaction instead of asking VS Code to replay its canonicalized temporary URI, preserving current-content link rewriting and one-step undo while avoiding the known case-insensitive redo rejection; retire that replay after any intervening document or file mutation, matching VS Code's native redo semantics.
- Add a contributor guide and Node 24 version marker covering secure dependency installation, architectural trust boundaries, required validation, malicious-fixture handling, and review expectations.
- Classify spelling-only renames by verified filesystem identity instead of the operating-system name, so case-sensitive Linux/macOS volumes use normal atomic moves and reject a distinct same-folded destination while truly case-insensitive providers retain the guarded staging path.
- Bound every hosted CI, security, dependency-review, and release-validation job to 30 minutes or less, with a regression gate that rejects any future unbounded workflow job.
- Pinned Linux CI, security scanning, dependency review, and release-matrix jobs to Ubuntu 24.04 so `ubuntu-latest` cannot silently change the validated platform.
- Moved hosted CI and cross-platform release validation from end-of-life Node.js 20 to Node.js 24 LTS and documented the source-build requirement.
- Upgraded the immutable CodeQL workflow pin from the approaching-retirement v3 action to CodeQL Action v4.38.1.
- Made Quick Switcher flush pending open-document metadata before opening and refresh while its index changes, so newly typed unsaved aliases and note metadata appear deterministically.
- Made Restricted Mode integration-profile cleanup retry transient Windows file locks so a passing extension-host run cannot fail solely because VS Code is still releasing `agenthost.log`.

- Generate every scripted webview CSP nonce from the host cryptographic random-number generator instead of `Math.random()`.
- Strip XML Base attributes from renderer SVG so fragment-only Mermaid or draw.io references cannot be rebased to a remote resource.
- Validate renderer SVG URL attributes by namespace-local name as well as serialized prefix, preventing a renamed XLink prefix from bypassing external-resource removal.
- Restrict Mermaid and draw.io output to an explicit reviewed SVG element-and-attribute allowlist, removing unknown renderer vocabulary before insertion.
- Serialize debounced open-document index updates and flush them before vault search candidate selection, so immediate searches deterministically include unsaved edits.
- Keep strict reference-machine latency budgets in `npm test` and the opt-in filesystem benchmark, while hosted CI runs the complete deterministic suite without treating shared-runner contention as product-performance evidence.
- Add a deterministic dependency-policy gate for manifest/lockfile parity, HTTPS registry provenance, SHA-512 integrity, production licenses, and the exact install-script package set; CI and documented source installation now use `npm ci --ignore-scripts`, with compilation and packaging proven to work without dependency lifecycle execution.
- Launch packaged-VSIX installation through the official platform-aware VS Code CLI resolver, including the Windows `code.cmd` archive layout, while retaining isolated trusted and Restricted Mode profiles.
- Make path-containment and source-boundary security tests platform-neutral by deriving fixture paths with the host path API and normalizing checked-out source line endings, allowing the same assertions to run on Windows, macOS, and Linux.
- Keep an opaque open-file lease for each newly written attachment until its editor transaction commits or rolls back, preventing immediate Linux inode reuse from making identity-based cleanup delete another writer's replacement file.
- Refresh immutable GitHub Actions pins to the current official Node 24-based releases, removing the hosted runner's Node 20 deprecation path without using mutable version tags.
- Enable GitHub private vulnerability reporting, dependency security updates, vulnerability alerts, secret scanning, and push protection for the public repository.
- Use the **Local Markdown Vault** command category throughout the manifest and remove a nonexistent lint command from the source-install documentation.
- Rename the fork to **Local Markdown Vault**, assign the source package identity `arronjablonowski.local-markdown-vault`, connect the new GitHub repository while retaining upstream attribution, and replace the inherited Marketplace-focused README with concise source and VSIX installation guidance.
- Add a representative Obsidian-authored core-syntax fixture and a shipped-bundle browser gate covering typed properties, core Markdown, wikilinks and fragments, note/PDF embeds, callouts, math, footnotes, tasks, tags, tables, and inert raw HTML; the documented 95-percent compatibility threshold cannot conceal an individually failing feature.
- Add a packaged Obsidian compatibility contract that distinguishes supported portable Markdown syntax from security-constrained behavior and explicit non-goals, including local-only vault semantics, inert raw HTML, restricted diagrams and CSS, blocked-by-default remote media, and untouched `.obsidian` configuration.
- Extend the checked-in hostile Markdown corpus with malformed and incomplete links, embeds, emphasis, tables, callouts, Mermaid, and raw HTML plus 4,096 repeated unresolved embeds; corpus runs now fail on uncaught browser exceptions and enforce an explicit bounded mount time while retaining an editable visible fallback.
- Replace pointer-only CSS theme-card selection with a localized native radio group, including arrow-key selection, visible focus, and browser-level accessibility coverage for the shipped sidebar bundle and its named theme actions.
- Make every source-backed rendered table cell keyboard reachable, use visible focus to identify the selected row and column, support arrow-key grid navigation plus Enter/F2 editing, and enable structural toolbar actions from keyboard focus without requiring a pointer.
- Complete selected-position table editing with insert-above/below and insert-left/right controls, retain the quick append controls, expose the controls as a localized accessible toolbar, and exercise insertion, deletion, movement, natural ascending/descending sorting, alignment, and append behavior in the shipped browser bundle.
- Localize the Marketplace identity, custom-editor name, activity-bar container, and Settings section in both English and Japanese, with catalog-symmetry and manifest-placeholder regression gates. Mermaid and draw.io glyph controls now expose localized descriptive accessible names, including a fit/native toggle whose name follows its state. HTTPS image opt-in has browser coverage proving that a permitted HTTPS request cannot redirect into an HTTP tracking request.
- Add a checked-in, machine-readable malicious protocol corpus covering forged discriminators and fields, negative/overflowing/overlapping offsets, stale document versions, malformed and oversized base64, unsafe MIME types, traversal contexts, response-shape substitution, and a 4,096-message queue flood. Stale edits are now rejected at message receipt and rechecked immediately before execution, while the shared mutation queue proves a hard 64-operation ceiling without retaining overflow. A release-evidence gate also rejects telemetry and general-purpose networking primitives in production source and pins the sole `fetch` site to its packaged JSON asset plus the webview-only CSP origin.
- Derive the Document Vault storage namespace from the SHA-256 hash of the encoded canonical `file:` URI, as required by VLT-003, rather than the raw canonical path. Existing path-hash index caches, recent-note history, and Backlinks preferences migrate into the URI-hash namespace; a new cache is committed before the legacy cache is removed.
- Disable Mermaid HTML labels and protect that setting from document directives, preventing hostile label markup from initiating image requests in Mermaid's temporary render DOM even when HTTPS note images are enabled. Expand the checked-in malicious-content corpus with explicit expected outcomes for HTML/URL, diagram, and deep-YAML attacks, and fail browser tests on every non-harness HTTP(S) request rather than selected test domains.
- Namespace recent-note history and Backlinks filter/sort preferences with the SHA-256 identifier of the canonical vault root, migrate and remove legacy unscoped workspace-state values, reject malformed or oversized recent-note state at runtime, and ignore picker results if the active vault changes while a choice is open.
- Announce successful note/folder creation, rename, move, drag-and-drop, trash, Quick Switcher creation, and index rebuild through VS Code's accessible native notification surface instead of relying on transient status-bar text; messages remain localized and expose vault-relative paths only.
- Sanitize custom preview CSS rule by rule after escape decoding, preserving safe typography when a neighboring rule is rejected and keeping the bundled GitHub-like theme intact; block variable-based, vendor-prefixed, compositing, clipping, visibility, pointer, and control-selector techniques that could hide or impersonate protected editor controls, while continuing to reject every network-bearing rule. Enforce a 1 MiB sanitized-input ceiling, 32 conditional-rule nesting levels, and 10,000 rules before adaptation or DOM insertion.
- Keep only bounded frontmatter property names in the live and persisted vault index, replacing every arbitrary property value with `null`; positive and negated `property:key=value` searches preserve unknown candidates and verify them against a bounded authoritative note read on demand, so passwords, tokens, and other private YAML values are not retained in rebuildable metadata or exposed through the development index API.
- Encode the rebuildable vault cache record by record under its exact 64 MiB UTF-8 ceiling, stop consuming metadata as soon as the ceiling is crossed, persist only effective bounded exclusion settings, and serialize commits through unique temporary files with failure cleanup instead of duplicating an unbounded snapshot before checking its size.
- Compile bounded vault-exclusion patterns once per rebuild, tree listing, and link-rewrite discovery instead of reparsing as many as 256 patterns for every candidate path; the 10,000-item cold-index reference run now completes in 0.80 seconds p95 while preserving anchored, recursive, case-aware, and invalid-pattern behavior.
- Make manual Document Vault index rebuilds cancellable through VS Code progress notifications; cancellation propagates through bounded workers, discards partial metadata, preserves vault files, and permits a clean subsequent rebuild.
- Preserve single-character search candidates in the bounded vault index, allowing exact unlinked-mention verification for one-character note names and punctuation-bearing names or aliases such as `C++` without treating the candidate token itself as a backlink.
- Make Backlinks unlinked-mention context use bounded, case-insensitive literal matching with Unicode-aware word edges and the shared Markdown code-range parser, preventing substrings and earlier inline/fenced code from becoming false mentions or misleading previews.
- Prevent automatic rename and move transactions from rewriting Markdown destinations that lexically escape above the vault root; plain, percent-encoded, backslash, and encoded protocol-relative traversal now remains untouched, while legitimate parent-relative links that stay inside the vault continue to update.
- Cap the complete in-memory vault metadata index at a conservative 128 MiB retained-data estimate; cache loads, replacements, deletions, exclusions, and rebuild failures maintain the same accounting, and crossing the limit atomically disables knowledge features while leaving plain Markdown editing available. Full rebuilds no longer perform a quadratic case-alias scan or schedule thousands of redundant cache writes, reducing the current 10,000-item filesystem benchmark from a failing 3.31 seconds to 0.91 seconds p95.
- Bound inline/property tags, task labels, Markdown/wikilink targets and fragments, and individual search terms before they enter the in-memory vault index; token extraction and candidate search text now stop consuming fields at their limits instead of allocating complete match or joined-field arrays, and persisted-cache validation accepts property names with null placeholders only while enforcing the same producer limits rather than restoring note values or metadata the live parser would never create.
- Align vault-summary production and validation for note identities, aliases, headings, and block IDs; externally created nameless or non-canonical Markdown records are omitted from webview navigation metadata instead of invalidating neighboring notes.
- Make size-aware vault-metadata batching linear by serializing each note summary once instead of repeatedly serializing a growing chunk; the full 10,000-note PRD scale now has a dedicated lossless ordering test.
- Send an explicit empty metadata generation after the last vault note is removed, so open editors immediately discard stale resolved links, embeds, and completion entries.
- Drop oversized or wikilink-breaking aliases and oversized headings while indexing, bound every Live Preview note summary, and split metadata by exact UTF-8 message size as well as item count, preventing hostile notes from invalidating later vault metadata or feeding unsafe labels into completion and native navigation surfaces.
- Require canonical vault-relative paths at both sides of the editor message boundary, rejecting traversal, absolute and drive paths, empty segments, backslashes, and control characters before dispatching note metadata, embed, or local-image messages.
- Bound heading and block wikilink completion to 200 results while re-filtering the complete selected note after every typed character, so large notes cannot create unbounded completion lists and late fragments remain discoverable.
- Render top-level and embedded-note local wiki images through the same authorized resource boundary with bounded Obsidian `|width` and `|widthxheight` dimensions, useful filename alternative text, and inert handling for invalid or excessive size suffixes.
- Make wikilink autocomplete search aliases and vault-relative paths as first-class bounded results; selecting an alias inserts the shortest unambiguous target plus `|Alias`, unsafe aliases are never offered, and exact vault paths now take precedence over colliding basenames or aliases during resolution.
- Explain rejected image paste and drop operations in a localized protected alert, including unsupported formats, empty files, batch/byte limits, and unreadable browser data, while still creating no attachment or editor mutation.
- Derive every webview document language from VS Code's escaped locale and localize the editor, Outline, CSS Themes, and style-preview document titles; the CSS preview no longer forces Japanese strings for non-Japanese users.
- Make ordinary rendered links, table and embedded-content links, and embedded-note source links keyboard-focusable with explicit link semantics, so Enter activation matches pointer activation.
- Render quoted wikilink properties—including aliases and every linked item in a list—as keyboard-operable internal links with a separate named edit control; list editing now preserves commas inside wikilink aliases and quoted strings, retains homogeneous number/boolean types, and visibly rejects malformed input instead of corrupting YAML.
- Treat multi-image paste and drop as one bounded, ordered attachment transaction: validate at most 32 raster files and 40 MiB in aggregate, write sequentially, insert all Markdown links in one edit, and identity-safely remove files already created if a later write or the document edit fails.
- Reconcile case-equivalent vault-index records against exact on-disk directory entries after case-only renames, preventing stale aliases, backlinks, and broken-link results while preserving legitimate same-name files on case-sensitive volumes.
- Enforce exact post-commit filename casing for case-only renames even when VS Code canonicalizes an open editor back to the old spelling; dirty source buffers are saved before filesystem-only staging, editor tabs are retargeted across forward and undo casing steps, late deleted temporary tabs are reconciled, and saving after the rename cannot restore the old directory-entry casing.
- Resolve Document Vault resource-scoped settings against the supported workspace folder and canonicalize active-file reveal URIs, eliminating configuration warnings and allowing an editor whose URI retains old case to reveal the exact on-disk tree item.
- Identify the vault-relative source, linked document, or destination that invalidates an optimistic move precondition—including both endpoints of a raced case-only rename—while keeping absolute paths and document content out of user-facing transaction errors.
- Stage and replay case-only renames through an explicit no-overwrite filesystem operation, with guarded restoration if exact temporary-name verification fails.
- Route native vault directory enumeration and operating-system-trash mutations through `VaultService`; listings revalidate directory identity, trash revalidates parent and leaf identities, symlink children remain non-expandable, and no permanent-delete fallback is exposed.
- Reauthorize tree items, Markdown links, wikilinks, and indexed search results as ordinary non-symlink vault files immediately before opening; a real extension-host replacement test proves a stale indexed note swapped for an outside-vault symlink cannot replace the active editor.
- Associate invalid typed-property number input with a visible, localized screen-reader error and clear the error as soon as the value is corrected.
- Remove activation-time quadratic knowledge-view work by indexing wikilink paths, basenames, and aliases, cooperatively yielding during backlink and broken-link scans, and bounding results; isolated 1 MiB Live Preview opens now remain below the 100 ms extension-host blocking budget.
- Deliver vault-note summaries to Live Preview in validated, ordered, generation-scoped chunks so large vaults cannot create a single oversized host/webview message or apply incomplete metadata.
- Add an isolated 10,000-item/1 GiB filesystem benchmark that enforces cold-index and native-tree/index mutation budgets across five trials without treating shared CI timing as release evidence.
- Stop and now explicitly verify syntax-tokenization work while Live Preview tabs are hidden; background changes coalesce until the tab is visible again and hidden webview execution contexts remain discarded.
- Verify index reset/rebuild losslessness against Markdown, binary attachments, and existing `.obsidian` settings, and enforce the 1 MiB editable-first-viewport performance budget across five fresh browser pages.
- Apply case-only file and folder renames through collision-resistant sibling staging in the canonically confined directory; linked renames preserve dirty user text and exact casing through the forward operation and one-step undo without following symlink targets. Redo on case-insensitive macOS remains release-blocked by VS Code's canonical resource model and rolls back safely.
- Compare vault paths by Unicode-canonical segments while preserving authored destination spelling, so link updates remain correct when macOS reports decomposed filenames; rejected workspace edits now have an automated rollback check that restores exact casing without leaked staging files.
- Snapshot every Markdown file used during automatic link-rewrite planning and revalidate its size, timestamp, type, and open-document state immediately before commit; external changes now abort the entire move instead of applying stale text ranges.
- Authorize rename, move, and trash sources by lexical path plus canonical parent: forged outside-vault URIs, descendants of symlinked directories, and the vault root are rejected, while an in-vault symbolic-link leaf remains manageable without following its external target. Trash authorization runs before confirmation and again before deletion, which remains operating-system-trash-only.
- Enforce mutation-source authorization again inside the link-rewrite transaction boundary, preventing future callers from bypassing canonical-parent confinement before a workspace move is planned.
- Confine the native file-manager reveal command to authorized vault entries, preventing forged command arguments from disclosing arbitrary outside-vault filesystem locations.
- Preserve basename-only wikilinks when nested `.markdown` notes are renamed, fixing a fallback that could truncate the destination to `.markd`; encoded Markdown destinations, titles, fragments, embeds, and image dimensions now have explicit compatibility coverage.
- Read closed Markdown files directly during link-rewrite planning instead of loading every candidate into VS Code's document registry, avoiding filename-casing canonicalization and reducing retained document state in large vaults.
- Cancel and serialize superseded Document Vault searches so rapidly changing a query cannot accumulate abandoned background file reads.
- Prevent automatic link updates from rewriting link-like text inside long fenced blocks or inline code spans containing shorter backtick runs.
- Enable Quick Switcher and Vault Search shortcuts from every extension-owned view.
- Resolve backlinks and broken-link checks through case-insensitive wikilink aliases, while suppressing false backlinks from ambiguous basenames or aliases.
- Open vault-confined PDF and common audio wikilinks through VS Code, including unique shortest-path attachment names, without adding inline active-media rendering or operating-system launches.
- Apply exclusion changes consistently to the native vault tree, rebuilt knowledge views, search candidates, and persisted recent-note history.
- Apply the 10,000-note index limit after vault exclusions, retain a separate bounded discovery ceiling, and keep the extension active with localized recovery guidance when startup or live file changes cross either limit; stale or partial knowledge metadata is discarded fail-closed.
- Canonically validate Document Vault file opens so a visible symlink can still be managed as a link but cannot open a target outside the vault.
- Keep draw.io read failures generic across the host/webview boundary instead of echoing attacker-authored paths.
- Restrict privileged draw.io reads to local `.drawio`, `.dio`, and `.drawio.xml` targets, and resolve local link queries without treating them as filename text.
- Apply the automatic link-rewrite ceiling after vault exclusions, with a separate bounded discovery ceiling, so excluded archives do not prevent safe note moves.
- Add a dedicated Restricted Mode extension-host runner that omits the standard VS Code test harness's forced `--disable-workspace-trust` flag and verifies limited activation, editing, and mutation guards in a genuinely untrusted workspace.
- Install the production VSIX into isolated trusted and untrusted profiles and smoke-test the packaged extension without loading the development checkout.

- Added an automated, cross-platform VSIX archive gate that validates CRCs, paths, size bounds, required release guidance, manifest trust declarations, and exclusion of development or sensitive files after every production package build.
- CI, CodeQL, and secret scanning now run on pushes to both `main` and the repository's current `master` branch, closing a branch-name gap in the release gates.

### Changed

- Use one fail-closed workspace classifier across the vault filesystem service and editor resource policy, with explicit coverage for empty, multi-root, remote, virtual, and single-local-folder workspaces.
- Extend the 10,000-item filesystem benchmark with a direct PERF-005 gate that types and saves a real note during a full metadata rebuild, verifies saved-byte and index losslessness, and enforces both interaction-latency and extension-host blocking budgets.
- Security SBOM generation now writes a validated CycloneDX file directly, avoids npm banner corruption from shell redirection, fails CI when the artifact is absent, and retains a separate SBOM in tagged release validation without packaging it in the VSIX.
- The Vitest configuration now uses an explicit ESM module extension, removing the ambiguous CommonJS loader path before Vite changes its configuration-loader default.

### Added

- A local-workspace **Document Vault** tree with safe create, rename, move, trash, sorting, watching, active-note reveal, attachments, exclusions, and atomic link rewriting.
- Atomic multi-selection drag-and-drop moves, one-step undo across file moves and dirty-document link rewrites, collision rollback, and keyboard-first vault rename/trash shortcuts.
- A keyboard-accessible Move command with a bounded, searchable vault-folder picker and the same atomic multi-selection link-rewrite transaction used by drag-and-drop.
- Obsidian-style wikilinks and completion, heading/block navigation, safe note and image embeds, typed editable properties, callouts, bundled math, footnotes, tags, interactive tasks, and expanded table controls.
- Ordinary Markdown heading and block anchors now navigate within the current note or reveal the matching section after opening another vault note.
- A local incremental metadata index powering Quick Switcher, phrase/filter vault search with source snippets, backlinks, bounded unlinked mentions, nested tags, recent notes, and network-inert hover previews.
- Native Backlinks view controls for linked/unlinked filtering and linked-first, path, or recently-modified sorting, persisted only in workspace state.
- A Rebuild Vault Index action that discards rebuildable metadata and clears vault-local recent-note history without modifying notes.
- A native Broken Links view for missing or ambiguous notes and missing heading/block fragments, with source-line navigation.
- Quick Switcher fuzzy ranking across filenames, paths, aliases, and headings, including abbreviation-style subsequence matching.
- A checked-in hostile Markdown corpus plus automated malicious-content, performance, and Axe accessibility gates, CycloneDX SBOM generation, and supply-chain checks.
- Localized, vault-relative screen-reader labels for Document Vault files, folders, symlinks, backlinks, tags, and broken-link results; native view tooltips no longer expose absolute filesystem paths.
- Opt-in local diagnostics with a 500-entry/64 KiB ring buffer, structured redaction, immediate clearing when disabled, and no upload path; unconditional protocol console warnings were removed.
- Shipped compatibility and migration guidance plus a release-blocking checklist covering security, data integrity, packaged-VSIX smoke tests, performance evidence, and Windows/macOS/Linux validation.
- Added foreground custom-editor undo/redo integration coverage, pending-edit flush coverage, and an on-demand/tag-triggered Windows, macOS, and Linux release-validation workflow.
- Added real extension-host coverage for incremental vault watcher updates, deletion, contextual local search, indexed-note opening, recent-note ordering, and unsaved-note search; generated CSS test fixtures are now removed after each run.

### Security

- Recheck Workspace Trust inside queued and post-prompt operations: attachment batches roll back before further writes or document edits, local draw.io bytes are withheld, unresolved-note creation stops, and custom-style reads, previews, configuration changes, and filesystem mutations fail closed if the workspace becomes restricted after dispatch.
- Revoke Document Vault authority synchronously when workspace folders change: vault resolution rechecks the exact workspace identity after canonicalization, stale filesystem services reject later reads and mutations, old Quick Switcher/search pickers close, overlapping reinitializations serialize by generation, and link transactions revalidate the active generation immediately before commit.
- Apply the 64-operation mutation ceiling to undo and redo as well as editor and attachment edits; overflow is discarded instead of being retained in an unbounded promise chain, and a failed task cannot poison later accepted work.
- Accept only one webview initialization handshake per visible lifecycle, preventing repeated valid `ready` messages from starting redundant document snapshots, vault-metadata transfers, and syntax-tokenization work.
- Bound privileged link navigation to one in-flight action with a four-action burst and one-token-per-second refill, preventing forged valid messages from spawning unbounded external launches, warning dialogs, or vault navigation.
- Remote images are blocked by default and only explicit HTTPS images can be enabled per workspace. There is no extension-managed synchronization, account, telemetry, analytics, publishing, or background upload.
- Remote-image permission no longer inherits from user-global settings: each workspace or workspace folder must opt in explicitly. HTTPS image and external-link validation now rejects malformed authorities, one-letter unknown URI schemes, drive-relative protocol ambiguity, and encoded control/header injection in `mailto:` targets before browser or shell handling.
- Local vault links are opened only inside VS Code; unsupported local formats now fail closed instead of being delegated to the operating system, preventing executable-like vault files from being launched by a Markdown click.
- Standalone, multi-root, or remote documents no longer promote a containing directory into an implicit resource root. Attachments, relative files, local diagrams, and local link navigation now require the one supported local workspace-folder vault, while plain Markdown editing remains available.
- All webview messages use strict runtime schemas and size/queue limits. Local reads and writes use canonical vault containment with symlink checks.
- Vault metadata parsing now combines the 2 MiB per-note size ceiling with a 250 ms elapsed-time deadline.
- Vault exclusion patterns are bounded, segment-aware, filesystem-case-aware, and consistently hide matched folders with their descendants.
- Persisted vault metadata now uses a versioned, 64 MiB-bounded cache envelope with strict record validation; malformed, duplicate, traversal-bearing, content-bearing, or stale cache data is discarded and rebuilt.
- Vault-search regular expressions run through a pinned RE2-compatible, linear-time engine instead of JavaScript's backtracking engine. Pattern and compiled-program sizes remain bounded, and unsupported flags or syntax are rejected before execution.
- Custom CSS now rejects decoded external schemes and protocol-relative locations anywhere in the stylesheet, including quoted `image-set()` and `image()` sources that do not use `url()`. Browser security tests rebuild the webview before execution and assert these forms make no request even when Markdown HTTPS images are enabled.
- Hidden editor and CSS-preview webviews no longer retain live execution contexts. Editors restore only strictly bounded caret, selection, and scroll hints while reloading their text from the authoritative VS Code document.
- Pasted attachments now require the decoded bytes to match the declared PNG, JPEG, GIF, WebP, or BMP signature before any vault file is created; disguised HTML, XML, SVG, and mismatched formats fail closed.
- Local and pasted raster headers are now parsed before browser decoding; malformed dimensions, sides over 16,384 pixels, and canvases over 64 megapixels fail closed to bound decompression-driven memory use.
- Base64 message validation now rejects non-canonical padding bits without decoding or duplicating the payload in memory.
- The vault is no longer a webview resource root. Local images are canonically confined, size- and signature-checked, read by the host, and delivered as revocable in-memory blobs, so a panel receives only the specific raster bytes it requested.
- Document Vault name validation and transaction failures now use an explicit localized allowlist. Japanese workspaces receive translated, actionable reasons; unknown provider errors fall back safely without exposing paths or raw system messages.
- Mermaid, draw.io, and embedded-note error live regions no longer reflect raw parser or forged host-message text. Known resource limits stay actionable and localized; unknown failures use bounded generic guidance.
- Local-image, draw.io-file, and embedded-note reads now have independent extension-host concurrency gates (4/4/8) in addition to matching webview limits. Forged messages can no longer bypass the client queue and fan out dozens of large filesystem reads.
- Vault-relative URI construction now rejects absolute, drive-relative, UNC, empty-segment, control-character, and traversal paths before a URI can reach any filesystem caller.
- Restricted Mode no longer sends custom theme contents to the CSS-theme sidebar or leaves mutation controls looking active. Trusted thumbnail previews now use the same fail-closed CSS policy as the editor and are paint-contained so theme rules cannot obscure surrounding extension controls.
- Sidebar setting messages now accept only the exact `defaultEditor` and `codeTheme` manifest enum values; forged strings are rejected before configuration mutation.
- Custom themes are capped at 1,000 files and 1 MiB of CSS before host reads are retained or applied. Sidebar and preview validators now enforce the same ceiling in encoded bytes rather than undercounting multi-byte text.
- The dedicated live CSS preview now applies the same fail-closed stylesheet policy as the document editor, clears stale output above 1 MiB, and coalesces document reads while the user types.
- UTF-8 message limits now reject an oversized UTF-16 lower bound before encoding, preventing the validator itself from allocating an attacker-sized duplicate buffer.
- Integration undo/redo checks now establish VS Code editor-group focus and wait for webview context keys before dispatch, reducing false failures in fast extension-host runs.
- CSS thumbnail paint containment is enforced as inline-important host state, so higher-specificity shadow-theme selectors cannot override the boundary.
- Rejected custom CSS now produces a localized protected live-region warning outside the theme scope, and the warning clears after the theme becomes safe.
- The rebuildable vault cache no longer duplicates frontmatter values, task text, or body-derived search tokens on disk. Its schema was advanced so prior caches are discarded and rebuilt from the authoritative Markdown files.
- GitHub Actions dependencies are pinned to exact upstream commit hashes across CI, release validation, CodeQL, dependency review, artifact upload, and secret scanning.
- Malformed editor, outline, CSS-sidebar, and CSS-preview messages now produce opt-in local diagnostics at most once per category per second without retaining the rejected payload.
- Editor initialization no longer discloses unused host-generated document or workspace webview URIs. Local resources continue to cross only validated, canonically confined host message boundaries.
- Documents larger than the 20 MiB Live Preview protocol limit now receive a localized, script-free explanation with guidance to use the ordinary Markdown editor instead of opening to a blank webview.
- Recent notes now track ordinary text-editor and custom-editor tab activation, not only notes opened through extension commands. State writes are serialized so rapid tab changes retain deterministic recency order.
- Rebuilding the vault index now drains and suppresses pending recent-note writes while clearing history, preventing an activation event from repopulating the just-reset list.
- The automated vault performance fixture now exercises the full 10,000-note PRD scale with 130,000 wikilinks instead of relying on an 8,000-note proxy.
- Host-to-webview syntax-highlighting messages now require ordered token ranges inside their declared code block and a strict foreground/emphasis style allowlist; forged layout or overlay declarations are rejected.
- Sanitized Mermaid and draw.io SVG now renders inside paint-contained shadow roots. Renderer styles cannot target surrounding editor controls, and shadow-escape selectors are removed before insertion.
- SVG and custom-theme stylesheet security checks now share CSS comment and escape decoding, preventing encoded `:host`, `url()`, scheme, and at-rule spellings from bypassing their respective policies.
- Diagram SVG sanitization now rejects additional active/resource-loading elements, CSS animations and transitions, escape-obfuscated URL attributes, and unreasonable root dimensions or view boxes before shadow-root insertion.
- YAML property detection and parsing now remain bounded before parser allocation, require a mapping root, reject duplicate keys, count scalar values, keys, and expanded aliases toward the 5,000-node limit, and reject circular aliases before they can reach widget serialization.
- Mermaid rendering is serialized behind a 16-item pending queue with one enqueue-to-output deadline, preventing documents with many diagrams from starting unbounded concurrent renderer work.
- Vault metadata code masking now uses the same UTF-16 offset model as the parser, so emoji and other astral characters cannot shift masks and expose code-block links, tags, or tasks to the index.
- CRLF Markdown now uses an explicit bidirectional host/webview offset map: CodeMirror receives parser-friendly LF text, edits and syntax tokens map back to raw VS Code offsets, and inserted text retains the document's configured line-ending convention.
- Incremental editor updates are reconciled against the authoritative post-edit document; ambiguous mixed-line-ending or provider-normalized changes fall back to a full snapshot instead of risking host/webview divergence.
- Notes that become unindexable now invalidate stale search, backlink, tag, and cache entries and notify the affected knowledge views.

- Raw HTML is inert. Mermaid and draw.io output is sanitized and bounded; YAML, math, diagrams, embeds, CSS, documents, and pasted images have resource limits.
- Restricted Mode retains plain Markdown editing while disabling remote resources, diagrams, user CSS, attachments, and vault-wide mutations.

### Changed

- Quick Switcher explicit creation now accepts safe vault-relative paths such as `Projects/New Note`, creates required in-vault folders, and suppresses the create action for traversal, absolute paths, reserved names, or excessive nesting.

## [0.2.0] — 2026-09-10

### Added

- **Search and replace** (`Ctrl+F`), in a panel that floats over the top-right
  of the editor the way VS Code's own does. Replace is collapsed behind a
  chevron, since finding is much the more common of the two. `Enter`/`F3` step
  through matches, `Ctrl+D` adds the next occurrence as a cursor, `Esc` closes
  the panel; case, whole-word and regular-expression modes are all available.
  Searching runs against the raw Markdown, so `](url)`, a table's pipes and a
  heading's `#` are findable while the preview hides them — and a match inside
  hidden syntax reveals that syntax, so what was found is always visible.
- **Multiple cursors now actually work.** The editor never enabled CodeMirror's
  multiple-selection support, so the multi-cursor behaviour `Ctrl+B`/`Ctrl+I`
  already documented had no way to arise, and `Ctrl+D` would have collapsed to
  a single cursor.
- `.markdown` files open in the live preview, alongside `.md`.

### Changed

- **The UI now speaks the language VS Code is set to**, defaulting to English.
  Every menu, button, tooltip and message was previously hardcoded in Japanese,
  so anyone not reading Japanese met a Japanese UI on install. Language follows
  VS Code's own display language — not the content of the document — so an
  English `.md` in a Japanese VS Code still shows a Japanese UI, and nothing you
  write is ever translated.
- The CSS-theme preview samples are translated too. They exist to judge line
  height and letter spacing, which only works in a script you actually read.
- The Marketplace description now leads with `.drawio` rendering, which no
  other Markdown extension offers.

### Fixed

- **A rendered image could not be edited.** Clicking one placed no caret,
  because a widget ignores every event unless it says otherwise — so the line
  never gained a cursor and the `![alt](url)` behind it stayed hidden. Dragging
  across the URL to select it had the same problem, and searching for part of
  it scrolled to the image but left it rendered.
- **The text cursor was black on dark themes.** The editor draws its own caret
  to support multiple cursors, and the library default for that is a hardcoded
  black; it now follows the VS Code theme like the native caret already did.
- Removed a leftover `**/temp/readonly/*` file pattern that let this editor
  claim unrelated files.
- The "CSS Themes" sidebar view had a blank title (a single space).

### Note on the version number

`0.1.0` was prepared but never published, so its changes are listed here.
Search and replace is one of the things `1.0.0` is waiting on; math, footnotes,
callouts and export are still missing.

## [0.0.12] — 2026-09-02

### Added

- **draw.io diagrams render in place**, the same way a Mermaid diagram already
  does. Write one two ways: a ` ```drawio ` fence holding the diagram XML, or a
  `![](diagram.drawio)` reference to a `.drawio` file sitting beside the
  document. Putting the cursor in a fence reveals its source, as with every
  other block. A file with more than one page shows a page indicator in its
  toolbar.
- **AWS architecture shapes are included**, so a diagram drawn with them shows
  the intended symbols rather than a grid of plain boxes. Shape colours come
  from the diagram file itself — nothing is substituted or re-themed, in either
  a light or a dark editor.

### Security

- A `.drawio` file reference is read only from the document's own folder tree,
  and only up to 5MB. The path in a `![](…)` is just text in the document, so
  without this an opened Markdown file could have pointed at any path on disk.

## [0.0.11] — 2026-09-01

### Added

- **Editable tables.** A table now stays rendered while you work in it, in the
  style of Obsidian's table editor. Clicking a cell makes that one cell
  editable in place and shows its raw Markdown, so `**bold**` survives a
  round-trip; `Tab`/`Shift+Tab` move between cells, `Enter` commits and `Esc`
  discards. Only the edited cell's own span is written back, leaving the rest
  of the row's text, padding and pipes byte-identical, so an edit cannot
  reflow the source or break the table's structure. Column widths are pinned
  for the duration of an edit, so swapping a cell's rendered text for its
  longer source no longer makes the whole table lurch sideways.
- **A `</>` code-mode button on every rendered block** — tables, Mermaid
  diagrams, frontmatter, and fenced code blocks — for reaching the Markdown
  behind it. Cell editing cannot change a table's *structure* (adding a row,
  editing the alignment row, repairing a broken table), so there has to be a
  deliberate way back to the source; giving every block the same control puts
  it in the same place whatever the block is. On a code block, whose text is
  already visible, it reveals the ` ``` ` fence lines and puts the caret on
  the language tag.
- **A `⧉` copy button on fenced code blocks.** Selecting a code block by hand
  sweeps up the hidden ` ``` ` fence lines and any indentation the block is
  nested under; the button copies the block's contents exactly.
- **Adding a row or a column to a table**, from thin strips along its bottom and
  right edges. Unlike a cell edit, which rewrites one span, these rebuild the
  table whole — a new column has to appear in the header, the delimiter row and
  every data row at once — while keeping the column alignments and the
  indentation of a table nested under a list item.

### Changed

- **Clicking a Mermaid diagram now pans it instead of switching to its
  source.** Any click whose movement fell under the drag threshold used to be
  read as "show me the source", so a diagram would turn into raw text
  mid-gesture, exactly when it was being panned or zoomed. The `</>` button is
  the way to the source now, and the two can no longer be confused.
- **Table cell text can be selected and copied.** Dragging across cells
  highlights their text as ordinary text; previously the press was cancelled
  outright, so the rendered cells could not be selected at all.
- **Clicking a link follows it.** Opening a link used to require Ctrl/Cmd-click;
  a plain click fell through to the editor, which put the caret in the text and
  unrendered the link into its `[label](url)` source. Ctrl/Cmd-click still
  works.

### Fixed

- **Text typed into a table cell being written twice.** Committing a cell
  re-renders the table, and the DOM swap that follows fired `focusout` on the
  old element, committing it a second time — so `Enter`, `Tab` and a structural
  edit each turned "oneXY" into "oneXYXY".
- **`Tab` losing whatever was typed in the cell it moved to.** The commit that
  precedes the move rebuilds the widget, replacing every cell element, so the
  destination held across it was a node no longer in the document — and the
  keyboard handler still lived on the discarded table, leaving `Enter`, `Esc`
  and further `Tab`s dead in the new cell.
- **A rendered block flipping to its raw source on a stray click.** Clicking
  near a table — its outer edge, the shared line between two rows, the strip
  above it — or simply clicking repeatedly could revert it to pipe text, often
  several times in a row. Three separate causes: the caret was being dragged
  *through* a block on the way somewhere else and that counted as entering it;
  the browser's own word-selection on the second click of a rapid pair looked
  like a drag-select and made the handler bail out; and the block's own bounds
  were tested rather than its surrounding box, leaving unguarded bands (30px
  above a table, 7px below) that belonged to no block at all. The guards apply
  only to block widgets: they also gate whether a heading shows its `#` and
  whether `**bold**` shows its asterisks, so applying them everywhere would
  stop a click placing the caret for editing on any ordinary line.
- **Links to files failing with an OS "file not found (0x2)" dialog.** Every
  link was passed to the shell via `Uri.parse`, which is right only for one
  that already carries a scheme. A relative link — `./notes.md`, `../img/a.png`,
  or a bare `notes.md`, the ordinary case in a Markdown file — parsed into a
  scheme-less URI that resolved against nothing. Relative links are now resolved
  against the document's own folder and opened in the editor, with a fragment
  (`#heading`) split off and percent-encoding decoded first; a missing target
  gets a message naming the path instead of an OS error.
- **A Mermaid diagram's reset (`↺`) not returning to the size it started at.**
  It reset the zoom but stayed in full-size mode, whose 1× is the diagram's
  natural width — so from a zoomed-in view the diagram shrank part-way and
  stopped, still larger than the fitted view it began from. It now goes all
  the way back.
- **Table cells rendering differently from every other Markdown renderer once
  their content got the least bit involved.** A cell's content is drawn outside
  CodeMirror, so it was rendered by a handful of hand-written regexes rather
  than by the parser. Anything past one flat construct came out wrong:
  `***bold italic***` kept stray asterisks, `**a *b* c**` and `**2 * 3**`
  collapsed into nonsense, `_underscore_` emphasis and images were not
  recognised at all, a lone `*` used as a multiplication sign turned into
  spurious italics, multi-backtick code spans broke apart, links with a title
  stayed raw text, and a link nested in bold never became a link. Cells now go
  through the same parser the rest of the document uses, so they follow GFM
  exactly. Backslash escapes, `<`/`&`, autolinks and `<br>` are handled too;
  any other raw HTML in a cell is shown literally rather than injected.
- **Column alignment (`|:--|:-:|--:|`) was ignored.** Every column rendered
  left-aligned.
- **Rows with too few or too many cells rendered ragged.** GFM fixes a table's
  column count at its delimiter row: short rows are now padded with empty cells
  and any overflow is dropped, so the table stays rectangular.

## [0.0.10] — 2026-08-27

### Fixed

- **Cursor landing on the wrong line, and jumpy scrolling.** Rendered tables,
  Mermaid diagrams, and frontmatter blocks carried their spacing as a CSS
  `margin`, which sits outside the box CodeMirror measures. Each one quietly
  dropped 14px from the editor's internal height map, and the error accumulated
  down the document — a click near the top of a file landed one line off, and
  further down, three. Documents with many tables or diagrams were worst
  affected. The spacing now lives inside the measured box, so positions match
  the rendering exactly, at any scroll position.
- **Layout lurching when a Mermaid diagram finished rendering.** Diagrams render
  asynchronously, and the editor was never told the block had grown from a
  one-line placeholder to its full height. The same applies to images as they
  load, and to the diagram fit/native toggle.
- **The caret jumping a line away after pressing Enter at the end of a
  paragraph**, then snapping back as soon as you typed. A paragraph now includes
  the blank line that follows it, so its trailing gap sits below that separator
  instead of above it. Rendering is unchanged.

### Added

- Claude Code's read-only output tabs can now be opened in the live preview via
  **Reopen Editor With…**. These are in-memory documents with no file extension,
  so the `*.md` association could never match them.

## [0.0.9] — 2026-07-28

### Fixed

- Tables placed directly under a list item with no blank line between them were
  left as raw text instead of being rendered.

## [0.0.6] – [0.0.8] — 2026-07-23

### Changed

- Marketplace screenshots recropped to show only the editor itself.

## [0.0.5] — 2026-07-23

### Added

- **Bold / italic keyboard shortcuts** (`Ctrl+B` / `Ctrl+I`).
- **Paste and drag-and-drop images.** Dropped files are saved under an `assets/`
  folder beside the document and linked with a plain relative path.
- **Outline view** in the sidebar, listing the document's headings.

### Fixed

- Pasting an image while the cursor sat inside a table corrupted the table.

## [0.0.4] — 2026-07-16

### Changed

- Marketplace listing adjustments.

## [0.0.3] — 2026-07-13

### Added

- **Mermaid fit / native display toggle**, with drag-to-pan and Ctrl+wheel zoom
  in native mode.
- Markdown editing conveniences: auto-pairing for emphasis marks and code
  fences, and automatic spacing after a heading marker.

### Fixed

- Frontmatter in a document stopped every other decoration in the file from
  rendering.
- Doubled vertical spacing on list items and blockquotes.
- Markdown files opened by another extension (an AI chat panel's file link, for
  instance) stayed in the plain text editor instead of switching to the live
  preview.

### Changed

- New installs now start with the VS Code-standard sample theme applied.

## [0.0.2] — 2026-07-09

### Fixed

- CSS theme loading, live-preview auto-reopen, and Mermaid rendering.

## [0.0.1] — 2026-07-08

- Initial Marketplace release.

---

## 日本語

この拡張機能の主な変更点をまとめています。
バージョン番号は [セマンティック バージョニング](https://semver.org/lang/ja/) に従っています。

## [0.2.0] — 2026-09-10

### 追加

- **検索・置換**(`Ctrl+F`)。VS Code 標準と同じく、エディタ右上に浮かぶパネルです。
  置換は矢印を押したときだけ開きます(検索の方が使う頻度が高いため)。
  `Enter`/`F3`で一致箇所を移動、`Ctrl+D`で次の一致をカーソルとして追加、`Esc`で閉じます。
  大文字小文字の区別、単語単位、正規表現に対応しています。検索対象は素の Markdown なので、
  プレビューが隠している`](url)`や表のパイプ、見出しの`#`も検索できます。
  隠れた記法の中に一致が見つかった場合はその記法が表示されるため、
  何が見つかったのかを必ず目で確認できます。
- **複数カーソルが実際に動くようになりました。** CodeMirror の複数選択機能が
  有効になっていなかったため、`Ctrl+B`/`Ctrl+I`の説明にあった複数カーソル対応は
  そもそも発生しようがなく、`Ctrl+D`も単一カーソルに潰れる状態でした。
- `.md` に加えて `.markdown` もライブプレビューで開くようになりました。

### 変更

- **UI が VS Code の表示言語に追従するようになりました**(既定は英語)。
  これまでメニュー・ボタン・ツールチップ・メッセージがすべて日本語固定で、
  日本語を読まない利用者はインストール直後に日本語の UI に出会っていました。
  判定に使うのは **VS Code 本体の表示言語**で、開いている文書の中身ではありません。
  日本語の VS Code で英語の `.md` を開いても UI は日本語のままで、
  書いた内容が翻訳されることは一切ありません。
- CSS テーマのプレビュー用サンプル文も翻訳しました。行間や字間を確認するための
  ものなので、実際に読む文字で表示する方が役に立つためです。
- Marketplace の説明文を、他のどの Markdown 拡張機能にもない `.drawio` の描画から
  始まるように書き直しました。

### 修正

- **画像の URL を編集できませんでした。** 画像をクリックしてもカーソルが置かれず、
  そのため`![alt](url)`が表示されないままでした(ウィジェットは既定ですべての
  イベントを無視するためです)。ドラッグして URL を選択しようとした場合も同様で、
  URL の一部を検索した場合は画像までは移動するものの、画像は描画されたままでした。
- **ダークテーマでカーソルが黒く見づらい問題を修正しました。** 複数カーソルのために
  エディタが独自にカーソルを描くようになり、その既定色が黒固定だったためです。
  従来と同じく VS Code のテーマ色に追従するようにしました。
- 開発時の名残だった `**/temp/readonly/*` のパターンを削除しました。
  無関係なファイルをこのエディタが開いてしまう可能性がありました。
- サイドバーの「CSSテーマ」の見出しが空白 1 文字で、表示されていませんでした。

### バージョン番号について

`0.1.0` は用意しましたが公開しなかったため、その内容もここにまとめています。
検索・置換は `1.0.0` の条件の 1 つです。数式・脚注・コールアウト・書き出しは
まだありません。

## [0.0.12] — 2026-09-02

### 追加

- **draw.io の図をその場で表示できるようになりました。** Mermaid と同じ扱いです。
  書き方は2通りあります。ひとつは ` ```drawio ` の囲みの中に図の XML を書く方法、
  もうひとつは `![](diagram.drawio)` のように、文書のとなりに置いた `.drawio`
  ファイルを参照する方法です。囲みの中にカーソルを置くと、ほかのブロックと
  同じように元のテキストが表示されます。ページが複数ある図では、ページ番号が
  ツールバーに表示されます。
- **AWS のアーキテクチャ図形を同梱しました。** これがないと AWS の図形で描いた
  図がただの四角の羅列になってしまいます。図形の色は図のファイルに書かれた色を
  そのまま使います。明るいテーマでも暗いテーマでも、色を置き換えたり塗り直したり
  はしません。

### セキュリティ

- `.drawio` ファイルの読み込みは、その文書があるフォルダの中だけに限定し、
  大きさも 5MB までとしました。`![](…)` に書かれたパスは文書の中の「ただの文字」
  なので、この制限がないと、受け取った Markdown を開いただけでパソコン内の
  どのファイルでも読まれてしまうおそれがあります。

## [0.0.11] — 2026-09-01

### 追加

- **テーブルをその場で編集できるようになりました。** Obsidian のテーブル
  エディタと同じように、表は描画されたままで作業できます。セルをクリックすると
  そのセルだけが編集状態になり、生の Markdown が表示されるので `**太字**` の
  ような装飾も保ったまま直せます。`Tab`/`Shift+Tab` でセル間を移動、`Enter` で
  確定、`Esc` で取り消しです。書き戻すのは編集したセルの範囲だけなので、行の
  ほかの文字・空白・`|` は一切変わりません。編集が表の形を崩すことはありません。
  編集中は列幅を固定するので、短い表示から長いソースに変わっても表全体が
  横に大きく動くことはありません。
- **描画されたブロックすべてに `</>`（コードモード）ボタンを追加しました。**
  テーブル・Mermaid・フロントマター・コードブロックが対象です。セル編集では
  行の追加や区切り行の変更といった「構造」は変えられないため、元の Markdown に
  戻る明確な入口が必要でした。どのブロックでも同じ位置に同じボタンがあります。
  コードブロックは元から文字が見えているので、このボタンでは隠れている
  ` ``` ` の囲み行を表示し、言語名のところにカーソルを置きます。
- **コードブロックに `⧉`（コピー）ボタンを追加しました。** 手で範囲選択すると
  隠れている ` ``` ` の囲み行や、入れ子のときの字下げまで一緒に入ってしまいます。
  このボタンは中身だけを正確にコピーします。
- **テーブルに行・列を追加できるようになりました。** 表の下端と右端にある細い
  バーから追加します。セル編集が1マスだけを書き換えるのに対し、こちらは表全体を
  作り直します（列を足すには見出し行・区切り行・すべてのデータ行を同時に
  変える必要があるためです）。列揃えの指定や、箇条書き直下のテーブルの字下げは
  そのまま保たれます。

### 変更

- **Mermaid の図をクリックしても、ソース表示に切り替わらなくなりました。**
  これまでは、ドラッグと判定されない程度の小さな動きはすべて「ソースを見たい」
  と解釈していたため、図を動かそう・拡大しようとした最中に生テキストへ化けて
  いました。ソースを見るのは `</>` ボタンの役割にしたので、移動の操作と
  取り違えることがなくなりました。
- **表のセルの文字を選択してコピーできるようになりました。** セルをなぞると
  普通の文字と同じように選択できます。これまではマウスを押した時点で標準の
  動作を打ち消していたため、そもそも選択できませんでした。
- **リンクをクリックすると、そのまま開くようになりました。** これまでは
  Ctrl/Cmd を押しながらクリックする必要があり、普通にクリックするとエディタ側の
  処理になってカーソルが入り、`[表示文字](URL)` のソース表示に戻っていました。
  Ctrl/Cmd + クリックも今までどおり使えます。

### 修正

- **テーブルのセルに入力した文字が二重に入る問題。** セルを確定すると表が
  描画し直され、そのDOMの入れ替えで古い要素に `focusout` が発生して、もう一度
  書き込まれていました。`Enter`・`Tab`・行や列の追加のいずれでも、`oneXY` が
  `oneXYXY` になっていました。
- **`Tab` で移った先のセルに入力した文字が消える問題。** 移動の前に行う確定で
  ウィジェットが作り直され、セルの要素がすべて差し替わるため、移動先として
  掴んでいた要素は文書から外れたものになっていました。キー操作の受け口も古い
  表に残っていたため、移動先では `Enter`・`Esc`・続けての `Tab` も効きません
  でした。
- **ちょっとしたクリックで、描画されたブロックが生のソースに戻ってしまう問題。**
  テーブルの外周、行と行の間の線、すぐ上の余白などを触ったときや、単に連打した
  ときに、生の `|` 記法へ戻ってしまい、しかも何度も続けて起きることがありました。
  原因は3つありました。ほかの場所へ向かう途中でカーソルがブロックを通過した
  だけなのに「入った」と判定していたこと。素早い2回クリックでブラウザが単語を
  自動選択し、それがドラッグ選択に見えて処理が中断していたこと。そして判定に
  ブロック自身の枠だけを使っていたため、その周り（表の上30px・下7px）に
  どのブロックにも属さない帯が残っていたことです。なお、この保護はブロック
  （表・Mermaid など）だけに効かせています。同じ判定は見出しの `#` や
  `**太字**` の記号を出すかどうかにも使われているため、文書全体に効かせると、
  普通の行をクリックしても編集用のカーソルが入らなくなってしまいます。
- **ファイルへのリンクを開くと、OS の「指定されたファイルが見つかりません
  (0x2)」というダイアログが出る問題。** すべてのリンクを `Uri.parse` で
  そのまま OS に渡していました。これはスキーム付きのリンクにしか正しくありません。
  `./notes.md`、`../img/a.png`、あるいは単に `notes.md` のような相対リンクは
  Markdown ではごく普通ですが、スキームのない URI になり、何も基準にせず
  解決されていました。相対リンクはその文書自身のフォルダを基準に解決し、
  エディタで開くようにしました。`#見出し` の部分は切り離し、`%20` などの
  エスケープも元に戻します。リンク先が見つからない場合は、OS のエラーではなく
  パスを添えたメッセージを表示します。
- **Mermaid の図で、リセット（`↺`）を押しても最初の大きさに戻らない問題。**
  倍率は 1 に戻していましたが、原寸大モードのままでした。原寸大の1倍は図の
  本来の幅なので、拡大した状態から押すと途中の大きさで止まり、最初の縮小表示
  よりも大きいままでした。最後まで戻るようにしました。
- **表のセルの中身が少し複雑になると、他の Markdown ビューアと表示が変わる問題。**
  セルの中身は CodeMirror の外側で描画するため、パーサではなく手書きの正規表現で
  描いていました。そのため装飾が1つだけの単純な場合を超えると崩れていました。
  `***太字斜体***` はアスタリスクが残り、`**a *b* c**` や `**2 * 3**` は表示が
  壊れ、`_アンダースコア_` の強調と画像はそもそも認識されず、掛け算の意味で
  書いた `*` が斜体になり、バッククォート2個以上のコードは分断され、タイトル
  付きリンクは生のまま、太字の中のリンクはリンクになりませんでした。セルの中身も
  文書本体と同じパーサに通すようにしたので、GFM の規則どおりに表示されます。
  バックスラッシュのエスケープ、`<` や `&`、自動リンク、`<br>` にも対応しました。
  それ以外の生の HTML は、埋め込まずに文字としてそのまま表示します。
- **列揃え（`|:--|:-:|--:|`）が効いていなかった問題。** すべての列が左揃えで
  表示されていました。
- **セルの数が足りない行・多すぎる行で、表がガタついていた問題。** GFM では
  区切り行が列数を決めます。足りない行は空のセルで補い、多すぎる分は捨てるように
  したので、表の形が揃います。

## [0.0.10] — 2026-08-27

### 修正

- **カーソルが違う行に着地する問題と、スクロールのぐらつき。** 表・Mermaid 図・
  フロントマターの余白が CSS の `margin` で指定されていました。`margin` は
  CodeMirror が高さを測る範囲の外側にあるため、ブロック1個につき 14px が
  内部の高さ計算から抜け落ちていました。しかもこのズレは文書の下に行くほど
  積み上がります。ファイル冒頭では1行、下の方では3行ずれていました。表や図が
  多い文書ほど影響が大きい状態でした。余白を測定範囲の内側に移したので、
  どのスクロール位置でも表示と位置が一致します。
- **Mermaid 図の描画が終わった瞬間に画面が跳ねる問題。** 図は非同期で描画され
  ますが、1行分のプレースホルダーから実際の高さに変わったことをエディタに
  伝えていませんでした。画像の読み込み完了時、図の表示モード切替時も同様です。
- **段落の末尾で Enter を押すとカーソルが1行分離れた場所に飛び**、入力を始めると
  戻ってくる問題。段落が直後の空行を含むようにしたので、余白が区切り行の上では
  なく下に来ます。見た目は変わりません。

### 追加

- Claude Code の読み取り専用の出力タブを、**「エディターを選択して再度開く」**
  からライブプレビューで開けるようになりました。これらは拡張子を持たない
  メモリ上の仮想ファイルなので、`*.md` の関連付けでは対象にできませんでした。

## [0.0.9] — 2026-07-28

### 修正

- 箇条書きの直下に空行なしで置いた表が、描画されず生のテキストのままだった問題。

## [0.0.6] – [0.0.8] — 2026-07-23

### 変更

- Marketplace 用のスクリーンショットを、エディタ部分だけが写るよう切り直し。

## [0.0.5] — 2026-07-23

### 追加

- **太字・斜体のキーボードショートカット**（`Ctrl+B` / `Ctrl+I`）。
- **画像の貼り付けとドラッグ＆ドロップ。** 文書の隣の `assets/` フォルダに保存し、
  相対パスで挿入します。
- サイドバーの **アウトライン表示**（見出し一覧）。

### 修正

- カーソルが表の中にある状態で画像を貼ると、表が壊れる問題。

## [0.0.4] — 2026-07-16

### 変更

- Marketplace の掲載内容の調整。

## [0.0.3] — 2026-07-13

### 追加

- **Mermaid の「自動縮小 / 原寸大」表示切り替え。** 原寸大表示ではドラッグで移動、
  Ctrl+ホイールで拡大縮小ができます。
- 編集の補助機能: 強調記号とコードフェンスの自動対応付け、見出し記号の後の
  自動スペース。

### 修正

- フロントマターがあると、文書内の他の装飾がすべて描画されなくなる問題。
- 箇条書きと引用の縦の余白が二重になる問題。
- 他の拡張機能（AI チャットのファイルリンクなど）から開いた Markdown が、
  ライブプレビューに切り替わらず通常のテキストエディタのままだった問題。

### 変更

- 新規インストール時に、VS Code 標準のサンプルテーマが適用されるようになりました。

## [0.0.2] — 2026-07-09

### 修正

- CSS テーマの読み込み、ライブプレビューの自動再オープン、Mermaid の描画。

## [0.0.1] — 2026-07-08

- Marketplace への初回公開。
