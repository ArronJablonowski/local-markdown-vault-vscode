# Secure Obsidian Style Markdown Editor and Document Vault

## Product requirements document

| Field | Value |
| --- | --- |
| Product | Local Markdown Vault for Visual Studio Code |
| Baseline | `v0.2.0`, commit `e199ecedd4099d78caadb4dedf49cf4f394f1ff0` |
| Document status | Approved implementation roadmap |
| Audience | Project owner, maintainers, security reviewers, and implementation engineers |
| Last researched | 2026-09-19 |
| Delivery model | Local-only VS Code extension; macOS-first developer preview |

## 1. Executive summary

The extension's inherited Markdown Live Preview editor already provides a credible single-pane Markdown editing experience: it uses CodeMirror 6, hides inactive Markdown syntax, renders tables and diagrams in place, synchronizes edits with VS Code documents, and retains plain Markdown on disk. Local Markdown Vault expands that foundation into a safe local knowledge workspace with a Document Vault for managing related notes and attachments.

The product will treat one local VS Code workspace folder as a vault. It will never introduce extension-managed synchronization, accounts, telemetry, publishing, or background uploads. A native VS Code tree will manage the vault's files and folders. Renames and moves will automatically update affected Markdown links and wikilinks in a single undoable operation.

Security is the release gate, not a parallel enhancement. Before vault or rendering capabilities expand, the extension must block unsolicited network access, validate all webview messages, confine filesystem access to the canonical vault root, sanitize generated SVG, apply resource limits, and support VS Code Restricted Mode. Opening a malicious Markdown file must not execute code, contact a remote host, invoke a command, or read or write outside the vault.

The roadmap intentionally targets the parts of Obsidian that support local writing and knowledge management. It does not attempt to clone the entire Obsidian application.

The first user-facing developer preview supports macOS. The implementation remains portable and continues to run hosted Windows and Linux checks, but those operating systems are not support claims until their manual filesystem, Trash, accessibility, and packaged-extension qualification is completed in Phase 4.

## 2. Product vision and principles

### 2.1 Vision

Provide an Obsidian-like Live Preview editor inside VS Code that is pleasant for everyday note-taking, stores ordinary files in an ordinary folder, and is safe to use with Markdown from an unknown source.

### 2.2 Product principles

1. **Local by construction.** Notes, attachments, indexes, and preferences remain on the user's device. Network access is exceptional, visible, and opt-in.
2. **Plain files remain authoritative.** Markdown and attachments are the source of truth. Indexes and caches are disposable and rebuildable.
3. **Untrusted content is data.** Markdown, YAML, Mermaid text, draw.io XML, SVG, CSS, filenames, paths, settings, and webview messages are never assumed safe.
4. **One editing model.** Live Preview must use VS Code's `TextDocument` and `WorkspaceEdit` facilities so save, dirty state, undo, redo, and external edits remain coherent.
5. **Native VS Code where possible.** File management uses `TreeView`, commands, menus, drag-and-drop, notifications, Workspace Trust, and filesystem APIs rather than recreating those controls in a webview.
6. **Obsidian-like, not proprietary.** Obsidian syntax is supported where it improves local Markdown workflows, but content must remain readable and editable in other tools.
7. **Secure defaults.** A fresh installation performs no content-triggered network request and exposes the minimum webview and filesystem capabilities.

## 3. Goals, non-goals, and users

### 3.1 Goals

- Make Live Preview safe for Markdown received from an untrusted person or repository.
- Match Obsidian's core Live Preview behavior for common Markdown and note-linking workflows.
- Add a local workspace-folder Document Vault with reliable file and folder management.
- Preserve compatibility with existing `.md` and `.markdown` files, relative links, attachments, themes, and VS Code editing behavior.
- Provide fast local navigation through search, quick switching, tags, aliases, and backlinks.
- Establish security, accessibility, quality, and performance gates suitable for a public Marketplace release.

### 3.2 Non-goals

The following are out of scope for this roadmap:

- Cloud synchronization or an extension-provided synchronization protocol.
- Accounts, authentication, licensing services, telemetry, analytics, advertising, or crash uploads.
- Obsidian Sync, Publish, Canvas, Bases, Graph View, or a community plugin runtime.
- Executing scripts, commands, macros, templates, or code supplied by a vault.
- Editing arbitrary folders outside the active local workspace.
- Multiple simultaneous vaults, nested vaults, multi-root workspaces, virtual workspaces, or remote filesystem providers in the initial release.
- Full compatibility with every Obsidian theme, plugin, or undocumented behavior.
- Rendering arbitrary raw HTML from Markdown.

### 3.3 Primary users

- **Local note-taker:** writes interconnected notes and wants an Obsidian-like editor without leaving VS Code.
- **Documentation author:** edits Markdown tracked in Git and needs accurate source preservation, diagrams, tables, and attachments.
- **Security-conscious user:** opens Markdown from repositories, downloads, or collaborators and expects no active content or tracking.
- **Maintainer:** needs explicit component boundaries, testable requirements, and release gates.

### 3.4 Representative user journeys

1. A user opens a cloned repository containing hostile Markdown. The note renders without scripts, remote requests, arbitrary links, external file access, or UI spoofing.
2. A user creates a note and attachment from the Document Vault, writes links with completion, renames a folder, and finds every affected link updated in the same undoable operation.
3. A user opens an existing Obsidian-style vault, follows wikilinks, edits properties and callouts, embeds another note, and searches backlinks without converting the files.
4. A user denies Workspace Trust and can safely read and edit plain Markdown while diagrams, custom CSS, remote media, and vault-wide mutations remain unavailable.

## 4. Research basis

### 4.1 Obsidian behavior used as the product reference

Official Obsidian documentation establishes the following reference behavior:

