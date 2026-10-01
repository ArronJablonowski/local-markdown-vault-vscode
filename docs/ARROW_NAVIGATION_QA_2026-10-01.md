# Large Markdown Arrow Navigation QA

This review tests keyboard navigation in Markdown Live Preview using disposable
local notes and isolated VS Code profiles. It fixes a reproducible offscreen
caret during large-note rendering and two startup line-navigation races.
Personal notes and their settings were not used or modified.

## Method and coverage

The macOS journey uses real VS Code keyboard and mouse input, not programmatic
selection changes. It traverses headings, wrapped nested lists, tasks, tables,
fenced and indented code, Mermaid flow and entity diagrams, draw.io diagrams,
expanded and collapsed callouts, math, footnotes, and links. It checks both
vertical directions, horizontal movement through source boundaries, Shift
selection, word and line shortcuts, page movement, long code lines, and
document edges. Find positions the cursor near each object; subsequent
navigation uses individual keypresses. Read-only probes record caret geometry,
focus, selection, and source.

Three macOS notes contain 150,121, 600,082, and 1,800,130 bytes, respectively,
with up to 123,847 lines. Navigation focuses on mixed-object regions and
document boundaries; it does not visit every line of every file. Complete
editor text and saved-file hashes are checked to ensure navigation does not
modify Markdown.

Linux testing uses the DGX Spark's installed ARM64 VS Code under Xvfb, reached
through a loopback-only SSH tunnel. Only the synthetic workspace is trusted.
The tests do not disable the Electron sandbox, change AppArmor, or install
system dependencies. The Linux corpus includes local images, Unicode, quotes,
lists, diagrams, code, math, and tables. An installed-build baseline exercises
all four arrow directions; release verification adds full-caret geometry,
selection, word, page, and document-edge checks on notes up to 1.8 MB.

## Fixes

### Keep the keyboard destination visible during rendering

The initial macOS run passed 73 of 75 checks but reproduced two persistent
failures in the 600 KB note. After arrow or page movement, the caret stayed
hundreds of pixels above or below the viewport while preview layout settled.
Both failures preserved the complete document. Browser tests independently
reproduced offscreen destinations near tables and nested callouts after a
completed rendering frame and an additional settling interval.

A bounded scroll safeguard now keeps the latest keyboard destination visible
while layout settles. It only dispatches a nearest-scroll effect: it never
changes text or selection. It expires after one second and permits at most
eight corrections per navigation key. Typing, edits, composition, pointer
input, manual scrolling, focus loss, hidden tabs, and disposal cancel it.
Embedded table, property, and search controls retain their own key handling.

### Preserve the newest startup line jump

A queued line jump could replay after a newer jump had already been delivered.
Another startup path could deliver a jump after the webview announced readiness
but before it received the initial document, causing the jump to be discarded.
The host now retains only the newest pending destination and waits until the
initial document has been sent. Regressions cover busy save queues, immediate
jumps, hidden panels, and webview reloads.

## Measurement and test corrections

Linux Shift+Down checks initially reported a clipped endpoint where selected
source text meets a rendered callout widget. Inspection of the browser's actual
selection endpoint proved it was visible. The default coordinate query measured
the next widget's box instead. That discrepancy also made the new safeguard
perform unnecessary correction attempts.

The safeguard now uses the same inward side of a nonempty selection for both
measurement and scrolling. Empty cursors retain their explicit side, with the
public coordinate API's default when unspecified. Tests measure that same
endpoint and retain native DOM-range evidence. Full-caret bounds were not
relaxed. This was not a new text-loss or clipped-selection defect.

The broad browser suite also exposed a preexisting test-harness race. Its
simulated host sent Undo offsets before acknowledging the last typed batch.
The renderer correctly preserved the draft and requested resynchronization.
The test now controls acknowledgments and verifies both the successful Undo
path and the deliberately unacknowledged-update safety path. Both scenarios
passed ten repetitions. Runtime save handling was not loosened to satisfy
the test.

One release-candidate Linux run passed 68 of 69 checks: a time-only sample at
150 milliseconds reported an offscreen caret near a callout, but the following
screenshot already showed it inside the viewport. A focused repeat passed all
three checks. The harness now retains that raw sample and also checks after a
completed rendering frame. The final full run passed all 69 checks, including
every raw sample. A separate 1.8 MB check inspected the painted DOM cursor
before making any CodeMirror coordinate query, then again after 200 and 500
milliseconds. The cursor stayed visible without probe-triggered measurement
or manual scrolling. This did not confirm an additional persistent display
defect; it is not a guarantee that every rendering update completes in 150
milliseconds. The original failure evidence remains available locally.

