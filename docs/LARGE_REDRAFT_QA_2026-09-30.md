# Large-note editing QA — September 30, 2026

## Scope and method

This campaign starts from `950b1fc` and targets Markdown Live Preview on macOS.
It combines source review, browser rendering regressions, and keyboard/mouse
workflows in isolated native VS Code profiles. Personal notes are not modified.

The native runner generates three synthetic notes containing 110,352 bytes /
2,018 lines, 260,216 bytes / 5,330 lines, and 470,208 bytes / 9,962 lines. Fixture
generation seeds the large documents; subsequent redrafts use individual typed
characters, keyboard shortcuts, clicks, mouse drags, and scroll gestures. DOM
and editor-state inspection is read-only. Major edit checkpoints compare the
entire saved Markdown with the expected text. The runner preserves the original
clipboard privately and uses synthetic clipboard contents during the test.

Objects include YAML properties, headings, Unicode and emoji, inline emphasis,
links, math, nested lists/tasks, nested and collapsed callouts, regular and wide
tables, code blocks, Mermaid flow/class/entity diagrams, and draw.io diagrams.
Mermaid entity diagrams exercise table-shaped records and their connections;
ordinary Markdown tables are tested separately. Browser scenarios also use
329–416 KB reports with 80–100 mixed sections and a 160-row, 12-column table.

The browser harness uses the production webview bundle and styles. Some tests
simulate host messages, clipboard payloads, or render failures explicitly; these
are not described as native user actions. Separate native journeys exercise the
actual VS Code shortcut and clipboard boundary that browser-only tests missed.

## Confirmed defects and fixes

| Defect | Correction and regression coverage |
| --- | --- |
| Large-note scrolling jumped when typing short styled lines or navigating to the final paragraph. | Prevent CodeMirror from using padded, styled short lines as its representative plain-text height. Cover short/long EOF paragraphs, headings, code, nested lists, repeated typing, and window resizing in default, Obsidian-style, and GitHub-style themes. Source text is unchanged. |
| A collapsed callout could expose its `>` prefix on an extra row. | Hide the prefix when skipping traversal of a collapsed body; test nested folding, unfolding, and header geometry. |
| Closing Find could remap the selected source into another rendered block. | Keep the selected source visible during the input-to-editor focus handoff. Cover immediate replacement after searching in a large note and exact surrounding text. |
| Find queries and immediate Select All replacements could lose their initial characters. | Focus Find synchronously, preserve input selection during panel rearrangement, and contain handled shortcuts so VS Code cannot replay them after typing starts. Apply the same immediate selection handling to source and property inputs. |
| Copy followed immediately by deletion could copy the changed selection instead of the original text. | Keep ordinary copy/cut/paste shortcuts inside the editor while allowing real browser clipboard events. Verify mouse selection, immediate deletion, cut, paste, Find/table inputs, and locked-mode protection. |
| Copied code or quoted prose could be refused as malformed CSV. | Treat malformed auto-detected plain text as untouched text. Explicit CSV/TSV still rejects malformed quoting; byte, row, column, cell, and output limits remain enforced. Cover TypeScript, JSON, Python, quoted prose, incomplete quoted data, and inert raw HTML. |
| An earlier spreadsheet error remained visible after successful ordinary paste. | Clear the obsolete warning when returning valid plain text to the ordinary paste handler, without creating an empty notification. |
| Existing Mermaid/draw.io diagrams kept obsolete colors after changing the VS Code light/dark theme. | Observe palette changes, serialize Mermaid configuration with rendering, discard stale results, and retain pan, zoom, and the selected draw.io page. Cover rapid theme changes and initially hidden documents. |
| Failed diagram redraws could leave an old shadow-root SVG covering the error. | Replace content in the same isolated root, expose the error, and clear error state on recovery. A deliberately failed redraw verifies visibility and successful retry. |

The native journeys also cover repeated paragraph rewrites, task clicks,
callout folding, editable cells and pipe escaping, table source reveal,
horizontal table scrolling, code copying/folding, typing a new diagram, and
escaping into an unrelated paragraph at EOF. Browser geometry tests cover
sticky headers, different column widths, vertical/horizontal alignment,
resizing, and light/dark diagram labels and connectors.

## Security checks

No CSP, filesystem permission, remote-resource permission, diagram limit, or
spreadsheet limit is relaxed. Raw clipboard HTML is not imported. Tests still
reject actual image URLs, event attributes, script execution, and unsolicited
requests. CodeMirror's source-less, `aria-hidden` caret-buffer images are not
mistaken for rendered user HTML.

