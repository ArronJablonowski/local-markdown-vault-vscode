# Dependency security updates and regression QA — October 22, 2026

## Findings and disposition

GitHub reported five open alerts (three high, two moderate). A fresh full npm
audit reported 15 affected dependency entries, including downstream packages
counted through the same vulnerable chain. This is not 15 independent exploits.

| Finding or chain | Disposition |
| --- | --- |
| markdown-it multiline reference and inline HTML denial of service | Removed with the upgrade from `@vscode/vsce` 3.9.2 to 4.0.0; its new Markdown packaging parser replaces markdown-it. Live Preview does not use this packaging parser. |
| Vite/launch-editor Windows escaping, existence bypass, editor-argument handling, development-server file access and middleware issues | Vite 8.3.0 → 8.3.5 through the updated test stack. |
| Vitest manual mock registration injection and Windows path traversal | Vitest, mocker, and coverage 4.1.11 → 4.1.12. |
| braces nested-pattern exhaustion through secretlint/globby/fast-glob/micromatch | Removed by the VSCE 4 packaging upgrade. |
| source-map-js indexed-offset event-loop exhaustion | 1.2.1 → 1.2.2. |
| KaTeX inherited-option trust bypass in Mermaid's nested dependency | Scoped Mermaid override replaces 0.16.47 with the already-used direct KaTeX 0.18.7. All copies are patched. Existing SVG sanitization, strict Mermaid mode, and resource limits remain intact. |
| http-cache-semantics shared-cache disclosure | Removed from the graph by updating the optional XML validator's node-gyp to 13.1.0, which no longer uses make-fetch-happen. |

The `http-cache-semantics` 4.3.0 upgrade cleared npm's advisory range, but a direct
check still returned reusable shared responses containing Set-Cookie, a
proxy-revalidate directive, or a private directive when requested with
max-stale. It was not accepted as a sufficient fix. Our previous path was only
SBOM tooling → libxmljs2 → node-gyp → make-fetch-happen (which configured a private
cache), not the installed extension; the entire affected chain is now absent.

Mermaid 12 was evaluated but not retained: a scoped KaTeX correction keeps the
existing renderer and avoids unrelated layout and dependency/license changes.
Its strict SVG-only labels still display literal math syntax rather than
enabling foreignObject HTML; dark/light regression screenshots confirm that
existing fallback remains readable. Ordinary Markdown math uses patched KaTeX.

## Supply-chain controls

- Manifest/lockfile consistency, npm HTTPS sources, SHA-512 integrity, production
  license checks, and exact install-script approvals remain enforced.
- VSCE's reviewed signing helper moves from 2.0.9 to 2.1.0. The removed keytar
  install-script approval is retired. All dependency lifecycle scripts remain
  disabled; no signing-helper fallback downloads were executed.
- Development requires Node.js 24.15.0 or newer; CI already selects Node 24 LTS.
  This does not change the installed extension's VS Code requirement.
- New regressions check every locked copy of patched test/math packages, ensure
  removed vulnerable chains stay absent, and exercise hostile inherited KaTeX
  options without polluting global prototypes.
- Full and production-only npm audits report zero findings. A new reproducible,
  validated production CycloneDX JSON SBOM is generated locally and excluded
  from the installable package as before.
- CI/release audit now fails at low severity and above, rather than accepting
  low/moderate findings while blocking only high/critical findings.

## Regression evidence and limitations

- Type checking and all 2,093 unit tests passed.
- Full browser regression run: 1,168 passed. Two additional dark/light Mermaid
  literal-math fallback checks passed separately.
- Native VS Code integration: 99 passed, 19 profile-inapplicable cases pending.
  Restricted-mode checks: four passed. Vault move/history checks: 25 passed.
- Native save-durability run using normal keyboard close: all 20 passed,
  including rapid switches, immediate reopen, table/property drafts, permissions
  failures, external changes, Unicode/BOM/CRLF, and full recovery storage.
