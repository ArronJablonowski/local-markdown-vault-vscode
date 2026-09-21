# Active Security Assessment — 2026-09-21

## Executive summary

The extension source and rebuilt `local-markdown-vault-0.2.0.vsix` were assessed on macOS using disposable VS Code profiles, disposable vaults, outside-vault canaries, the checked-in malicious Markdown corpus, forged protocol messages, symlink and traversal probes, and browser request observation.

Two low-severity weaknesses were confirmed and fixed:

1. First-run default-vault creation accepted a pre-positioned symlink named `~/Documents/Markdown Vault` and could open its target as the workspace.
2. Link validation accepted literal or percent-encoded Unicode bidirectional formatting controls that could disguise a destination in user-facing link confirmation or operating-system UI.

No critical or high-severity vulnerability was reproduced. After remediation, the automated active assessment found no script execution, unsolicited extension-managed request, unsafe command activation, outside-vault file disclosure, outside-vault mutation, unbounded protocol queue, or active raw-HTML/SVG payload.

This result is evidence for the tested build and threat model, not a guarantee that the extension is vulnerability-free. Version `0.2.0` remains pre-release software until the release checklist, including manual VoiceOver review, is complete.

## Scope and environment

- Platform: macOS on Apple silicon
- VS Code under test: `1.138.0`
- Source baseline: commit `5cb6c9b99abd1eddc3575ea307520cc0ab6c8421`
- Extension package: rebuilt locally from the assessed source
- Package identity: `arronjablonowski.local-markdown-vault` version `0.2.0`
- Vault model: one local `file:` workspace folder

The browser and extension-host tests used fresh temporary profiles, isolated extension directories, and disposable vaults. Trusted, untrusted/Restricted Mode, and extension-disabled states were tested independently. The macOS desktop integration used adjacent canary files and observed webview requests while opening hostile notes. Tests that launch Chromium or VS Code required macOS process services unavailable inside the outer filesystem sandbox, but their application data and test vaults remained disposable and isolated from the user's normal VS Code profile and vault.

The assessment covered extension-owned behavior. VS Code itself logged GitHub account-session resolution attempts in clean profiles; those messages came from VS Code's built-in agent host, not this extension. A `url.parse()` deprecation warning likewise originated in VS Code/test-runner processes, and no production extension source uses that API.

## Attack surfaces exercised

- Markdown raw HTML, dangerous URL schemes, tracking pixels, malformed links, and bidi controls
- Mermaid directives, edge/resource limits, hostile label markup, and hostile generated SVG
- draw.io XML DTD/entity declarations, external references, scripts, events, and `foreignObject`
- YAML alias cycles, nesting, malformed syntax, and oversized embed collections
- Custom CSS imports, external URLs, nested-selector scope escapes, and control-obscuring rules
- Host/webview message discriminators, offsets, lengths, versions, IDs, MIME types, base64, response substitution, and queue flooding
- Local links, images, attachments, file URIs, percent-encoded traversal, and symlink escapes
- Vault create, open, rename, move, trash, attachment, rollback, undo, and external-change boundaries
- Workspace changes, stale vault generations, Restricted Mode, and extension-disabled behavior
- Packaged VSIX contents and behavior rather than source-only modules
- Runtime and development dependency advisories and deterministic lockfile policy

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

An authored external or local link could contain Unicode bidi formatting controls, including percent-encoded forms. The existing scheme and control-character validation still prevented direct command or `javascript:` execution, but a malicious note could use visual reordering to make a destination appear different in confirmation or shell UI. Exploitation required the user to activate the link.

Link classification now rejects Arabic Letter Mark, left/right marks, embedding/override controls, and isolate controls in both literal and decoded input before a link can reach anchor navigation, vault resolution, or the operating-system opener. Regression tests cover HTTPS, `mailto:`, and local-note forms.

## Verification results

| Gate | Result |
| --- | --- |
| Focused security and boundary tests | 82 passed |
| Deterministic unit/component suite | 920 passed across 84 files |
| Browser end-to-end suite | 94 passed |
| Full VS Code extension-host integration | 73 passed; 18 platform/mode-specific tests skipped as designed |
| Focused macOS desktop transactions | 9 passed |
| Installed VSIX clean-profile matrix | Passed in trusted, Restricted Mode, and extension-disabled profiles |
| Package policy | Passed; 57 files verified |
| Dependency policy | Passed; 797 locked packages, 182 production packages, 5 reviewed disabled install-script packages |
| npm runtime dependency audit | 0 known vulnerabilities |
| npm complete dependency audit | 0 known vulnerabilities |

The browser and macOS desktop gates explicitly observed HTTP(S) traffic generated while hostile Markdown was open. No extension-originated request escaped the expected harness resources with remote media disabled. The outside-vault canaries remained unread and unchanged.

## Residual risk and release conditions

- A malicious process already running as the same macOS user generally has authority beyond what a VS Code extension can defend against. The default-vault fix prevents the identified pre-positioned leaf-symlink case but is not an operating-system sandbox.
- Explicitly enabling remote HTTPS images permits the expected privacy leak to the selected image host. The setting is workspace-scoped, off by default, and still does not enable arbitrary CSS, diagram, or extension-host networking.
- Opening an external HTTPS, HTTP, or email link remains a user-authorized handoff to the operating system. HTTP requires an additional warning; unknown and privileged schemes remain blocked.
- VS Code and Electron are part of the trusted computing base. Their built-in network activity and vulnerabilities are outside the extension's direct control.
- Automated accessibility checks passed, but manual macOS VoiceOver review remains required before production release.
- Dependency advisories and static-analysis results are time-sensitive and must be rerun for every release and lockfile change.

## Reproduction commands

From a clean checkout using Node.js 24 LTS:

```bash
npm run security:dependencies
npm ci --ignore-scripts
npm run test:deterministic
npm run test:e2e
npm run test:integration
npm run test:integration:focused:macos
npm run package
npm run test:vsix
npm audit --omit=dev --audit-level=low
npm audit --audit-level=low
```

Tests that launch VS Code or Chromium need permission to use normal macOS application and IPC services. All profiles and vault fixtures created by the runners are temporary and are removed after the run.
