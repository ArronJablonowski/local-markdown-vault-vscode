# Full Security Assessment — 2026-09-21

## Executive summary

The extension source and rebuilt `local-markdown-vault-0.2.0.vsix` were assessed on macOS using code review, dependency and secret scanning, disposable VS Code profiles, disposable vaults, outside-vault canaries, the checked-in malicious Markdown corpus, forged protocol messages, symlink and traversal probes, resource-limit tests, and browser request observation.

Four low-severity weaknesses were confirmed during the security-hardening work and are fixed:

1. First-run default-vault creation accepted a pre-positioned symlink named `~/Documents/Markdown Vault` and could open its target as the workspace.
2. Link validation accepted literal or percent-encoded Unicode bidirectional formatting controls that could disguise a destination in user-facing link confirmation or operating-system UI.
3. The repository language-verification gate followed symbolic links and did not limit the size of files it read. This affected a CI/build-time defense and was not reachable through Markdown opened by the installed extension.
4. Obsidian-style `==highlight==` rendering could scan and create an unbounded number of decorations on one permitted-size visible line, allowing a malicious note to cause excessive rendering work.

No critical, high, or medium vulnerability was reproduced. Automated active testing found no script execution, unsolicited extension-managed request, unsafe command activation, outside-vault file disclosure, outside-vault mutation, unbounded protocol queue, or active raw-HTML/SVG payload. The new autosave path was tested with burst edits and an outside-vault symlink canary; it saved the ordinary vault note once and did not modify the symlink target.

This result is evidence for the tested build and threat model, not a guarantee that the extension is vulnerability-free. Version `0.2.0` remains pre-release software until the release checklist, including manual VoiceOver review, is complete.

## Scope and environment

- Platform: macOS on Apple silicon
- VS Code under test: `1.138.0`
- Reviewed runtime baseline: commit `870691d0eef736f617f85aeb5511a4d3d66b5fad`
- Extension package: rebuilt locally from the assessed source
- Package identity: `arronjablonowski.local-markdown-vault` version `0.2.0`
- Vault model: one local `file:` workspace folder

The browser and extension-host tests used fresh temporary profiles, isolated extension directories, and disposable vaults. Trusted, untrusted/Restricted Mode, and extension-disabled states were tested independently. The macOS desktop integration used adjacent canary files and observed webview requests while opening hostile notes. The application data and test vaults remained isolated from the user's normal VS Code profile and vault.

The assessment covered extension-owned behavior. VS Code itself logged GitHub account-session resolution attempts in clean profiles; those messages came from VS Code's built-in agent host, not this extension. A `url.parse()` deprecation warning likewise originated in VS Code/test-runner processes, and no production extension source uses that API.

## Attack surfaces exercised

- Markdown raw HTML, dangerous URL schemes, tracking pixels, malformed links, and bidirectional controls
- Mermaid directives, edge/resource limits, hostile label markup, and hostile generated SVG
- draw.io XML DTD/entity declarations, external references, scripts, events, and `foreignObject`
- YAML alias cycles, nesting, malformed syntax, and oversized embed collections
- Custom CSS imports, external URLs, nested-selector scope escapes, and control-obscuring rules
- Host/webview message discriminators, offsets, lengths, versions, IDs, MIME types, base64, response substitution, and queue flooding
- Local links, images, attachments, file URIs, percent-encoded traversal, and symlink escapes
- Vault create, open, rename, move, trash, attachment, rollback, undo, and external-change boundaries
- Workspace changes, stale vault generations, Restricted Mode, and extension-disabled behavior
- Code paths involving HTML insertion, process creation, command execution, external URL opening, dynamic code execution, filesystem access, and network access
- Build and release scripts, including symbolic-link and oversized-file probes
- Packaged VSIX contents and behavior rather than source-only modules
- Runtime and development dependency advisories, secret history, SBOM generation, and deterministic lockfile policy
- Automatic-save lifecycle, edit coalescing, local-file restrictions, canonical workspace containment, symlink escape, and failed-save behavior
- Locked-mode transaction enforcement across typing, undo/redo, rendered controls, and image paste

## Findings and remediation

### LMV-2026-01 — Default-vault symlink redirection

**Severity before fix:** Low

**Status:** Fixed