- Native Mac UI: 32 checks passed across approximately 110 KB, 260 KB, and 470 KB
  notes; 3,174 individually typed characters, 423 key actions, and 47 pointer
  actions. Includes table/source editing, fold/unfold, diagrams, light/dark
  palettes, copy/paste, Undo/Redo, and exact disk comparisons.
- Desktop automation must run sequentially: overlapping native Mac workbenches
  competed for keyboard focus. Those contaminated runs are not counted as
  product regressions or passing evidence. The large-redraft runner was also
  corrected to expect literal bold delimiters in table source and the requested
  four-space bullet indentation.
- The strict out-of-band host-API close test still reproduces a pre-existing
  cross-channel race: immediately closing an invalid property draft can destroy
  the webview before its last recovery message arrives. It is not fixed by these
  dependency updates. Normal keyboard-close recovery passed. Do not infer a
  guarantee against arbitrary external close commands, forced termination, or
  power loss. The packaged editor and host bundles remain byte-identical to the
  preceding release; the lazy Mermaid bundle changes to include patched KaTeX.

Primary advisories: [markdown-it](https://github.com/markdown-it/markdown-it/security/advisories/GHSA-gfr2-rv44-r23c),
[Vite/launch-editor](https://github.com/vitejs/launch-editor/security/advisories/GHSA-587h-7wmj-h5pm),
[KaTeX](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7), and
[HTTP cache semantics](https://github.com/kornelski/http-cache-semantics/issues/56).

## Final package and additional runs

- A clean Node 24.19.0 `npm ci --ignore-scripts` succeeded, followed by all 2,093
  unit tests, type checking, policy checks, production packaging, validated SBOM
  generation, and zero findings in full and production-only audits. Gitleaks
  found no secrets in the staged changes. US English verification passed.
- The final 1,170-case production-bundle browser run had 1,169 passes and one
  intermittent large sticky-table alignment timeout. Both editing and locked
  large-table variants passed on focused rerun. The preceding 1,168-case full
  run passed completely; the two added literal-math cases also passed.
- Final VSIX smoke checks passed on rerun: 10 trusted, five restricted, and one
  extension-disabled checks. One earlier run failed to open VS Code's built-in
  Markdown Preview; the rerun covered that same sticky-header check successfully.
- Ubuntu's long private-desktop run exercised 57 workflows: 53 passed, with four
  navigation/clipboard/tab-close timeouts. Focused production-package reruns
  passed all four previously timed-out paths, plus the two other mixed-callout
  variants. The 120 KB list's immediate close/reopen passed on its isolated run
  without a close retry or Save confirmation; every final byte was checked.
  No change was made to the product's close/save behavior. This is not evidence
  that long-session timing issues can never recur.
- Ubuntu coverage includes approximately 2 MB callout pastes, 120/300/450 KB mixed
  notes edited at top/middle/bottom, external GTK clipboard data, lock protection,
  table/list/code drafts, and Unicode file/folder creation, rename, and move.
- Artifacts remain local under `.vscode-test/large-redraft-ui`,
  `.vscode-test/noc-security-dependencies-2026-10-22`,
  `.vscode-test/noc-security-dependencies-focused-2026-10-22`, and
  `.vscode-test/noc-security-close-confirmation-2026-10-22`. Ubuntu used the
  authorized NOC host in a private X11 desktop; this is not Wayland certification.
- The VSIX is installed on Mac and Ubuntu NOC. Installed Mermaid bundle SHA-256
  matches the tested production build on both systems:
  `264ae0960219838f508b5bfb7ccb0697991119e21665c46c4f6df6a289847d52`.
  Release VSIX SHA-256:
  `c529d088e30a6980a1f2a358f48129b66f06d901bc91dd243cee6ba9d1b634ac`.
  Existing personal windows were not forcibly reloaded.
- GitHub's dependency graph initially continued to return the preceding
  markdown-it 14.3.2 / Vite 8.3.0 / HTTP cache 4.2.0 snapshot after the push.
  Alerts were not manually dismissed. The committed lockfile and clean installs
  contain none of those vulnerable versions/removed paths.