- Live Preview shows formatting in the editing surface and reveals Markdown syntax around the cursor. Source mode remains available.
- A vault is a local filesystem folder containing Markdown notes, attachments, subfolders, and optional local configuration. External file changes are reflected in the vault.
- File Explorer creates, renames, moves, deletes, sorts, collapses, expands, and auto-reveals files and folders. It supports context menus and drag-and-drop.
- Internal links support wikilinks and Markdown links, vault-root paths, aliases, headings, blocks, unresolved notes, link completion, and automatic updates after rename.
- Embeds can display local notes, headings, blocks, images, audio, and PDFs inline.
- Properties are YAML stored at the beginning of a note and are edited as typed values.
- Obsidian formatting includes callouts, tables, Mermaid diagrams, math, footnotes, task lists, and tags.
- Search, Quick Switcher, and Backlinks are separate local navigation surfaces backed by vault metadata.
- Obsidian's Restricted Mode illustrates the principle that third-party code execution must be disabled by default. This project will go further by not providing a plugin runtime at all.

These are behavioral references, not a requirement to reproduce Obsidian's visual design or private implementation.

### 4.2 VS Code platform guidance

The implementation will follow these official platform constraints:

- Webviews should have only the capabilities and `localResourceRoots` they require, use a restrictive Content Security Policy, keep the VS Code API object private, and sanitize all user input.
- `CustomTextEditorProvider` is the appropriate model for text files and uses VS Code `TextDocument` and standard editing APIs.
- Workspace Trust supports `limited` operation in Restricted Mode and requires both manifest declarations and runtime enforcement.
- Trust-sensitive commands must be blocked in code even when hidden by `when` clauses.
- Trusted and untrusted workspace behavior require separate integration test runs.

### 4.3 Mermaid guidance

Mermaid documents that `securityLevel: "strict"` encodes HTML labels and disables click behavior. Mermaid also exposes `maxTextSize`, `maxEdges`, and a protected `secure` configuration list. Mermaid's own documentation warns that diagram input is difficult to sanitize perfectly; the extension therefore requires strict configuration plus output sanitization and resource limits.

### 4.4 Primary sources

All product and security claims in this PRD should be revalidated against these primary sources when the related phase begins:

