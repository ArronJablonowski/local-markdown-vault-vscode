# Contributing to Local Markdown Vault

Local Markdown Vault is a local-only VS Code extension. Contributions must
preserve ordinary Markdown files, the single-workspace-folder vault boundary,
and the security guarantees in [SECURITY.md](SECURITY.md). Start with the
[product requirements](docs/PRODUCT_REQUIREMENTS.md) and record user-visible
changes in [CHANGELOG.md](CHANGELOG.md).

## Development setup

Use Node.js 24 LTS. With `nvm`, the checked-in version marker selects it:

```bash
nvm use
npm run security:dependencies
npm ci --ignore-scripts
npm run compile
```

The dependency-policy check runs before installation. Do not remove
`--ignore-scripts`: builds, tests, and packaging are intentionally proven
without dependency lifecycle scripts.

Open the repository in VS Code, press `F5`, and choose **VS Code Extension
Development**. In the new window, open exactly one local folder and then open a
Markdown file with **Markdown Live Preview**.

## Architecture boundaries

- `src/vault/VaultService.ts` is the filesystem authority. New reads and
  mutations must pass lexical, canonical, symlink, identity, and Workspace
  Trust checks there rather than using an ad hoc filesystem call.
- `src/vault/VaultIndex.ts` owns rebuildable local metadata. Markdown remains
  authoritative; never persist note bodies, frontmatter values, credentials,
  embeddings, or remote identifiers in the index.
- `src/vault/LinkRewriteService.ts` plans atomic rename/move and link edits.
  Preserve dirty documents, optimistic-concurrency checks, rollback, and
  one-step undo behavior.
- `src/shared/messages.ts` and the runtime validators define the privileged
  webview boundary. Treat every received object as hostile and reject unknown
  fields, stale versions, oversized values, and malformed identifiers.
- `src/webview-editor/diagramSecurity.ts` is the final SVG boundary for Mermaid
  and draw.io. Renderer output is untrusted even when its source was parsed.
- Webviews may load only packaged resources allowed by their CSP and
  `localResourceRoots`. Do not add telemetry, analytics, update checks, remote
  configuration, accounts, sync, or background networking.

## Required checks

Run the narrowest relevant tests while developing, then run the complete local
gate before requesting review:

```bash
npm run typecheck
npm test
npm run compile
npm run test:e2e
npm run test:integration
npm run test:integration:restricted
npm run security:audit
npm run package
npm run test:vsix
```

Reference-machine performance runs and the Windows/macOS/Linux hosted matrix
are described in [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md). Do not
weaken a security or performance budget to make a test pass.

Every behavior change should include a test at the lowest useful layer:

- unit tests for parsers, limits, path rules, link rewriting, and validators;
- extension-host tests for filesystem operations, trust, and VS Code APIs;
- Playwright tests for rendered behavior, keyboard access, CSP, and network
  silence; and
- a malicious-corpus fixture when the change closes a content-driven security
  issue.

Malicious fixtures must be inert data. Never execute a proof of concept outside
the isolated test harness or include real credentials, private vault content,
live tracking hosts, or weaponized payloads that are unnecessary to prove the
boundary.

## Pull requests and commits

Keep changes scoped, preserve unrelated work, and explain the user-visible
outcome and security impact. A pull request should include:

- the PRD requirement or bug being addressed;
- tests run and any intentionally skipped platform/manual checks;
- migration or compatibility impact for existing Markdown and `.obsidian/`;
- dependency and license changes, if any; and
- screenshots only when they clarify a visual change and contain no private
  note content.

Use signed or otherwise attributable commits when available. Never commit SSH
keys, tokens, generated SBOMs, local profiles, benchmark vaults, or VSIX files.
Back up completed, passing increments to the configured GitHub remote rather
than accumulating a large unreviewable change.

## Security reports

Do not open a public issue for a suspected vulnerability. Follow the private
reporting process in [SECURITY.md](SECURITY.md).
