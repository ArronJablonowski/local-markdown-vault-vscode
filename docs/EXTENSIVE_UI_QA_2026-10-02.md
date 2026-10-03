# Extensive UI QA — October 2, 2026

## Scope and method

This session combines native macOS VS Code interaction, browser-based tests of
the real editor bundle, unit tests, and isolated extension-host checks. All
notes were synthetic and confined to disposable vaults and profiles. Personal
notes and settings were not used as test targets.

Native testing used mouse clicks, menus, keyboard navigation, character-by-character
typing, and the system clipboard. A passive helper compared complete editor
source with saved file bytes and repeated successful checks after a delay.
Browser tests additionally inspect selection ranges, generated host edits,
layout, focus, and rendering. They are not substitutes for native OS testing.

## Confirmed defects and changes

| Area | Reproduced defect | Correction |
| --- | --- | --- |
| Search in folded notes | Replacing a distant match inside nested collapsed callouts could split typed text across unrelated positions while background parsing completed. | Publish a bounded parsed tree before Find hands selection back to the editor, expand relevant fold state, and preserve search provenance as parsing advances; test the exact source and emitted host edits. |
| Find from rendered fields | Command/Ctrl+F did not open Find while editing a property or table field. | Commit the active draft, preserve invalid residual input, and focus the editor's Find panel. |
| Find All with a mouse | Clicking All over a rendered object could trigger incidental widget-click suppression and prevent selected source from being revealed. | Give explicit search selections precedence while preserving real mouse-drag behavior. |
| Property keyboard access | Space did not activate property buttons. | Implement native button-style Space activation without consuming spaces in the actual input. |
| Multiline properties | Opening and accepting a multiline scalar flattened its line breaks. | Use a bounded multiline input; Enter saves, Shift+Enter adds a line, and Escape cancels. |
| Unchanged property values | Null could become an empty string; browser-normalized line endings could alter an unchanged scalar. | Preserve the original typed value when the displayed input has not changed. |
| List properties | Editing one list item could flatten embedded line breaks in another. | Quote embedded CR/LF in the editable list representation. |
| Note creation | Quick Switcher offered invalid names that later failed creation. | Validate the raw name consistently before adding a Markdown extension. |
| Index readiness | Navigation could use an index before refresh completed or a now-excluded entry. | Await index readiness and revalidate indexed entries and exclusions around asynchronous path checks. |
| Rename | Extensionless files and dotfiles did not select the complete name. | Select the complete name unless there is an actual file extension. |
| Search wording | One result was labeled “1 matching documents.” | Use a singular result label and test zero, one, and multiple results. |

## Native workflows exercised

- Typed a new report from a blank note: headings, paragraphs, nested bullets,
  Tab/Shift+Tab, ordered lists, tasks, and a callout. Continued and exited lists
  using Enter; checked a task and observed strikethrough and saving.
- Opened, collapsed, and copied a ten-line code block; pasted its exact contents
  into another note. Exercised Mermaid and draw.io fit/reset/size controls and
  a footnote link.
- Created a folder and note, rejected an invalid trailing-space name, renamed
  and moved the note, then undid and redid the move. Verified file contents and
  destination paths. Searched for its unique content and opened the result.
- Copied an absolute path from the file menu and verified it in Quick Open.
  Opened the non-empty-folder trash confirmation and canceled it.
- Opened the settings panel and changed sticky headers in the disposable profile.
- Used Space to edit multiline and null properties; accepted unchanged values;
  appended a list item while preserving another item's embedded newline.
- Searched inside a 100-section note with nested folded callouts, replaced the
  match, then typed and re-drafted its footer. Exact saved bytes were verified.
- Locked that note and attempted Select All/Delete, typing, and native paste.
  The source and file remained unchanged. The native paste helper timed out
  because the locked editor did not consume the clipboard; this was not treated
  as evidence that paste ran.
- Opened and vertically scrolled a 60-row, 16-column table. Its complete 41,033-byte
  source remained unchanged. Native horizontal scroll attempts did not visibly
  move the table; browser geometry/scroll assertions provide the horizontal
  coverage, not those native attempts.

## Test fixtures and reproduction

`scripts/extensive-ui-fixtures.mjs` provides blank, mixed-object, property,
large-report, wide-table, nested-search, linked-note, and inert hostile-content
fixtures. The mixed note includes YAML, lists, tasks, callouts, tables with list
cells, code, Mermaid, draw.io, links, tags, footnotes, and math. The large report
repeats those combinations; browser regressions also use approximately 1 MB notes.

Start the isolated native destination after compiling:

```sh
MDLP_EXTENSIVE_UI=1 MDLP_HANDOFF_ARTIFACTS=extensive-native-ui node scripts/run-external-source-handoff-qa.mjs
```

The helper observes but does not operate the UI. Open fixtures and perform
interactions manually. Submit JSON lines with `action: "inspect"`, `"verify"`,
or `"finish"`; verification accepts exact source or its byte count and SHA256.
Only known synthetic fixture names are accepted. `finish` removes its temporary
vault/profile and preserves local reports.

## Evidence interpretation and limitations

Native reports retain failed expectations. Two property checks initially
expected unchanged YAML flow formatting, but the existing serializer adds flow
spacing and converts edited arrays to block form. Inspection confirmed the
values were preserved; corrected exact-source checks passed. These are test
expectation corrections, not silently discarded product failures.