## Final verification

The release package passed the following checks on October 1, 2026.

| Check | Result |
| --- | --- |
| Native macOS navigation, VS Code 1.139.1 | 81 checks; 3,392 key commands, 156 pointer actions, and 2,558 navigation samples |
| Native Linux ARM64 navigation, VS Code 1.140.0 | 69 checks; 747 key commands, including 513 arrow commands, and 504 caret samples |
| Linux DOM-first callout and document-edge repeat | 2 checks; 41 arrow commands and 38 caret samples |
| Unit tests | 1,686 tests across 130 files |
| Browser regression tests | 686 standard tests and 5 real-clipboard tests |
| Native save-durability tests | 20 tests |
| Packaged extension smoke tests | 16 tests across trusted, restricted, and disabled scenarios |
| TypeScript, package validation, dependency policy, US English checks | Passed |
| npm dependency audit | No reported vulnerabilities |

All final native navigation checks preserved complete editor text and saved-file
hashes. Neither platform reported a page exception. The Linux workbench logged
one bundled GitHub Copilot API-proposal mismatch per run; it was not an exception
from Local Markdown Vault. An earlier installed-build Linux baseline separately
passed 135 checks with 7,011 arrow commands; it is not counted as final-release
coverage.

Local evidence directories under `.vscode-test/`:

- `arrow-navigation-release-2026-10-01/`: final macOS report and screenshots.
- `linux-arrow-ui-final-frame/`: final Linux report and screenshots.
- `linux-arrow-ui-dom-proof/`: passive DOM-first confirmation.
- `linux-arrow-ui-final/`: retained 68-of-69 time-only sample investigation.
- `linux-arrow-ui-final-recovery/`: focused repeat using the original timing check.
- `arrow-release-browser/` and `arrow-release-clipboard/`: browser test artifacts.

These generated artifacts are local QA evidence, not files shipped in the
extension. The reproducible runners and regression tests are committed.

The verified archive is `releases/local-markdown-vault-0.2.0.vsix`, with SHA-256
`fd311387c8b27246f4660ef51b8fca636c49322e5719266be0ead2c06bbbd6d8`.
It contains 64 archive files, including 62 extension payload files. Version
0.2.0 is retained, so the checksum identifies this particular build.

The same archive was installed in the normal macOS and DGX Spark VS Code
profiles. All 62 installed payload files were verified against the archive on
each system; only VS Code's added package metadata was excluded from comparison.
No personal windows were reloaded and no user settings were changed during
installation. Save open work and run **Developer: Reload Window** in VS Code to
activate the new build in an already-open window.

## Reproduce the checks

Run `npm run test:ui:arrow-navigation` for the native macOS journey.
`MDLP_QA_VSCODE_VERSION` selects a test VS Code version, and
`MDLP_ARROW_ARTIFACTS` selects a report directory under `.vscode-test/`.
The default test version is 1.139.1.

`scripts/run-linux-arrow-qa.mjs` requires explicit `MDLP_LINUX_QA_HOST`,
`MDLP_LINUX_QA_KEY`, and `MDLP_LINUX_QA_EXTENSION` values. The extension path
must point to an authorized staged copy on the Linux host. The runner requires
installed VS Code, Xvfb, D-Bus, SSH access, and a local Playwright runtime.
Its optional artifact, size, and direction settings support focused reruns.
`MDLP_LINUX_QA_DOM_FIRST=1` checks painted cursor geometry across passive frames
before querying CodeMirror coordinates.
Do not point these tests at a personal vault.

Browser regressions are in `test/e2e/objectArrowNavigationQa.spec.ts` and
`test/e2e/immediateSave.spec.ts`. Unit coverage includes the scroll safeguard,
host jump ordering, and locked, selected, or multicursor code boundaries.

## Limits

These checks cover the tested builds and synthetic documents, not every
possible Markdown document or hardware configuration. The Linux session is
real desktop VS Code under a virtual display, not a physical-monitor review.
Windows, assistive-technology interaction, and arbitrary third-party CSS themes
were not manually reviewed in this campaign. No zero-bug or zero-data-loss
guarantee is implied.