First-run activation created `~/Documents/Markdown Vault` through the VS Code filesystem API and immediately opened that lexical path. If another local process had already created the leaf as a symlink, VS Code could open the symlink target as the vault. This required local filesystem access under the same user account and did not itself execute code or upload data, but it could expose an unintended directory to vault indexing and file-management actions.

The bootstrap now:

- creates the directory with owner-only requested permissions where the platform honors them;
- rejects a symbolic-link or non-directory leaf;
- records and compares the directory's device/inode identity across canonicalization;
- opens the verified canonical directory path; and
- fails closed with the existing warning if verification fails.

Regression tests cover a new directory, an existing ordinary directory, a pre-positioned directory symlink, and a non-directory collision.

### LMV-2026-02 — Bidirectional-control link spoofing

**Severity before fix:** Low

**Status:** Fixed

An authored external or local link could contain Unicode bidirectional formatting controls, including percent-encoded forms. The existing scheme and control-character validation still prevented direct command or `javascript:` execution, but a malicious note could use visual reordering to make a destination appear different in confirmation or shell UI. Exploitation required the user to activate the link.

Link classification now rejects Arabic Letter Mark, left/right marks, embedding/override controls, and isolate controls in both literal and decoded input before a link can reach anchor navigation, vault resolution, or the operating-system opener. Regression tests cover HTTPS, `mailto:`, and local-note forms.

### LMV-2026-03 — Build-time scanner symbolic-link and file-size handling

**Severity before fix:** Low

**Status:** Fixed in `9b9e0ada43c52754eb9a301dfad13162cdcb8662`

The repository's US English verification script used metadata calls that followed symbolic links and read candidate text files without a size limit. A malicious or accidentally introduced repository entry could therefore make CI inspect a file outside the checkout or consume excessive memory. This was a build-pipeline availability and information-exposure concern; the script is not packaged as executable extension behavior and cannot be invoked by opening a Markdown file.

The verifier now uses link-aware metadata, rejects every symbolic link, and refuses files larger than 16 MiB before reading them. Its self-test creates both an outside-repository symbolic-link probe and an oversized-file probe, and requires both to fail safely.

### LMV-2026-04 — Unbounded inline-highlight decoration work

**Severity before fix:** Low

**Status:** Fixed in `870691d0eef736f617f85aeb5511a4d3d66b5fad`

A permitted-size Markdown line containing many thousands of `==…==` pairs could make the visible-range renderer scan the entire line and allocate a decoration for every pair. This was an availability issue confined to the editor webview; it did not enable script execution, network access, host command execution, or filesystem access.

Highlight scanning is now limited to 256 KiB per visible line and 512 highlight decorations per viewport. Custom task-marker detection and task-list lookahead are also bounded. Unit and browser tests exercise a hostile line and confirm that the editor remains available while the underlying Markdown remains intact.

## Security controls confirmed by review

- Webviews use `default-src 'none'`, cryptographic nonces, narrow source directives, and minimal `localResourceRoots`. The two `style-src 'unsafe-inline'` exceptions are documented and limited to CodeMirror and rendered preview styling.
- Host/webview messages are treated as untrusted data. Validators enforce exact keys, discriminators, identifiers, offsets, lengths, MIME types, canonical base64, payload byte limits, and bounded queues.
- Vault operations apply lexical containment and canonical filesystem containment. Symbolic links are resolved before sensitive access, and paths outside the active vault are rejected.
- Raw Markdown HTML remains inert. MathML and diagram SVG enter the DOM only after purpose-specific sanitization; generated draw.io SVG remains escaped.
- External links pass through a scheme allowlist. `javascript:`, `command:`, `data:`, unknown schemes, protocol-relative URLs, control characters, bidirectional controls, and absolute local paths are blocked. Plain HTTP requires explicit confirmation.
- Remote media is disabled by default and, when explicitly enabled per workspace, is restricted to HTTPS images. The extension has no account, telemetry, analytics, synchronization, background upload, or general-purpose network client.
- Custom CSS rejects imports, external URLs, dangerous at-rules, scope escapes, and rules capable of hiding or impersonating extension controls.
- Restricted Mode preserves plain Markdown editing while disabling diagrams, custom CSS, remote media, attachment mutation, and vault-wide mutations.
- Autosave has no webview-supplied path parameter. It can call VS Code's native save only for an already-open, dirty, size-limited Markdown document in the single local workspace vault after canonical containment succeeds. Timers are coalesced per document, shared across split views, canceled when the final view closes, and never retried in an unbounded loop.
- Locked mode rejects document-changing CodeMirror transactions, including changes requested by rendered task, property, and table controls. Image-paste and host undo/redo requests are independently suppressed while locked. Host-originated document updates remain visible.
- No `eval`, `new Function`, dynamic script creation, or production child-process execution was found. The sole packaged network fetch is the pinned AWS language-shapes data required by syntax highlighting and is governed by package integrity evidence and webview CSP.

