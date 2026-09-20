# Release checklist

This checklist converts the PRD definitions of done into release evidence. A checked item means the command or manual scenario passed against the exact commit and packaged VSIX being released. Record the commit, VS Code version, Node.js version, operating system, and date with the release notes.

## Latest development validation

This is reproducibility evidence for the current implementation, not final
release sign-off. Commit `b9d2085bc85a4609684c293de76f27c9d139bee4`
passed the complete Linux CI workflow, CodeQL, secret scanning, and the hosted
Windows/macOS/Linux release-validation matrix on 2026-09-20. Manual filesystem,
trash, assistive-technology, case-only redo, and independent-review gates remain
unchecked below.

| Evidence | Result |
| --- | --- |
| Hosted release matrix | [GitHub Actions run 35521372323](https://github.com/ArronJablonowski/local-markdown-vault-vscode/actions/runs/35521372323) passed at `b9d2085bc85a4609684c293de76f27c9d139bee4`: Windows, macOS, and Ubuntu completed the dependency policy check, script-free dependency installation, type checking, 843 deterministic unit tests with 2 intentionally platform-specific cases skipped (845 total), compilation, trusted and genuinely untrusted VS Code extension-host suites, production packaging and archive verification, isolated trusted/Restricted Mode installed-VSIX smoke tests, and artifact upload; the separate supply-chain job passed the dependency policy, script-free install, dependency audit, and retained a validated SBOM. The same commit also passed [CI](https://github.com/ArronJablonowski/local-markdown-vault-vscode/actions/runs/35521170134), [CodeQL](https://github.com/ArronJablonowski/local-markdown-vault-vscode/actions/runs/35521170126), and [secret scanning](https://github.com/ArronJablonowski/local-markdown-vault-vscode/actions/runs/35521170111). Reference-machine CPU and filesystem performance gates remain separate from shared hosted runners and retain their PRD thresholds. |
| Environment | macOS arm64, VS Code 1.138.0, Node.js 26.8.2, 2026-09-20 |
| Unit and performance suite | 80 files, 851 tests passed; all scripted webviews share one 192-bit host-cryptographic CSP nonce generator and a release-source gate rejects a return to `Math.random()`; all vault entry points share one tested fail-closed workspace classifier that admits exactly one local `file:` folder and rejects empty, multi-root, remote, and virtual workspaces; retained vault capabilities are identity-bound to that exact folder, stale pickers close synchronously, overlapping workspace reinitializations serialize by generation, and only the newest canonical resolution can commit; queued attachment, draw.io, unresolved-note, and custom-style operations recheck Workspace Trust at their asynchronous execution and commit boundaries; all prominent manifest surfaces use complete, key-symmetric English and Japanese catalogs; production source contains no telemetry or general-purpose network client, and the sole `fetch` site is statically pinned to a host-minted packaged JSON URI confined by `localResourceRoots` and `connect-src`; the rebuildable cache and every vault-specific workspace-state value are namespaced by the SHA-256 identifier of the encoded canonical vault `file:` URI, with tested migration and cleanup for path-hash and older unscoped cache/recent-note/Backlinks state; Mermaid configuration keeps strict mode, resource ceilings, and disabled HTML labels protected from document directives; malformed or oversized recent-note state is bounded at runtime, and stale picker results cannot cross a workspace-folder change; successful vault mutations and index rebuilds use localized native information notifications rather than inaccessible transient-only status text, with a source gate covering every completion path; custom preview CSS is sanitized per rule after escape decoding, preserving the bundled GitHub-like theme and safe siblings while rejecting network locations, protected-control selectors, CSS-variable positioning, vendor-prefixed filters/masks, compositing, clipping, and subtree-reset techniques, and sanitizer input is capped at 1 MiB, 10,000 rules, and 32 conditional-rule levels; live and persisted vault-index records retain bounded property names with `null` placeholders instead of arbitrary frontmatter values, and positive or negated property-value filters preserve unknown candidates before verification from bounded authoritative note reads; vault-index metadata also drops oversized inline/property tags, task labels, Markdown/wikilink targets or fragments, and search terms before native search/navigation surfaces retain them; unique terms and candidate search text stop consuming input at their limits instead of allocating complete match or joined-field arrays; persisted-cache validation enforces the same field and alias-count boundaries; cache encoding stops record consumption at the exact 64 MiB UTF-8 limit and serialized commits use unique cleaned-up temporary files; the whole in-memory index has a replacement-aware 128 MiB retained-data ceiling with localized fail-closed recovery; bounded exclusion globs compile once per complete operation instead of once per candidate path; link rewrites reject plain, encoded, backslash, and protocol-relative traversal above a synthetic vault root without blocking legitimate in-vault parent links; unlinked-mention contexts require Unicode-aware word edges, ignore inline and fenced code, and retain single-character candidate tokens so exact verification can find short or punctuation-bearing note names such as `C++`; dependency-policy mutation tests reject manifest drift, HTTP sources, non-SHA-512 integrity, unapproved production licenses, and new install scripts; the packaged release must include an explicit Obsidian compatibility and security-differences contract |
| Browser/security/accessibility suite | 92 tests passed; a representative Obsidian-authored note passed all 24 named compatibility checks in the shipped webview bundle, making the published 95-percent core-syntax threshold executable without allowing the aggregate to conceal a failed feature; six manifest-driven malicious Markdown fixtures—including malformed links, embeds, emphasis, tables, callouts, Mermaid, raw HTML, and 4,096 repeated unresolved embeds—remained editable, mounted within the explicit bound, raised no uncaught browser exception, and failed on any non-harness HTTP(S) request; renderer SVG testing also proves that XML Base cannot rebase an otherwise local fragment reference to a remote Mermaid or draw.io dependency while safe local references survive; CSS theme selection is a localized native radio group with visible focus and arrow-key operation, while separately named edit/duplicate/rename/delete actions remain keyboard reachable and the shipped sidebar has its own Axe gate; source-backed table cells are keyboard focusable with visible focus, arrow-key grid navigation, Enter/F2 editing, and keyboard activation of the selected row/column toolbar without revealing raw table source; selected-position table insertion, deletion, movement, natural ascending/descending sorting, alignment, and append controls operate through a localized accessible toolbar in the shipped bundle; the remaining hostile fixtures cover DOM clobbering, mixed/encoded protocols, Mermaid directives and callbacks, draw.io entities, circular YAML aliases, and excessive YAML depth; HTTPS image opt-in could not follow a server redirect to HTTP, Mermaid HTML labels remained network-silent even with HTTPS note images enabled, and Mermaid/draw.io glyph controls exposed descriptive localized names that followed fit/native state; a mixed safe/hostile CSS update retained safe heading styles, discarded variable-based fixed positioning and opacity, and kept the localized unsafe-rule warning visible; ordinary, table/embedded, wikilink, embedded-source, and quoted-property wikilinks expose stable keyboard focus, visible focus styling, and Enter activation; wikilink completion finds note names, aliases, vault-relative paths, headings, and blocks, inserts `Target|Alias`, keeps note and fragment results bounded at scale, re-filters complete large-note fragment metadata after every typed character, and uses consistent exact-path/basename/alias precedence across navigation and knowledge views; top-level and embedded-note local wiki images share the validated local-image boundary, accept only bounded integer `width` or `widthxheight` suffixes, keep filename alternative text for dimension-only aliases, and do not issue an extra nested-note read; forged non-canonical note metadata and embedded-note source paths are rejected before dispatch without resolving links or consuming valid pending requests; single and list property wikilinks display aliases, retain their encoded targets, and use a separately named keyboard edit control without nested-interactive accessibility violations; typed list editing preserves comma-bearing wikilink aliases and quoted values plus homogeneous numeric/boolean types, while malformed input remains focused with a localized associated error; ordered multi-image paste crossed the webview boundary in one validated operation; unsupported image paste created no host message and exposed a localized `alert`; five fresh-page 1 MiB viewport runs met the one-second PERF-004 budget; invalid typed-property input exposes a visible, screen-reader-associated error and clears it on correction |
| Foreground VS Code extension-host suite | 64 tests passed in one fresh disposable profile; 12 foreground UI or Restricted Mode cases intentionally skipped by this trusted headless host; a forced stale vault generation was rejected immediately before commit with the source file and affected link unchanged; the live vault identifier equaled SHA-256 of the encoded canonical `file:` URI; live index exports contained property names/null placeholders without secret property values, while positive and negated property-value searches matched the authoritative note; canceling a metadata rebuild exposed no partial records, changed no Markdown bytes, and recovered through the next rebuild |
| Targeted vault transaction suite | Case-only file/folder forward moves, an open dirty case-renamed source, Unicode/emoji and POSIX read-only moves, rejected-commit rollback, and forced source, linked-document, destination, and final case-staging changes passed; exact casing before and after a subsequent save, permissions, dirty bytes, note bytes, affected links, staging cleanup, and fail-closed concurrency were verified; the metadata index converged to the exact destination spelling without retaining the missing case variant; case staging and replay use explicit no-overwrite operations, and optimistic-concurrency failures identify only validated vault-relative endpoints; the remaining cross-platform focused undo/redo journey remains a manual release gate |
| Focused macOS desktop journeys | Live Preview edit undo/redo and a standard vault rename plus automatic link rewrite passed as one focused undo/redo unit. A case-only rename with the target editor open applied exact destination casing, rewrote the link, and restored original filesystem/link state through global undo with no temporary file or deleted temporary editor tab. Case-only redo remains a release blocker: VS Code 1.138 canonicalizes its recorded destination back to the original casing and rejects the replay; the extension rolls the failed staging attempt back without data loss. |
| Targeted mutation-boundary suite | Note, folder, attachment, rename, move, and trash paths use lexical plus canonical authorization; nested creation verifies each directory segment without following symlinks, notes share the exclusive identity-checked file primitive, directory listing revalidates directory identity before returning entries and never follows symlink children, tree expansion and date sorting inspect symlink entries without following their targets, created-date sorting uses filesystem birth time rather than metadata-change time, vault root and forged/outside entries were rejected, and the vault service revalidates parent and leaf identities immediately before `useTrash: true` deletion with no permanent fallback |
| Targeted protocol-queue suite | Editor edits, pasted attachments, undo, and redo share one 64-operation serial gate. A checked-in machine-readable corpus rejects forged discriminators and fields, negative/overflowing/overlapping offsets, stale versions, malformed or oversized base64, unsafe MIME types, traversal contexts, and response-shape substitution; a 4,096-attempt flood accepts exactly 64 operations, never exceeds the ceiling, retains no overflow, and drains to zero. Stale edits are rejected at receipt and rechecked before execution. Tests also verified FIFO execution, exact pending-count recovery, continued processing after task failure, and a source-level guard against bypassing the shared boundary. Initialization is accepted only once per visible webview lifecycle, blocking repeated valid `ready` messages from multiplying full snapshots, metadata transfers, and syntax-tokenization work; hiding/recreating or explicitly reloading the panel resets that handshake gate. Vault-note summaries require canonical Markdown identities, reject unsafe aliases and malformed block/heading records, cap every high-cardinality field using serialized-size accounting, remain below 128 KiB each, and are linearly chunked below 512 KiB by exact UTF-8 message size as well as 100-note count; a 10,000-note lossless ordering test passes, expansion-heavy forged chunks fail runtime validation, and an explicit empty generation clears stale metadata after the final note is removed. Privileged link navigation is single-flight and token-bucket limited to a four-action burst with one token restored per second; overflow cannot accumulate external launches, modal warnings, or vault navigation. |
| Targeted pasted-attachment suite | The boundary accepts only 1–32 PNG/JPEG/GIF/WebP/BMP payloads, enforces 20 MiB per image and 40 MiB per operation without decoding during schema validation, rejects malformed base64 and SVG, preserves selection order, and serializes the batch with document edits. Exclusive attachment creation verified canonical containment and open-file identity before and after writing; collisions and size limits failed closed, symlinked directories could not redirect bytes outside the vault, and an opaque open-file lease prevents immediate inode reuse from authorizing deletion of another writer's replacement. Commit releases and invalidates that rollback capability. Host implementation validates the complete batch before creating files and rolls back earlier creations if a later creation or the one document edit fails. |
| Targeted vault-read suite | Indexing, on-demand search, link-rewrite planning, local images, note embeds, draw.io reads, and closed-note anchor navigation use bounded verified file handles, with canonical-root and file-identity checks before and after reading; outside-vault symlink targets and oversized files were rejected, including for open-document indexing; tree items, Markdown links, wikilinks, and stale indexed search/navigation records are re-authorized and required to remain ordinary non-symlink files immediately before opening, with a real-host replacement attack proving an indexed note swapped for an outside symlink cannot replace the active editor |
| Targeted vault losslessness suite | 1 test passed: index reset/rebuild preserved Markdown, binary attachment, and `.obsidian/app.json` bytes and created no vault-local extension folder |
| Targeted hidden-panel idleness suite | 1 real-host test passed: background edits caused no syntax tokenization while hidden and refreshed after reveal |
| Restricted Mode extension-host suite | 4 tests passed in a fresh profile with `workspace.isTrusted === false`, including forged vault-folder and custom-CSS creation commands |
| Production package | `local-markdown-vault-0.2.0.vsix`: 57 files, 3.48 MB (3,653,016 compressed bytes; 14,329,862 uncompressed bytes); archive verifier passed after a clean `npm ci --ignore-scripts`, including the packaged Obsidian compatibility contract |
| VSIX SHA-256 | `b9e851105ae00d276040e1668c74e9c975fe27c0c6c8991ee334d57ce7f75ad5` |
| Five-run CPU benchmark | 10,000 notes/130,000 links: 332.1 ms index p95, 6.8 ms incremental p95, 24.6 ms search p95, 8.9 ms Quick Switcher p95 |
| Five-run filesystem benchmark | 10,000 items/1 GiB: 805.8 ms cold-index maximum; create/edit/rename/delete tree-and-index convergence maxima of 170.8/163.9/166.8/158.9 ms; during a full rebuild, a real note typed and saved in 144.6 ms with 20.9 ms maximum event-loop delay and no data loss, closing PERF-005 on the reference machine; the rebuild path compiles exclusion patterns once, performs bounded cache encoding, skips incremental case-alias scans, and coalesces persistence without weakening exact-case watcher reconciliation |
| Extension-host large-note gate | Five isolated clean-profile 1 MiB note runs recorded 41.7/31.9/38.7/14.1/16.6 ms maximum event-loop delay; all met the 100 ms PERF-004 continuous-blocking budget |
| Automated clean-profile VSIX suite | Current artifact passed 4 trusted and 4 Restricted Mode checks after installation into separate isolated profiles; the target extension loaded from the VSIX directory, not the development checkout |
| Dependency policy, audit, and SBOM | 797 lockfile packages and 182 production packages passed manifest parity, HTTPS registry, SHA-512 integrity, license, and exact install-script-set checks; dependency lifecycle scripts remained disabled; 0 vulnerabilities; reproducible CycloneDX SBOM validated |

The isolated profile and extension directory were moved to the operating-system
Trash after the smoke test. No development extension was loaded during those
packaged-VSIX checks. The trusted run used a temporary isolated profile with
workspace trust disabled in that profile only; it did not alter the user's VS Code
settings. The current VSIX passed both clean-profile smoke paths, but the release
remains unsigned while the manual filesystem, trash, accessibility,
case-only-redo, and independent-review gates below are incomplete.

The `VLT-027` implementation stages case-only file and folder renames through
collision-resistant sibling names inside the same canonical directory. Affected
link edits remain in the same native workspace operation; undo completion
restores original entry casing, and Live Preview plus ordinary text-editor redo
routes restage entries before replay. VS Code 1.138 on macOS still canonicalizes
the recorded redo destination to its original casing and rejects that replay;
the extension restores the source and removes staging artifacts, but this remains
a release blocker. This matches VS Code's documented canonical-model behavior:
the maintainers state that case-only renames retain the existing model under its
canonical URI and that no extension-facing solution is currently available
([microsoft/vscode#121106](https://github.com/microsoft/vscode/issues/121106)).
The public `workspace.applyEdit` contract guarantees all-or-nothing behavior for
text-only edits but explicitly does not make that guarantee for edits containing
resource operations
([VS Code API](https://code.visualstudio.com/api/references/vscode-api#workspace.applyEdit)),
so the extension must not mask a failed replay by assuming its link edits committed.
Automated forward checks preserve dirty
user text, explicitly enforce the requested post-commit casing when VS Code
canonicalizes an open editor to the old spelling, retarget affected editor tabs,
Unicode/emoji filenames compare by canonical Unicode segments, and
a rejected final workspace edit restores the original casing without leaving a
temporary staging file. Closed Markdown inputs are snapshot before commit, so
an external change after link planning aborts the move without overwriting the
newer content. Because an isolated extension-host window cannot dispatch VS Code's
focus-dependent public `undo` command, the complete macOS/Windows focused
undo/redo journey remains an explicit manual release gate rather than being
reported as automated evidence.

## Automated gates

- [x] Verify dependency policy, then install exactly from the lockfile with `npm ci --ignore-scripts`.
- [x] Run type checking with `npm run typecheck`.
- [x] Run all unit and performance tests with `npm test`.
- [x] On the documented reference machine, run the opt-in 10,000-item/1 GiB filesystem gate with `npm run test:performance:filesystem`.
- [x] Run the trusted and genuinely untrusted extension-host suites with `npm run test:integration` and `npm run test:integration:restricted`.
- [x] Run all browser and malicious-content tests with `npm run test:e2e`.
- [x] Create the production package with `npm run package`, then run `npm run test:vsix`; the archive verifier and clean-profile trusted/Restricted Mode packaged-extension suites must pass.
- [x] Run `npm run security:audit`; no critical or high finding is accepted.
- [x] Generate the validated CycloneDX SBOM with `npm run security:sbom` and retain `local-markdown-vault.cdx.json` with the release evidence. The file is excluded from Git and the VSIX because the CI and release workflows retain it as a separate artifact.
- [ ] Confirm CodeQL, dependency review, and secret scanning pass for the release commit.
- [ ] Review `npm ci --ignore-scripts` output, the lockfile diff, licenses, and `THIRD-PARTY-NOTICES.md`. The package command automatically rejects missing release documents, source/tests/configuration, source maps, SBOMs, secret-key formats, unsafe ZIP paths, symlinks, corrupt entries, and unexpectedly large archives or files.
- [x] Replace the inherited publisher and upstream project URLs with the fork identity `arronjablonowski.local-markdown-vault` and `ArronJablonowski/local-markdown-vault-vscode`; retain the original project as an attributed upstream remote.

## Security gate

- [ ] Opening the malicious corpus causes no script execution, VS Code command execution, unsolicited request, external file read, or write outside the vault.
- [ ] Raw HTML, unsafe URLs, malformed messages, hostile SVG/XML/YAML/CSS, traversal, symlink escape, and parser/resource bombs fail closed with bounded diagnostics.
- [ ] Default settings make no network request. Remote HTTPS media works only after a per-workspace opt-in.
- [ ] Restricted Mode keeps plain Markdown editing usable and disables diagrams, custom CSS, remote media, attachment writes, and vault-wide mutations.
- [ ] CSP and `localResourceRoots` match the documented minimum; any CodeMirror inline-style exception is re-reviewed.
- [ ] Private vulnerability reporting is enabled for the release repository and the contact path in `SECURITY.md` works.

## Data-integrity and compatibility gate

- [ ] Create, rename, multi-move, folder-move, and trash flows pass for Unicode, emoji, collisions, case-only rename, dirty open notes, and external filesystem changes.
- [ ] A move and all affected Markdown/wikilink rewrites undo in one step; redo reapplies them in one step; forced failures leave no partial changes.
- [ ] Keyboard-driven Live Preview undo and redo preserve one logical edit per step and never diverge from the backing `TextDocument`.
- [ ] Existing Markdown, relative links, local attachments, CSS themes, split editors, and external edits behave as documented.
- [ ] An existing Obsidian vault opens without changing `.obsidian/`; disabling the extension leaves all notes usable.
- [ ] Deleting the metadata cache and selecting **Rebuild Vault Index** never changes note or attachment files.
- [ ] Inspect a generated metadata cache and confirm it contains no frontmatter values, task text, or body-derived search tokens; startup rebuild still restores complete search and navigation behavior.

The undo/redo items require a foreground VS Code session. Extension-host command tests alone are insufficient because some headless hosts do not dispatch the UI `undo` and `redo` commands to the editor widget.

## Product and accessibility gate

- [ ] Wikilinks, aliases, heading/block links, embeds, properties, callouts, math, footnotes, tags, tasks, tables, Quick Switcher, search, backlinks, unlinked mentions, recent notes, and hover previews pass their documented journeys.
- [ ] Complete the keyboard, focus, screen-reader, high-contrast, and 200 percent zoom checks in `docs/ACCESSIBILITY.md`.
- [ ] English and Japanese commands, settings, errors, empty states, and accessibility labels contain no unresolved localization placeholders.
- [ ] Diagnostic logging is off by default, bounded to 500 entries and 64 KiB, remains local, and redacts bodies, URLs, clipboard content, secrets, errors, and absolute paths.

## Performance and platform evidence

- [ ] Record five clean 10,000-item vault runs and p95 results in `docs/PERFORMANCE.md` without weakening a budget.
- [ ] Verify Windows, macOS, and Linux on local `file:` workspaces. Record filesystem behavior, trash behavior, case sensitivity, symlink/junction handling, integration results, and the VSIX smoke test below.
- [x] Run the **Cross-platform release validation** workflow for the candidate commit and retain its three packaged-VSIX artifacts plus the separate release SBOM artifact. A green hosted run supplements but does not replace the manual filesystem and trash checks.

| Platform | Version/filesystem | Integration | Trash and path cases | Installed VSIX smoke test | Reviewer/date |
| --- | --- | --- | --- | --- | --- |
| Windows | GitHub `windows-latest`; runner-default filesystem | Passed | Manual trash/filesystem review pending | Passed | Automated / 2026-09-20 |
| macOS | GitHub `macos-latest`; runner-default filesystem | Passed | Manual trash/filesystem review pending | Passed | Automated / 2026-09-20 |
| Linux | GitHub `ubuntu-latest`; runner-default filesystem | Passed | Manual trash/filesystem review pending | Passed | Automated / 2026-09-20 |

## Packaged-VSIX smoke test

- [x] Install the newly produced VSIX into a clean profile with no development extension loaded.
- [ ] Open a trusted single-folder workspace and confirm the vault tree, Live Preview, link navigation, local images, diagrams, index, and knowledge views.
- [ ] Repeat in Restricted Mode and confirm the documented controls are absent or disabled.
- [ ] Inspect the packaged file list: source, tests, fixtures, development configuration, and local benchmark data are absent; required licenses, security guidance, accessibility guidance, and migration guidance are present.
- [ ] Confirm no critical/high security, dependency, accessibility, data-loss, undo/redo, or published-performance issue remains.

Any unchecked release blocker keeps the release in development status.
