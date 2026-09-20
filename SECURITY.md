# Security Policy

## Product security boundary

Local Markdown Vault is a local-only editor. It does not provide accounts, cloud sync, publishing, telemetry, analytics, background uploads, or an extension-managed network service.

Remote images are blocked by default. A user may opt a trusted workspace into HTTPS images, which can disclose the user's IP address and image URL to the remote server. HTTP images and all other remote-media protocols remain blocked.

Local Markdown images are resolved and read by the extension host, not by webview URL manipulation. The host decodes the authored path, confines it to the single local vault both lexically and after symlink resolution, verifies a regular file no larger than 20 MiB, checks that its bytes match the declared PNG, JPEG, GIF, WebP, or BMP signature, and rejects malformed dimensions, any side over 16,384 pixels, or canvases over 64 megapixels before sending bytes to a short-lived webview blob. The vault itself is not a webview resource root. Local SVG is deliberately blocked because SVG is an active document format; diagram-generated SVG follows a separate sanitizer before insertion.

Pasted and dropped attachments pass the same signature and dimension checks before a vault file is created. One operation accepts 1–32 raster files, with a 20 MiB decoded-size limit per file, a 40 MiB aggregate limit, stable input ordering, generated collision-avoiding names, and rollback if the batch cannot complete atomically. Each exclusive creation retains an opaque open-file lease until commit or rollback, so cleanup compares the live original handle to the path and cannot delete a replacement even when a filesystem immediately reuses identifiers.

Host-backed reads have independent limits in both processes: four concurrent local images, four draw.io files, and eight embedded notes per editor. Client requests expire after ten seconds, and reinitializing a document cancels stale client work, so a missing reply cannot permanently consume the queue. The extension host enforces the same concurrency ceilings even when a webview message is forged.

Messages crossing the host/webview boundary are parsed from `unknown` with exact-field schemas and type, range, byte, MIME, base64, path, and request-identifier checks. Edit messages are rejected when their base version is already stale and rechecked when their serialized operation executes. A checked-in protocol corpus exercises forged messages and a 4,096-attempt flood against the 64-operation privileged mutation queue.

Live Preview documents are limited to 20 MiB of UTF-8 text. The extension host checks the limit before enabling webview scripts; oversized files receive a script-free explanation and remain editable through VS Code's ordinary text editor.

Vault metadata indexing rejects notes larger than 2 MiB and aborts a note's metadata extraction after 250 milliseconds. YAML has its own smaller input, nesting, alias, and node limits. A note that exceeds a limit remains an ordinary editable file but is omitted from the rebuildable knowledge index.

Typed YAML properties require a mapping root and reject duplicate keys. Input bytes are capped before parser allocation; node accounting includes scalar values, mapping keys, and repeated alias expansions; circular aliases are rejected before values reach rendering or serialization.

The local, rebuildable metadata cache does not persist frontmatter values, task text, or body-derived search tokens. It retains bounded structural navigation data and is invalidated by vault identity, schema, exclusions, or extension version. Markdown files remain authoritative, and the complete in-memory index is reconstructed from them during startup.

Untrusted workspaces run in restricted mode. Diagram execution, custom CSS, attachment writes, draw.io file reads, and remote media are disabled until the workspace is trusted.

## Webview policy notes

Every executable script is a packaged extension resource authorized by a per-document nonce. The webview HTML contains no inline executable script. `default-src 'none'` is the baseline; HTTPS is added to `img-src` only for the explicit workspace remote-image opt-in.

The editor currently retains `style-src 'unsafe-inline'` because CodeMirror positions selections, widgets, panels, and measured content with runtime `style` attributes. This exception authorizes CSS only, not scripts. User themes are independently scoped to the document content, sanitized rule by rule after CSS escape decoding, stripped of network and control-obscuring constructs, and disabled in Restricted Mode. The extension reads and displays at most 1,000 theme files and applies at most 1 MiB of combined CSS; the sanitizer additionally caps input at 1 MiB, 10,000 rules, and 32 conditional-rule nesting levels. Unsafe rules are ignored with a protected, localized warning while safe sibling rules remain active; the same fail-closed policy applies to the document editor, theme cards, and the live CSS preview. Removing the style exception would require replacing or isolating CodeMirror's runtime positioning model and is tracked as defense-in-depth work rather than being silently omitted.

Malformed webview messages are rejected before dispatch. When local diagnostics are enabled, rejection categories and bounded reasons are recorded at most once per second per category; message payloads are never logged.

Host-delivered syntax-highlighting tokens are confined to their declared code block and may set only a hexadecimal foreground color plus the exact italic, bold, and underline values emitted by the bundled highlighter. Layout, visibility, URL-bearing, and arbitrary CSS declarations are rejected.

Sanitized Mermaid and draw.io SVG is inserted into a paint-contained shadow root rather than the editor DOM. Renderer styles therefore cannot select surrounding controls. Mermaid HTML labels are disabled and the setting is protected from document directives because Mermaid uses a temporary live DOM before returning SVG; this prevents hostile label markup from starting a request before post-render sanitization, including when HTTPS note images are enabled. SVG styles using `:host`, `:host-context`, `::slotted`, remote resources, font declarations, custom-property registration, or CSS animation are removed; URL-bearing attributes are checked after CSS escape decoding, active SVG elements are rejected, and root viewport dimensions are bounded before insertion.

## Supported versions

Security fixes are made on the current development branch and the latest Marketplace release. Older releases may not receive backports. Until the first security-hardened release is published, version `0.2.0` should be treated as development software rather than a security boundary for hostile Markdown.

## Reporting a vulnerability

Do not publish exploit details in a public issue. Use the repository's **Security → Advisories → New draft security advisory** flow to report the problem privately. Include:

- the affected version and operating system;
- the smallest Markdown, SVG, XML, CSS, or message payload that reproduces it;
- the security impact and whether user interaction is required;
- logs, screenshots, or a proof of concept with secrets removed; and
- any suggested mitigation.

If private vulnerability reporting is not enabled on the fork, open a public issue containing no exploit details and ask the repository owner for a private reporting channel. The repository owner must enable GitHub private vulnerability reporting before a public release.

Reports should be acknowledged within three business days. The maintainer will validate the report, assign severity, prepare a fix and regression test, and coordinate disclosure. Credit is offered unless the reporter asks to remain anonymous.

## Security release requirements

A security release must include a regression test, dependency and secret scans, a reviewed lockfile, a generated SBOM, and a concise advisory describing affected versions and mitigations. Public disclosure should occur only after a fixed package is available, unless active exploitation requires earlier warning.

## Local diagnostics

Diagnostics are disabled by default and are never uploaded. A user may enable
`mdLivePreview.diagnostics.enabled` and run **Show Local Diagnostics** to inspect
a local ring buffer capped at 500 entries and 64 KiB. The diagnostic API accepts
structured events only and redacts Markdown bodies, URLs, clipboard data,
credentials, absolute paths, and Error messages before storage. Disabling the
setting immediately clears the in-memory buffer and Output panel.