Dependency maintenance updates DOMPurify to 3.4.16, development-only
brace-expansion to 2.1.7, and development-only markdown-it to 14.3.2. The
DOMPurify advisory requires particular in-place sanitization/hook conditions;
the reviewed application math path sanitizes a string and does not use
`IN_PLACE`. Updating the dependency is precautionary hardening, not evidence
that malicious execution occurred. See the maintainer advisories for
[DOMPurify](https://github.com/advisories/GHSA-p98j-92pf-mc4p),
[brace-expansion](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), and
[markdown-it](https://github.com/advisories/GHSA-253c-mchw-3w2r).

The advisory audit reports zero known vulnerabilities after these updates.
The lockfile policy check and reproducible production SBOM validation pass.

## Validation

Build and unit checks use Node.js 26.10.0. Native runs use isolated macOS
VS Code 1.140.0 profiles, with an additional full first-note journey on 1.139.1,
the version installed on the user's system. The user's application is not
upgraded and personal VS Code settings are not changed.

| Check | Result |
| --- | --- |
| Source and test TypeScript checks | Passed |
| Unit suite | 1,601 passed across 124 files |
| Complete browser suite | 602 passed; the five real-clipboard cases ran separately to prevent shared-clipboard interference |
| New three-note native redraft journey, VS Code 1.140.0 | 32 passed, 3,174 typed characters, 423 recorded key commands, 39 recorded pointer actions, 698 selection/geometry samples |
| Full first-note compatibility journey, VS Code 1.139.1 | 12 passed, 1,112 typed characters, 243 selection/geometry samples |
| General native integration | 99 passed; 19 dedicated-profile or platform-dependent cases pending in this runner |
| Focused native desktop interactions | 47 passed |
| Native save durability and recovery | 20 passed, including slow/denied writes and recovery-storage exhaustion |
| Restricted workspace | 4 passed in a genuinely untrusted profile |
| Packaged VSIX | 16 passed: 10 trusted, five restricted, one disabled |
| Dependency policy, advisory audit, production SBOM | Passed; zero known vulnerabilities reported |
| US English and whitespace checks | Passed |

All saved-text checkpoints in the new native journeys matched exactly. There
were no webview page errors. VS Code emitted unrelated built-in Copilot API
proposal warnings, retained in the diagnostic logs rather than hidden. Native
screenshots were inspected for EOF visibility, table layout, code controls,
and readable light/dark diagram palettes.

In total, 230 executed native checks passed. Native runners were serialized and
exited successfully. General-runner pending cases are dedicated-profile tests
or case-sensitive-filesystem tests; mode-inapplicable packaged cases are also
intentionally skipped. The macOS filesystem run does not certify the remaining
case-sensitive platform cases. Expected denied-write and rollback diagnostics
were generated by failure-injection tests, not ignored test failures.

Evidence stays local under `.vscode-test/large-redraft-1.140.0-final-2026-09-30/`
and `.vscode-test/large-redraft-1.139.1-final-2026-09-30/`. The reproducible native
runner is `scripts/run-large-redraft-ui-qa.mjs`, exposed by
`npm run test:ui:large-redraft`. Use `MDLP_QA_VSCODE_VERSION` to select a cached
test version and `MDLP_REDRAFT_FIRST_ONLY=1` for the first-note compatibility run.

Initial failures were retained as diagnostic evidence. Test-only corrections
include YAML formatter spacing, source-button selectors, expected blank-line
placement around a closing fence, native theme labels, and identification of
inert CodeMirror caret buffers. They are not counted as product fixes.

## Delivery

The refreshed `releases/local-markdown-vault-0.2.0.vsix` passed archive validation
with 64 files and was installed in the local VS Code app. All 62 installed
extension payload files match the tested archive, allowing only VS Code's
added installation metadata in `package.json`. Existing windows were not
forcibly reloaded. Save current work, then run **Developer: Reload Window** to
activate the update in an already-open window.

VSIX SHA-256:
`f461b16eabf7767aa628ced6ce914305225664d7256575f100cf75707cb0f7c0`

This report does not claim exhaustive coverage of every Markdown combination,
pixel-perfect Obsidian parity, live Windows/Linux certification, or a guarantee
against all future data loss. Exact disk comparisons validate the exercised
sequences, not every possible filesystem or application failure.