## Verification results

| Gate | Result |
| --- | --- |
| Focused security and boundary tests | Passed as part of the complete and browser suites |
| Complete unit/component/performance suite | 921 passed across 86 files |
| Coverage measurement | 60.36% lines; 63.90% branches |
| Browser end-to-end suite | 114 passed |
| Full VS Code extension-host integration | 76 passed; 18 platform/mode-specific tests skipped as designed |
| Cache restart integration | Seed and recovery phases passed |
| Restricted Mode integration | 4 passed |
| Focused macOS desktop transactions | 9 passed |
| 10,000-item filesystem performance gate | Passed; cold index under 0.82 seconds, incremental update under 0.17 seconds in this run |
| Installed VSIX clean-profile matrix | Trusted: 9 passed; Restricted Mode: 5 passed; disabled extension: 1 passed; remaining cases skipped by design |
| Package policy | Passed; 59 files verified |
| Dependency policy | Passed; 797 locked packages, 182 production packages, 5 reviewed disabled install-script packages |
| npm runtime dependency audit | 0 known vulnerabilities |
| npm complete dependency audit | 0 known vulnerabilities |
| CycloneDX SBOM | Generated and validated |
| Repository secret scan | 219 commits scanned; no leak found |
| GitHub CodeQL, dependency, and secret alerts | 0 open alerts at the prior pushed baseline; exact-baseline workflows must pass after this update is pushed |

GitHub's prior-baseline [CI](https://github.com/ArronJablonowski/local-markdown-vault-vscode/actions/runs/35629522954), [CodeQL](https://github.com/ArronJablonowski/local-markdown-vault-vscode/actions/runs/35629522931), and [secret-scanning](https://github.com/ArronJablonowski/local-markdown-vault-vscode/actions/runs/35629523060) workflows completed successfully. The pushed update is not release-ready until its own workflows also complete successfully.

The browser and macOS desktop gates explicitly observed HTTP(S) traffic generated while hostile Markdown was open. No extension-originated request escaped the expected harness resources with remote media disabled. The outside-vault canaries remained unread and unchanged.

## Residual risk and release conditions

- A malicious process already running as the same macOS user generally has authority beyond what a VS Code extension can defend against. The default-vault fix prevents the identified pre-positioned leaf-symlink case but is not an operating-system sandbox.
- Explicitly enabling remote HTTPS images permits the expected privacy leak to the selected image host. The setting is workspace-scoped, off by default, and still does not enable arbitrary CSS, diagram, or extension-host networking.
- Opening an external HTTPS, HTTP, or email link remains a user-authorized handoff to the operating system. HTTP requires an additional warning; unknown and privileged schemes remain blocked.
- VS Code and Electron are part of the trusted computing base. Their built-in network activity and vulnerabilities are outside the extension's direct control.
- Test coverage supports the review but does not prove the absence of defects. Security-sensitive paths receive focused adversarial tests beyond the reported aggregate coverage.
- Automated accessibility checks passed, but manual macOS VoiceOver review remains required before production release.
- Dependency advisories, static analysis, and secret-scanning results are time-sensitive and must be rerun for every release and lockfile change.

## Reproduction commands

From a clean checkout using Node.js 24 LTS:

```bash
npm run security:dependencies
npm ci --ignore-scripts
npm run language:verify
npm run test:coverage
npm run test:e2e
npm run test:integration
npm run test:integration:cache-restart
npm run test:integration:restricted
npm run test:integration:focused:macos
npm run test:performance:filesystem
npm run package
npm run test:vsix
npm run security:sbom
npm audit --omit=dev --audit-level=low
npm audit --audit-level=low
gitleaks git --redact --no-banner
```

Tests that launch VS Code or Chromium need permission to use normal macOS application and IPC services. All profiles and vault fixtures created by the runners are temporary and are removed after the run.