- [Obsidian Live Preview](https://help.obsidian.md/Live+preview+update)
- [Obsidian vault management](https://help.obsidian.md/Files+and+folders/Manage+vaults)
- [How Obsidian stores data](https://help.obsidian.md/Files+and+folders/How+Obsidian+stores+data)
- [Obsidian File Explorer](https://help.obsidian.md/Plugins/File+explorer)
- [Obsidian internal links](https://help.obsidian.md/Linking+notes+and+files/Internal+links)
- [Obsidian embeds](https://help.obsidian.md/Linking+notes+and+files/Embed+files)
- [Obsidian properties](https://help.obsidian.md/Editing+and+formatting/Properties)
- [Obsidian callouts](https://help.obsidian.md/Editing+and+formatting/Callouts)
- [Obsidian advanced formatting](https://help.obsidian.md/Editing+and+formatting/Advanced+formatting+syntax)
- [Obsidian tags](https://help.obsidian.md/Editing+and+formatting/Tags)
- [Obsidian search](https://help.obsidian.md/Plugins/Search)
- [Obsidian backlinks](https://help.obsidian.md/Plugins/Backlinks)
- [Obsidian Quick Switcher](https://help.obsidian.md/Plugins/Quick+switcher)
- [Obsidian plugin security](https://help.obsidian.md/Extending+Obsidian/Plugin+security)
- [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- [VS Code Custom Editor API](https://code.visualstudio.com/api/extension-guides/custom-editors)
- [VS Code Workspace Trust guide](https://code.visualstudio.com/api/extension-guides/workspace-trust)
- [VS Code extension testing](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [Mermaid security level](https://mermaid.js.org/config/schema-docs/config-properties-securitylevel.html)
- [Mermaid configuration](https://mermaid.js.org/config/schema-docs/config)
- [GitHub dependency review](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review)
- [GitHub secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning)

### 4.5 Repository evidence

The current-state assessment is pinned to the reviewed commit rather than a moving branch:

- [Extension manifest and dependencies](https://github.com/t-shoot/md-live-preview-editor/blob/e199ecedd4099d78caadb4dedf49cf4f394f1ff0/package.json)
- [Extension activation and editor switching](https://github.com/t-shoot/md-live-preview-editor/blob/e199ecedd4099d78caadb4dedf49cf4f394f1ff0/src/extension.ts)
- [Custom editor webview options and CSP](https://github.com/t-shoot/md-live-preview-editor/blob/e199ecedd4099d78caadb4dedf49cf4f394f1ff0/src/editor/MarkdownLivePreviewProvider.ts)
- [Document synchronization and privileged message handling](https://github.com/t-shoot/md-live-preview-editor/blob/e199ecedd4099d78caadb4dedf49cf4f394f1ff0/src/editor/documentSync.ts)
- [Host and webview message types](https://github.com/t-shoot/md-live-preview-editor/blob/e199ecedd4099d78caadb4dedf49cf4f394f1ff0/src/shared/messages.ts)
- [Mermaid strict-mode configuration and SVG insertion](https://github.com/t-shoot/md-live-preview-editor/blob/e199ecedd4099d78caadb4dedf49cf4f394f1ff0/src/webview-editor/mermaidWidget.ts)
- [draw.io parsing and SVG generation](https://github.com/t-shoot/md-live-preview-editor/blob/e199ecedd4099d78caadb4dedf49cf4f394f1ff0/src/shared/drawioSvg.ts)
- [Existing automated test layout](https://github.com/t-shoot/md-live-preview-editor/tree/e199ecedd4099d78caadb4dedf49cf4f394f1ff0/test)
- [Published feature history and security notes](https://github.com/t-shoot/md-live-preview-editor/blob/e199ecedd4099d78caadb4dedf49cf4f394f1ff0/CHANGELOG.md)

## 5. Current product assessment

### 5.1 Existing capabilities to preserve

| Area | Baseline behavior |
| --- | --- |
| Editor | CodeMirror 6 custom text editor; formatted Live Preview with syntax revealed at the active line |
| Synchronization | Webview edits use `WorkspaceEdit`; external changes, version checks, undo, and redo synchronize through VS Code |
| Markdown | Headings, emphasis, blockquotes, lists, task lists, links, images, rules, GFM tables, fenced code, and frontmatter |
| Search | Raw-Markdown find and replace, regular expressions, case/word controls, and multi-cursor selection |
| Tables | Rendered cells, in-place cell edits, row/column addition, alignment, selection, and source-mode escape hatch |
| Code | Shiki syntax highlighting and copy/source controls |
| Diagrams | Mermaid and locally parsed draw.io, including file-backed draw.io and AWS shapes |
| Attachments | Clipboard and drag/drop images saved to a note-relative `assets/` folder |
| Navigation | Clickable Markdown links and an active-document outline |
| Appearance | Global user CSS themes and light/dark/high-contrast integration |
| Tests | Vitest unit tests, VS Code integration tests, Playwright end-to-end tests, and manual verification guidance |

### 5.2 Positive security controls already present

- Webviews use `default-src 'none'`, nonce-bearing scripts, and explicit local resource roots.
- Mermaid is initialized with `securityLevel: "strict"`.
- File-backed draw.io reads are limited to 5 MB and checked against the note's directory tree.
- The draw.io renderer escapes labels and validates colors before generating SVG.
- Table cell rendering uses DOM construction and treats unsupported raw HTML as text.
- Document edits include a base-version check and serialize queued edit operations.
- Pasted image filenames are generated by the extension rather than copied from hostile input.

### 5.3 Security and product gaps

The entries below are risks to be resolved, not claims that exploitation has been demonstrated.

| ID | Priority | Observed gap | Required disposition |
| --- | --- | --- | --- |
| GAP-01 | Critical | The editor CSP permits HTTPS and data images, so opening Markdown can create an unsolicited remote request or load a large data URI. | Block remote and data media by default; gate HTTPS behind explicit workspace opt-in. |
| GAP-02 | Critical | Link handling accepts any multi-character URI scheme and passes it to `openExternal`. | Replace scheme detection with an allowlist and reject `javascript:`, `command:`, `data:`, `file:`, and unknown schemes. |
| GAP-03 | Critical | TypeScript message types are compile-time only; host message handlers do not perform complete runtime validation. | Add shared runtime schemas, strict bounds, unknown-field rejection, and negative tests. |
| GAP-04 | High | Pasted base64 image payloads and edit batches have no explicit byte, count, or range limits. | Validate decoded size before allocation/write and bound all edit queues and message payloads. |
| GAP-05 | High | Mermaid output and generated draw.io SVG are inserted with `innerHTML`. | Sanitize and verify SVG before insertion; reject dangerous elements, attributes, URLs, and oversized output. |
| GAP-06 | High | File-backed draw.io is confined to the note directory, but general relative link navigation can traverse above the future vault root. | Centralize canonical vault containment for all resource operations and navigation. |
| GAP-07 | High | The editor exposes the note directory through `localResourceRoots`; a vault feature increases the potential local-resource surface. | Use the smallest per-panel roots and mediate resources through validated host requests when direct loading cannot be tightly confined. |
| GAP-08 | High | User CSS is transformed but not treated as a security boundary; remote URLs and UI-overriding selectors require explicit handling. | Scope CSS, reject network-bearing constructs, and protect extension controls from theme rules. |
| GAP-09 | High | Workspace Trust behavior and manifest capabilities are not declared. | Add limited Restricted Mode with runtime enforcement and separate tests. |
| GAP-10 | Medium | Mermaid uses library defaults for some complexity controls instead of product-owned limits. | Set explicit text, edge, output, and render-time limits. |
| GAP-11 | Medium | There is no documented security policy or automated supply-chain gate. | Add reporting guidance, dependency review, static analysis, secret scanning, SBOM, and release checks. |
| GAP-12 | Medium | The extension retains hidden webview contexts, increasing memory use and the lifetime of rendered content. | Measure the need, persist minimal UI state, and disable retention if equivalent behavior can be restored safely. |

### 5.4 Evidence limitations at baseline

- `node_modules` was absent during this review, so `npm test` could not start because `vitest` was unavailable.
- The npm advisory endpoint returned HTTP 503 maintenance status. This is an unavailable result, not a clean audit.
- The lockfile resolves notable versions including Mermaid `11.16.0`, DOMPurify `3.4.11`, YAML `2.9.0`, esbuild `0.24.2`, CodeMirror View `6.43.4`, and Shiki Core `1.29.2`. These versions must be checked again when Phase 0 starts.
- The repository retains `t-shoot/md-live-preview-editor` as its upstream source and uses `ArronJablonowski/local-markdown-vault-vscode` as the fork's origin.

## 6. Security model and Phase 0 requirements

### 6.1 Protected assets

- Files and directories inside and outside the vault.
- Unsaved Markdown changes and the VS Code undo/redo history.
- User privacy, IP address, network metadata, and remote-media access choices.
- The extension host, VS Code commands, clipboard data, and external applications.
- Webview integrity, including editor controls and user-visible warnings.
- Availability of the extension host and webview main thread.

### 6.2 Untrusted inputs

- Markdown text and raw HTML-like text.
- YAML frontmatter, aliases, tags, filenames, and link destinations.
- Mermaid definitions, configuration directives, and returned SVG.
- Embedded and file-backed draw.io XML.
- Local image and attachment bytes.
- CSS theme contents and workspace settings.
- Webview messages, including messages forged after a webview compromise.
- Filesystem events, symlinks, case changes, and concurrent external edits.

### 6.3 Trust boundaries

1. Markdown/webview DOM to webview JavaScript.
2. Webview JavaScript to extension host messages.
3. Extension host to VS Code APIs and operating-system integrations.
4. Vault root to the rest of the filesystem.
5. Local process to the network.
6. Package lockfile to third-party build and runtime dependencies.

### 6.4 Mandatory security requirements

#### Network and URL policy

- **SEC-001:** A default installation must make zero network requests caused by opening, scrolling, searching, or editing a Markdown file.
- **SEC-002:** `mdLivePreview.remoteMedia` must be a workspace-scoped enum with `block` as the default and `https` as the only opt-in alternative.
- **SEC-003:** HTTPS opt-in applies only to images explicitly referenced by the note. It must not enable remote scripts, styles, fonts, frames, audio, video, Mermaid dependencies, draw.io files, CSS imports, or redirects to other schemes.
- **SEC-004:** External navigation must use an explicit allowlist: `https:` and `mailto:`. `http:` may be opened only after an interstitial warning that identifies the insecure destination. All other schemes are rejected.
- **SEC-005:** Same-document anchors and validated vault links are handled internally. `javascript:`, `command:`, `vscode:`, `data:`, `blob:`, `file:`, protocol-relative URLs, control characters, and ambiguous encodings are never handed to the shell.
- **SEC-006:** The extension must not contain analytics, telemetry, update checks, remote configuration, or any extension-owned background networking.

#### Filesystem confinement

- **SEC-010:** `VaultService` must derive one canonical root from the sole local `file:` workspace folder.
- **SEC-011:** Every read, write, stat, create, rename, move, delete, embed, preview, and link-open request must pass through one containment service.
- **SEC-012:** Containment must normalize percent encoding and separators, resolve `.` and `..`, account for platform case sensitivity, and resolve symlinks before authorization.
- **SEC-013:** Symlinked directories are shown as non-expandable entries by default. Operations affect the link itself and never traverse its target outside the vault.
- **SEC-014:** TOCTOU-sensitive writes use create-without-overwrite or an atomic temporary-file-and-rename strategy inside the destination directory.
- **SEC-015:** Pasted or dropped attachments use generated safe filenames, validated media types, collision avoidance, and a maximum decoded size of 20 MiB per file and 40 MiB per operation.
- **SEC-016:** No error message or log may expose arbitrary file contents, secrets, or unnecessary absolute paths.

#### Webview and message boundary

- **SEC-020:** All host-to-webview and webview-to-host messages must be parsed by shared runtime validators before dispatch.
- **SEC-021:** Validators must reject unknown message types, unexpected fields, non-finite numbers, invalid offsets, overlapping or unsorted edits, excessive strings, excessive arrays, malformed base64, unsupported MIME types, and stale document versions.
- **SEC-022:** Editor messages are limited to 1 MiB encoded size, 1,000 text changes per batch, and 64 queued batches. Paste messages follow the separate attachment limits.
- **SEC-023:** The webview-acquired VS Code API object remains closure-private and is never attached to `window` or another user-content-accessible object.
- **SEC-024:** CSP begins with `default-src 'none'`. Scripts are local and nonce-authorized. Network image sources are omitted unless the user has enabled HTTPS media for that workspace.
- **SEC-025:** `localResourceRoots` must be set per webview to the minimum extension assets and validated local content roots. A root is not considered a complete security boundary.
- **SEC-026:** Inline script is prohibited. If CodeMirror or runtime decoration requires inline style, the exception must be documented, tested, and limited to style rather than script execution.

#### Rendering and parser safety

- **SEC-030:** Unsupported raw HTML is displayed as inert text in both normal content and table cells.
- **SEC-031:** Mermaid remains at `securityLevel: "strict"`; protected keys include `securityLevel`, `secure`, `startOnLoad`, `maxTextSize`, and `maxEdges` so document directives cannot override them.
- **SEC-032:** Mermaid input is limited to 100 KiB and 500 edges per diagram. Rendering is canceled after 2 seconds, and output is limited to 2 MiB and 50,000 DOM nodes.
- **SEC-033:** Mermaid SVG passes through an SVG-specific sanitizer that permits only the elements and attributes required by supported diagrams and rejects scripts, event handlers, `foreignObject`, external URLs, unsafe CSS, animation elements, and namespace tricks.
- **SEC-034:** draw.io XML remains limited to 5 MiB, uses a parser that does not resolve external entities, and has explicit page, cell, edge, depth, and decompression limits.
- **SEC-035:** Generated draw.io SVG must pass the same post-generation verifier as Mermaid SVG before insertion.
- **SEC-036:** YAML parsing must limit aliases, node count, nesting depth, and input bytes. Parsing errors are shown as text without echoing uncontrolled markup.
- **SEC-037:** User CSS is scoped beneath the document preview root. It must reject `@import`, external or data `url()`, `behavior`, `-moz-binding`, extension-control selectors, and rules that position content over protected controls.
- **SEC-038:** All syntax highlighting grammars, diagram code, fonts, icons, and product styles ship locally.

#### Workspace Trust and supply chain

- **SEC-040:** The extension manifest declares `capabilities.untrustedWorkspaces.supported` as `"limited"` and explains the limitation through localization files.
- **SEC-041:** In Restricted Mode, plain Markdown viewing and text editing remain available. Remote media, Mermaid, draw.io, user CSS, attachment writes, and vault-wide create/rename/move/delete operations are disabled.
- **SEC-042:** Trust-sensitive commands are hidden using `isWorkspaceTrusted` and independently rejected in command handlers.
- **SEC-043:** CI must run type checking, unit tests, integration tests, end-to-end tests, package creation, lockfile integrity checks, dependency review, CodeQL or equivalent static analysis, secret scanning, and SBOM generation.
- **SEC-044:** Production dependencies are pinned by the lockfile. Dependency changes require review of transitive packages, licenses, install scripts, browser capabilities, and known advisories.
- **SEC-045:** Add `SECURITY.md` with supported versions, private reporting instructions, response expectations, and a prohibition on publishing unpatched exploit details.

### 6.5 Phase 0 exit criteria

Phase 0 is complete only when:

- Every `SEC-*` requirement has an automated test or documented manual verification.
- The malicious Markdown corpus passes with no code execution, command invocation, vault escape, external file disclosure, unsolicited network request, or unbounded resource use.
- Trusted and Restricted Mode integration suites both pass.
- Dependency, static-analysis, secret, and package scans have no unresolved critical or high findings.
- An independent reviewer signs off on the path, protocol, message, CSP, SVG, XML, YAML, CSS, and network boundaries.

No Phase 1 or Phase 2 feature may be released before this gate passes.

## 7. Phase 1 Document Vault

### 7.1 Vault definition and lifecycle

- **VLT-001:** A vault is exactly one local `file:` VS Code workspace folder and all non-excluded descendants that remain within its canonical root.
- **VLT-002:** With no workspace, a multi-root workspace, a virtual workspace, or a non-file workspace, the vault view shows a clear unsupported-state message and performs no filesystem mutation.
- **VLT-003:** The extension stores preferences and rebuildable metadata in extension storage keyed by a one-way hash of the canonical vault URI. It does not create a proprietary configuration folder in the vault.
- **VLT-004:** Markdown and attachments remain ordinary files. Removing the extension leaves a usable folder with no required migration.
- **VLT-005:** Nested vault behavior is unsupported. The extension does not infer or honor `.obsidian` as a second vault boundary.

### 7.2 Native Vault view

- **VLT-010:** Add a native `TreeView` named **Document Vault** to the existing activity-bar container.
- **VLT-011:** Display folders, `.md`, `.markdown`, and other files with native icons; opening a Markdown file uses the configured editor, while other files use VS Code's default opener.
- **VLT-012:** Provide commands for new note, new folder, rename, move, delete, refresh, expand all, collapse all, copy relative path, and reveal in the operating-system file manager.
- **VLT-013:** Support context menus, keyboard activation, inline rename, multi-selection, and `TreeDragAndDropController` moves.
- **VLT-014:** Auto-reveal and highlight the active note when `mdLivePreview.vault.autoReveal` is enabled.
- **VLT-015:** Sort by name ascending, name descending, modified newest, modified oldest, created newest, or created oldest. Folders precede files within each level.
- **VLT-016:** Watch external create, change, delete, and rename events and update only affected tree and index entries without a full refresh.
- **VLT-017:** Ignore excluded paths during display, indexing, search, and link suggestions. Excluded files remain accessible through normal VS Code tools.

### 7.3 Safe file operations

- **VLT-020:** New notes default to `.md`; illegal names, reserved device names, empty names, traversal, and collisions are rejected before mutation.
- **VLT-021:** The default attachment directory is a note-relative `assets/` folder. A configured attachment path must still resolve inside the vault.
- **VLT-022:** Deletion uses the operating-system trash when supported. Non-empty folders require a confirmation showing the relative path and item count.
- **VLT-023:** Permanent deletion is not exposed by this extension. If trash is unavailable, the operation fails with recovery guidance rather than silently deleting permanently.
- **VLT-024:** File and folder renames and moves include associated link rewrites in one `WorkspaceEdit` or an equivalent transaction with rollback. The action appears as one undoable operation.
- **VLT-025:** Open dirty documents participate through their current `TextDocument` content. The operation does not overwrite unsaved edits from disk.
- **VLT-026:** If any precondition changes between planning and commit, the entire operation aborts and reports affected files; no partial move or link rewrite remains.
- **VLT-027:** Case-only renames work on case-insensitive filesystems through a unique temporary name within the same directory.

### 7.4 Automatic link updates

- **VLT-030:** Automatic link updates are enabled by default and occur without a confirmation prompt, as selected for this product.
- **VLT-031:** `LinkRewriteService` updates relative Markdown links, vault-root Markdown links, wikilinks, embeds, heading links, block links, and percent-encoded paths.
- **VLT-032:** The service preserves link labels, aliases, titles, fragments, image dimensions, line endings, and unrelated source formatting.
- **VLT-033:** A wikilink whose basename remains unique retains its shortest valid form. An ambiguous result becomes the shortest unambiguous vault-relative path.
- **VLT-034:** External URLs, fenced code, inline code, escaped syntax, and raw text that merely resembles a link are never rewritten.
- **VLT-035:** Folder moves rewrite links both from moved notes to other targets and from other notes to moved targets.
- **VLT-036:** Broken links are indexed and surfaced but are not rewritten unless their parsed target is the item being moved.

### 7.5 Vault settings

| Setting | Type | Default | Scope | Behavior |
| --- | --- | --- | --- | --- |
| `mdLivePreview.remoteMedia` | `block \| https` | `block` | Workspace | Controls remote note images only |
| `mdLivePreview.vault.updateLinksOnMove` | boolean | `true` | Workspace | Automatically rewrites links during rename/move |
| `mdLivePreview.vault.attachmentFolder` | string | `assets` | Workspace | Note-relative attachment directory; must remain in vault |
| `mdLivePreview.vault.sortOrder` | enum | `nameAsc` | Workspace | Tree sort order |
| `mdLivePreview.vault.autoReveal` | boolean | `true` | Workspace | Reveals the active note in the Vault view |
| `mdLivePreview.vault.exclude` | string array | `.git`, `node_modules`, OS metadata | Workspace | Glob patterns omitted from view and index |
| `mdLivePreview.diagramRendering` | `safe \| off` | `safe` | Workspace | Enables bounded, sanitized diagrams in trusted workspaces |

`remoteMedia`, `attachmentFolder`, `exclude`, and `diagramRendering` are restricted configurations under Workspace Trust.

## 8. Phase 2 Obsidian style editor parity

### 8.1 Links and completion

- **EDT-001:** Render and edit `[[Note]]`, `[[Folder/Note]]`, `[[Note|Alias]]`, heading links, and block links.
- **EDT-002:** Typing `[[` opens keyboard-accessible suggestions from the local vault index. Results include relative path and aliases when needed to disambiguate.
- **EDT-003:** `#` and `^` inside a wikilink offer heading and block suggestions from the selected note.
- **EDT-004:** Activating an unresolved internal link offers to create the note at the parsed in-vault path. Creation is a user action, never an open-time side effect.
- **EDT-005:** Internal anchor navigation moves the caret and viewport to the target heading or block without opening an external application.

### 8.2 Embeds

- **EDT-010:** Render local `![[...]]` note, heading, block, and image embeds inside Live Preview.
- **EDT-011:** Embedded Markdown is read-only in the parent note and visibly identifies its source. Activating it opens the source note at the embedded section.
- **EDT-012:** Detect direct and indirect embed cycles, cap nesting at three levels, and display a safe placeholder instead of recursing.
- **EDT-013:** Embedded content uses the same sanitizer, resource limits, remote-media policy, and vault containment as a top-level note.
- **EDT-014:** Audio and PDF links open through VS Code in this phase; inline audio and PDF viewers are deferred until separately threat-modeled.

### 8.3 Properties and syntax features

- **EDT-020:** Display YAML frontmatter as typed properties supporting text, lists, numbers, checkboxes, dates, date-times, tags, and quoted wikilinks.
- **EDT-021:** Property edits preserve valid YAML and unrelated formatting where possible. Complex or unsupported nested values fall back to source editing.
- **EDT-022:** Render standard Obsidian callout syntax, including titles, aliases, nesting, and collapsed/expanded state. Source text remains authoritative.
- **EDT-023:** Render inline and block math using a bundled, non-networked renderer with HTML disabled, command/package allowlists, input limits, and error placeholders.
- **EDT-024:** Render and edit footnote references and definitions with navigation in both directions.
- **EDT-025:** Task-list checkboxes are keyboard and pointer operable and update only the corresponding source marker through `WorkspaceEdit`.
- **EDT-026:** Render valid inline and YAML tags, including nested tags, without interpreting headings or code as tags.
- **EDT-027:** Add table commands for inserting, deleting, moving, sorting, and aligning rows and columns while preserving escaped pipes and source indentation.
- **EDT-028:** Continue to provide an explicit source-mode escape hatch for every rendered block and a whole-document source/live toggle.

### 8.4 Editing behavior

- **EDT-030:** Existing search, multi-cursor, undo, redo, external-edit synchronization, code highlighting, table editing, Mermaid, draw.io, CSS themes, attachments, and outline behavior must not regress.
- **EDT-031:** Common Obsidian-style shortcuts are implemented only where they do not override established VS Code defaults without a user-visible keybinding contribution.
- **EDT-032:** All new interactive widgets support keyboard entry and exit without trapping focus.
- **EDT-033:** Hidden syntax is revealed when selected, searched, focused, or needed to explain a parse error.
- **EDT-034:** Malformed or incomplete syntax remains editable and produces a bounded inline error or plain source, never an empty editor or uncaught exception.

## 9. Phase 3 local knowledge navigation

### 9.1 Metadata index

- **KNW-001:** `VaultIndex` maintains paths, basenames, headings, block IDs, aliases, tags, properties, outgoing links, embeds, and lightweight search tokens.
- **KNW-002:** Initial indexing reads only in-vault, non-excluded files and applies file-size and parse-time limits.
- **KNW-003:** File watchers and document-change events update affected records incrementally. Unsaved open documents override disk content.
- **KNW-004:** Persisted metadata is local, versioned, rebuildable, and invalidated by root, schema, exclusion, or extension-version changes.
- **KNW-005:** The index does not contain credentials, remote identifiers, embeddings, AI-derived data, or a second authoritative copy of note content.

### 9.2 Navigation surfaces

- **KNW-010:** Add a Quick Switcher command using `Cmd/Ctrl+O`, with recent notes for an empty query, fuzzy filename/alias matching, keyboard navigation, and explicit note creation.
- **KNW-011:** Add local vault search using `Cmd/Ctrl+Shift+F` when focus is in this extension's views. Results show note, path, matching context, and heading.
- **KNW-012:** Search supports plain terms, exact phrases, `OR`, negation, regular expressions with execution limits, and `file:`, `path:`, `tag:`, `task:`, and property filters.
- **KNW-013:** Add an active-note Backlinks view with linked mentions and bounded unlinked mentions, context previews, filtering, and sorting.
- **KNW-014:** Add a Tags view that groups nested tags, shows counts, and opens a filtered vault search.
- **KNW-015:** Hovering an internal link may show a local, sanitized, depth-one preview after an intentional delay. Hover preview performs no network request.
- **KNW-016:** Recently opened notes are stored locally as vault-relative paths, capped at 100 entries, and cleared when the vault metadata is reset.

## 10. Architecture and public interfaces

### 10.1 Component responsibilities

| Component | Responsibility | Must not do |
| --- | --- | --- |
| `VaultService` | Resolve the single vault root; authorize and perform safe filesystem operations | Parse Markdown or access paths without containment checks |
| `VaultIndex` | Incrementally index local metadata and search tokens | Mutate note contents or become authoritative storage |
| `LinkResolver` | Parse, normalize, resolve, and classify Markdown links, wikilinks, embeds, headings, and blocks | Open the shell or write files |
| `LinkRewriteService` | Plan minimal source edits for rename and move transactions | Commit partial edits or rewrite code-like text |
| `MessageValidator` | Runtime-validate every webview boundary object and enforce size/range limits | Trust TypeScript types at runtime |
| `RenderPolicy` | Apply trust state, remote-media policy, parser limits, and sanitization | Read workspace configuration that is restricted in untrusted mode |
| `VaultTreeProvider` | Present native file hierarchy and commands | Reimplement the tree in a webview |

### 10.2 Required extension contributions

`package.json` will add:

- A **Document Vault** native tree view in the existing activity-bar container.
- A **Backlinks** native tree view in Phase 3 and a **Tags** view if the native tree interaction is sufficient.
- Vault commands and context-menu entries for create, rename, move, delete, refresh, reveal, expand/collapse, and copy path.
- Quick Switcher and vault-search commands with platform-appropriate keybindings.
- The settings defined in this PRD with localized titles and descriptions.
- `capabilities.untrustedWorkspaces` set to limited and `capabilities.virtualWorkspaces` marked unsupported for the initial vault release.
- `when` clauses using `isWorkspaceTrusted`, vault availability, selection count, and resource type.

### 10.3 Message interfaces

- Retain discriminated messages but add an explicit protocol version to initialization.
- Parse `unknown` at every receiver; TypeScript interfaces are generated from or colocated with runtime schemas.
- Separate high-volume editor changes from privileged host operations.
- Privileged operations include opaque request IDs and return structured success or sanitized failure responses.
- A rejected message changes no state and emits a rate-limited diagnostic without echoing hostile payloads.

### 10.4 Compatibility and migration

- Existing settings retain their behavior unless a security requirement forces a safer default.
- Existing local images and attachments continue to resolve if they are inside the vault.
- Existing HTTPS images become blocked placeholders until the workspace opts in.
- Existing external links remain visible; only allowlisted schemes can be activated.
- Existing CSS remains editable, but unsafe rules are ignored with a visible diagnostic.
- Existing `.obsidian` folders are left untouched. The extension may read compatible Markdown syntax but does not modify Obsidian settings.
- A cache schema change causes a rebuild, never a note migration.

## 11. Quality, performance, and accessibility

### 11.1 Performance budgets

The benchmark fixture contains 10,000 vault items, including 8,000 Markdown notes, 2,000 attachments, 100,000 links, Unicode paths, and a total size up to 1 GiB. Results are recorded on a documented reference machine with at least four CPU cores, 8 GiB RAM, and SSD storage.

- **PERF-001:** Cold initial indexing completes within 3 seconds at the 95th percentile across five clean runs.
- **PERF-002:** A single create, edit, rename, or delete is reflected in the tree and index within 500 ms at the 95th percentile.
- **PERF-003:** Indexed filename, alias, tag, and ordinary text searches return the first result page within 200 ms at the 95th percentile after warm-up.
- **PERF-004:** Opening a 1 MiB note displays an editable first viewport within 1 second without blocking the extension host for more than 100 ms continuously.
- **PERF-005:** Background indexing yields between bounded batches, can be canceled, and never delays saving or typing.
- **PERF-006:** Hidden editor panels do not continue unnecessary parsing, timers, animation, or indexing.

If the reference environment cannot meet a budget, the phase does not silently weaken the target. The maintainer must document evidence and amend this PRD before release.

### 11.2 Accessibility requirements

- **A11Y-001:** Every command and interactive control is usable with a keyboard and has a visible focus indicator.
- **A11Y-002:** Webview controls have semantic elements, accessible names, state, and error associations.
- **A11Y-003:** Native views use VS Code labels, descriptions, icons, and context values rather than decorative text glyphs alone.
- **A11Y-004:** Live regions announce asynchronous render errors and completed file operations without announcing every keystroke.
- **A11Y-005:** Light, dark, and high-contrast themes meet WCAG 2.2 AA contrast for text and meaningful controls.
- **A11Y-006:** Zoom to 200 percent does not clip editor controls or prevent access to source mode.
- **A11Y-007:** Automated accessibility scans report no critical violations, followed by manual screen-reader and keyboard verification on supported platforms.

### 11.3 Localization and diagnostics

- All commands, settings, warnings, errors, empty states, and accessibility labels use VS Code localization APIs.
- English is the source language; existing Japanese localization remains supported.
- Errors identify the failed relative item and recovery action without exposing arbitrary content or system paths.
- Debug logs are opt-in, local, bounded, and redact Markdown bodies, URLs, clipboard contents, and absolute paths.

## 12. Verification strategy

### 12.1 Baseline sequence

Before implementation begins:

1. Run the dependency-policy verifier, then `npm ci --ignore-scripts` from the committed lockfile.
2. Run type checking and compilation.
3. Run unit, integration, and end-to-end suites.
4. Build the production bundle and VSIX package.
5. Run dependency audit, lockfile integrity, license, SBOM, static-analysis, and secret scans.
6. Record failures that predate changes separately from regressions.

### 12.2 Malicious content corpus

The repository will include inert fixtures and expected outcomes for:

- Raw `<script>`, event attributes, `iframe`, `object`, `embed`, `foreignObject`, forms, and DOM-clobbering names.
- `javascript:`, `command:`, `vscode:`, `data:`, `blob:`, `file:`, protocol-relative, mixed-case, escaped, percent-encoded, newline, and null-byte URLs.
- HTTPS tracking pixels, redirect chains, CSS `@import`, CSS `url()`, remote fonts, and data URLs.
- Mermaid callbacks, click directives, frontmatter configuration overrides, hostile labels, excessive edges, deep graphs, and oversized SVG.
- draw.io external entities, entity expansion, compressed bombs, excessive cells/pages/depth, hostile labels, and external SVG references.
- YAML alias bombs, deep nesting, duplicate keys, huge scalars, invalid encodings, and oversized documents.
- Plain, encoded, mixed-separator, UNC, drive-letter, case-folded, and symlink path traversal.
- Forged webview messages, unknown fields, negative and overflowing offsets, stale versions, overlapping edits, oversized base64, and queue flooding.
- Large documents, pathological regular expressions, repeated embeds, circular embeds, and render cancellation.

Automated browser tests must intercept all network requests and fail if any request not explicitly initiated by a test opt-in occurs.

### 12.3 Functional scenarios

- Vault creation states: no workspace, one local folder, multi-root, virtual, remote, trusted, and untrusted.
- Filesystem operations: Unicode, emoji, combining characters, reserved names, collisions, case-only renames, symlinks, read-only files, open dirty notes, and external concurrent changes.
- Link transactions: Markdown and wiki syntax, aliases, headings, blocks, embeds, moved folders, links in both directions, ambiguous basenames, percent encoding, and rollback.
- Editor syntax: incomplete input, nested emphasis, escaped punctuation, callouts, properties, math, footnotes, tags, tasks, tables, code, Mermaid, draw.io, and embeds.
- Knowledge features: initial index, incremental update, cache invalidation, exclusions, backlinks, unlinked mentions, aliases, tags, quick switching, and search filters.
- Accessibility: keyboard-only flows, focus order, screen-reader naming, high contrast, zoom, errors, and asynchronous announcements.
- Compatibility: existing sample files, current CSS themes, external edits, split editors, undo/redo, saved state, and extension restart.

### 12.4 Requirements-to-tests traceability

| Requirement group | Unit | Integration | End-to-end | Security corpus | Manual review |
| --- | --- | --- | --- | --- | --- |
| SEC-001–006 network and URLs | URL policy and settings | CSP/trust configurations | request interception and navigation | all hostile URL variants | OS link interstitials |
| SEC-010–016 filesystem | canonical containment and names | real filesystem and symlinks | paste/drop and vault escape attempts | traversal and race fixtures | platform trash behavior |
| SEC-020–026 messages/webview | schema and limit tests | forged host messages | CSP and editor behavior | message-fuzz corpus | CSP review |
| SEC-030–038 renderers | sanitizer/parser tests | bounded renderer host | rendered hostile fixtures | Mermaid/XML/YAML/CSS corpus | visual error states |
| SEC-040–045 trust/supply chain | manifest validation | trusted/untrusted runs | command availability | dependency fixtures where applicable | security sign-off |
| VLT-001–036 Document Vault | resolver and rewrite tests | filesystem transactions | tree and drag/drop flows | path corpus | recovery and usability |
| EDT-001–034 editor parity | parser/widget tests | document synchronization | editing journeys | malformed syntax corpus | Obsidian comparison |
| KNW-001–016 navigation | index/query tests | watchers and dirty docs | search/navigation journeys | regex and scale corpus | result relevance |
| PERF-001–006 performance | microbenchmarks | 10k fixture | responsiveness | pathological inputs | benchmark report |
| A11Y-001–007 accessibility | semantic assertions | keybinding contexts | automated scans | n/a | keyboard/screen reader |

## 13. Delivery phases and definitions of done

### Phase 0 Security gate

Deliver URL and network policy, path confinement, runtime schemas, CSP tightening, renderer sanitization, resource limits, Workspace Trust, security automation, malicious fixtures, and `SECURITY.md`.

**Done:** all Phase 0 exit criteria in section 6.5 pass. No later-phase feature ships without this release.

### Phase 1 Document Vault

Deliver the native tree, safe filesystem operations, automatic transactional link rewriting, attachments, watchers, exclusions, settings, and vault-level tests.

**Done for the macOS developer preview:** every `VLT-*` requirement passes on macOS; link updates are one-step undoable; no operation escapes the vault; and external filesystem changes converge without restart. Hosted Windows and Linux automation must stay green, while manual support qualification for those platforms is deferred to Phase 4.

### Phase 2 Editor parity

Deliver wikilinks and completion, safe embeds, typed properties, callouts, math, footnotes, tasks, tags, expanded table controls, and regression coverage.

**Done:** every `EDT-*` requirement passes; representative Obsidian-authored notes remain plain Markdown and render with documented compatibility; malformed content remains editable and safe.

### Phase 3 Knowledge navigation

Deliver the incremental index, Quick Switcher, vault search, aliases, backlinks, unlinked mentions, tags, hover preview, recent notes, and performance fixtures.

**Done:** every `KNW-*` and `PERF-*` requirement passes; index deletion and rebuild are lossless to user content; search and navigation function without network access.

### Phase 4 Release quality

Finish localization, accessibility, migration notes, user and contributor documentation, Marketplace metadata, release packaging, security review, and manual Windows/Linux support qualification in addition to the macOS preview evidence.

**Done:** every `A11Y-*` requirement passes; all supported locales have complete source strings; the production VSIX reproduces the tested behavior; and no critical or high release-blocking issue remains.

## 14. Release policy and success measures

### 14.1 Release blockers

Any of the following blocks release:

- Content-triggered code or command execution.
- Unsolicited network access under default settings.
- Read or write outside the canonical vault root.
- Partial rename/move transactions that leave broken files or links.
- Unresolved critical or high dependency, static-analysis, secret, or accessibility finding.
- Loss of user text, broken undo/redo, or divergence between the webview and `TextDocument`.
- Failure of trusted or Restricted Mode test suites.
- Failure to meet a published performance gate without an approved PRD amendment.

### 14.2 Product success measures

- Zero confirmed security escapes from the malicious Markdown corpus.
- Zero extension-generated network requests during the default end-to-end suite.
- All rename and move fixtures preserve link validity or report a fully rolled-back failure.
- Existing v0.2.0 editor behaviors pass without regression.
- At least 95 percent of the documented core Obsidian syntax fixture set renders and edits as specified; intentional differences are listed in compatibility documentation.
- All performance and accessibility gates pass on the documented release matrix.

Metrics are produced locally by CI and test fixtures. They are not collected from users.

## 15. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Mermaid or another renderer has a future sanitizer bypass | Code execution or data exposure | Strict mode, output sanitizer, CSP, limits, pinned lockfile, dependency alerts, hostile fixtures |
| Link rewriting corrupts Markdown | Data loss | Parser ranges, minimal edits, dirty-document support, one transaction, rollback, undo, extensive fixtures |
| Symlinks or encoding bypass containment | Filesystem escape | Canonical real-path service, deny symlink traversal, platform-specific tests |
| Large vault indexing harms editor responsiveness | Poor usability | Incremental batches, cancellation, exclusions, workers where supported, performance gates |
| CSS themes obscure trusted UI | Spoofing or unusable editor | Scope themes to content, reject dangerous constructs, keep controls outside theme root |
| Obsidian compatibility expands without limit | Roadmap failure | Hold to core editing and knowledge navigation; retain explicit non-goals |
| Restricted Mode diverges from trusted behavior | Hidden security regression | Separate integration configurations and shared policy service |
| Platform trash or case rules differ | Data loss or failed operations | Platform matrix, trash-only deletion, case-rename transaction, actionable errors |

## 16. Final product decisions

- The PRD is delivered as Markdown and lives in the repository.
- The initial vault is the sole local workspace folder.
- Remote HTTPS images are blocked by default and can be enabled per workspace.
- Links are updated automatically after rename and move without a confirmation prompt.
- Non-empty folder deletion requires confirmation and uses the operating-system trash.
- Security Phase 0 is mandatory before new vault or renderer features are released.
- Broad Obsidian cloning, cloud features, and executable plugin systems remain outside this roadmap.