Native app/palette loading is asynchronous. Attempts made before the editor
or picker had focus were repeated after observing the actual focused control.
Normal Copy actions replaced the system clipboard; its original contents were
not restored. No personal VS Code window was forcibly reloaded.

The first full browser run passed 877 cases and failed a test setup assertion
that required parsing to remain unfinished after Find. The search fix now
deliberately advances parsing. That test now navigates without
Find and release a controlled background parse during an actual mouse drag,
so its original safety coverage is retained rather than removed. The five
strengthened pending-parser gesture cases subsequently passed 50 repeated checks.

Stress testing also exposed rare character transposition and first-character
loss. An independent vanilla CodeMirror control, without extension plugins,
Markdown parser, or host bridge, reproduced these behaviors. Installed
`@codemirror/view` 6.43.4 produced nine persistent, length-preserving
transpositions in 1,000 zero-delay rounds; a standard HTML textarea control
produced none in 1,000 rounds. A 5 ms/key CodeMirror control also failed once
in 200 rounds. Testing newer 6.43.13 separately produced two transpositions and
one missing-initial-character result in 200 rounds. Dependencies were not
upgraded: the newer version is not a demonstrated solution.

This is an unresolved typing-integrity risk, not a proven automation-only
artifact and not a claimed fix. No such loss appeared in the native CUA
workflows, but that does not establish safety for all typing patterns. The
final folded-note fix passed 198 of 200 stress rounds; the two failures were
length-preserving transpositions also seen in the vanilla control. The earlier
severe multi-position callout corruption did not recur in those rounds.
Do not call this extension fully free of data-loss risk based on this session.

Native Linux/Windows, actual ChatGPT-app copying, exhaustive screen-reader
testing, and every possible Markdown combination are not covered by this
session. Passing tests cannot guarantee the absence of defects or data loss.

Reproduce the independent typing controls without loading the extension:

```sh
node scripts/run-vanilla-typing-control.mjs --rounds 200 --delay 0
```

This runs headless CodeMirror and HTML textarea controls with synthetic text.
The textarea does not include CodeMirror's Find-panel handoff, so it is a
comparison, not proof of which underlying component is responsible. Every
mismatch receives a 500 ms settling check, and exact expected/actual text is
saved under `.vscode-test/typing-control`. A clean run is not proof of absence.
Optional `--markdown` and `--view-package` flags permit isolated comparisons
without changing the project's dependencies. The reusable script passed a
20-round smoke check per control; earlier larger runs supply the risk evidence.

## Verification status

- Final complete unit run: 1,893 tests passed across 140 files. An earlier run
  under concurrent browser stress missed the 200 ms search-performance gate
  at 282 ms; the later complete run passed. No performance threshold was relaxed.
- Final complete browser run: all 878 non-native-clipboard cases passed. Five
  OS-clipboard cases were excluded to avoid interference with native app testing.
- All 87 focused controls checks passed, including 55 newly added workflows.
- All 24 new editor cases passed. Megabyte-note immediate edits and mouse Find
  All passed 200 repeated checks; separate folded-note stress failures are
  disclosed above rather than hidden in these totals.
- The minified production bundle passed 158 repeated new browser workflows.
- Four final native production checks passed with exact source/disk comparisons,
  delayed rechecks, and no page/editor errors: multiline Shift+Enter/Find draft
  handoff, subsequent body replacement, nested folded-note replacement, and
  distant-search footer typing.
- Native save durability: all 20 integration cases passed again against the
  production bundle, including denied
  filesystem writes and recovery-storage exhaustion.
- Native vault search: 13 integration cases passed. Vault move history: 21
  integration cases passed.
- Source/test type checks, repository language check, and dependency policy passed.
- Dependency audit reported zero known vulnerabilities; unknown issues remain possible.
- Independent runtime review found no additional actionable security regression.
  A separate protected-CSS/multiline-draft/Find probe passed. No network access,
  permission, dependency, or HTML-import capability was added.
- Candidate packaging and archive verification passed: 64 archive entries,
  3,734,402 compressed bytes. Installed-package smoke testing passed all 16
  applicable checks across trusted, restricted, and disabled disposable profiles;
  profile-inapplicable cases are intentionally skipped.

Local evidence is retained under `.vscode-test/extensive-native-ui-*`,
`/tmp/mlp-extensive-*.log`, and browser test output directories. New regression
coverage is in `extensiveEditorQa.spec.ts`, `extensiveControlsQa.spec.ts`,
`VaultServiceNoteCreation.test.ts`, and `registerVaultCommands.test.ts`, with
additional targeted tests beside the changed implementation.

## Release decision

The fixes and regression tests are source changes, not a reliability sign-off.
The candidate archive at the repository root has SHA256
`f8fd029d4a97adaaccd8911de8cdb33e1090d395baebae147112df974f026e68`.
It was tested in disposable profiles only. The normal installed extension and
the published `releases/local-markdown-vault-0.2.0.vsix` were deliberately left
unchanged while the typing-integrity risk remains unresolved. The published
archive still has SHA256
`056e17780e9f2a2eb03a470e54a98dcf45b773aa1f983147bb8b9f8df2d35733`.

Release gate: isolate and address the remaining typing failure, retain the
adversarial reproduction, then repeat native editing and package regression
checks before updating the normal installation or published archive.
