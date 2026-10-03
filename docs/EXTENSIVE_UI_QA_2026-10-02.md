# Extensive UI QA — October 2, 2026

## Meeting notes and arrow navigation follow-up

The follow-up session tested realistic note-taking with individual native keys,
corrections, and repeated arrow navigation in an isolated macOS VS Code window.
It found two editing defects: a line-start hashtag became a heading, and Enter
after highlighted text discarded the surrounding list or quote structure.

The heading helper now preserves single-hash tags and literal hashes in code,
HTML, and YAML. Level-one headings require the normal explicit space (`# Title`);
level-two through level-six convenience spacing remains available in prose.
Composition input is left to the input method, and uncertain parser context
does not trigger automatic formatting.

The highlight Enter handler now preserves the surrounding bullet, task,
numbered list, or quote while leaving the inline highlight. Pressing Enter
again on an empty item still exits that section. Review also found that a
partially parsed large document could make the handler mistake literal code
for a highlight; a bounded context check addresses that case.

### Native meeting workflow

A blank note grew to 2,987 UTF-8 bytes through individual key events, including
headings, paragraphs, nested bullets, numbered items, tasks, a warning callout,
a table, a Python code block, highlighted decisions, tags, and emoji completion.
The test used Backspace for corrections, Tab and Shift+Tab for indentation,
mouse clicks for focus and task completion, and Command+B on an arrow-selected
word. Markdown was not pasted into this note.

Arrow navigation moved into earlier paragraphs, across the table boundary,
through code lines, and back into quoted tasks. Shift+Arrow selected exact
words for replacement, including `Friday` to `Monday`, `notes` to `steps`,
`owner` to `lead`, and `date` to `deadline`. Highlight delimiters remained
intact. Repeated Enter left the code block and continued ordinary prose.

The complete intended source matched both the editor and saved file, including
delayed rechecks. The initial 2,798-byte draft also survived an isolated window
reload unchanged. No personal window was reloaded. The final meeting-note
fingerprint was SHA256
`83557deae0402f8da71727ef3843fc64ec06fbbd9f380f67893b927c1ef724e2`.

### Layout and interaction coverage

New browser regressions exercise individual typing, corrections, emoji
completion, line-start tags, literal code and YAML hashes, and highlight Enter
with the caret both before and after the closing delimiter. Large mixed notes
contain repeated tables, diagrams, callouts, code, and lists.

The layout cases test Arial at 16 px, Georgia at 22 px, and monospace at 14 px
in 820 px, 390 px, and 600 px panes. They inspect eight post-paint frames after
edits, comparing document selection, native selection, visible caret position,
and the host edit stream. Arrow-heavy cases repeatedly cross callouts, tables,
and code in both directions. Wrapped-list checks make 12 Up/Down round trips
and 168 lateral key movements before selecting and replacing a known word.

Native drag attempts did not produce a usable selection through the automation
tool. This is not claimed as a confirmed product failure or successful native
drag coverage. Separate browser mouse drags selected the exact intended phrase
in paragraphs, bullets, and nested bullets before and after focus. The native
key driver also mapped its `equal` key name to `+`; highlight tests used a
single-character native text event for `=` instead. Actual operating-system
IME composition, native Linux/Windows, and every possible transient frame are
not covered by this session.

Native Undo restored the exact source after highlighted-list continuation,
but placed the caret after the closing highlight marker rather than at its
prior position before it. This is a remaining UX limitation: the host Undo
response carries text changes without historical selection metadata. The
helper now commits one transaction and its local CodeMirror history test
restores the original caret, but that is not proof of native host-history
caret restoration. Broader selection-history support remains follow-up work.

The native helper now accepts `MDLP_HANDOFF_TRACE=0` to disable extra input
listeners during timing-sensitive QA; observation and source/disk verification
remain available. This session used that untraced mode. Local native evidence
is under `.vscode-test/meeting-notes-native-2026-10-02`.

### Follow-up verification results

- The complete unit suite passed all 1,944 tests across 142 files, including
  the vault performance gates.
- All 943 non-native-clipboard browser cases passed, including 41 new meeting
  workflows and the additional literal-hashtag typing case. Five OS-clipboard
  cases were excluded to avoid interfering with native note-taking.
- The final focused heading and highlight unit run passed all 51 tests,
  including composition bypass, cold-parser context, readonly behavior,
  rejected edits, retained annotations and effects, and local Undo selection.
- All five exact native source/disk checks passed with delayed rechecks.
- The minified production bundle passed all 123 repeated meeting-note browser
  checks and all 20 save-durability integration cases.
- Source and test type checks, US English verification, and dependency policy
  passed. The production dependency audit reported zero known vulnerabilities.
  Development-only advisories from the earlier session remain documented below.
- Packaging and archive verification passed with 64 entries and 3,735,244
  compressed bytes. The release VSIX fingerprint is SHA256
  `52c839961df760d42cd979e0d105df81db44b88c7ee438634845d593a52b402a`.
- Installed-package smoke testing passed all 16 applicable checks across
  trusted, restricted, and disabled profiles. Profile-inapplicable cases were
  skipped intentionally. The VSIX was installed into the normal local VS Code
  extension directory; existing personal windows were not forcibly reloaded.

## Scope and method

This session combines native macOS VS Code interaction, browser-based tests of
the real editor bundle, unit tests, and isolated extension-host checks. All
notes were synthetic and confined to disposable vaults and profiles. Personal
notes and settings were not used as test targets.

The follow-up investigation below addresses the typing-integrity problem that
blocked the initial release. Initial findings and failures are retained as
evidence, not presented as results from the corrected build.

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
Find and releases a controlled background parse during an actual mouse drag,
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

This was an unresolved typing-integrity risk at the initial release gate, not
a proven automation-only artifact. No such loss appeared in the initial native
CUA workflows, but that does not establish safety for all typing patterns. The
initial folded-note fix passed 198 of 200 stress rounds; the two failures were
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

## Initial verification results

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
- The initial dependency audit reported zero known vulnerabilities. The
  follow-up audit below includes newly published development-tool advisories.
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

## Typing integrity follow-up

The initial release was held at source commit `4a6d563`. The follow-up found
a concrete cause for transposition in the installed CodeMirror version:
`DOMObserver.onScroll` calls `flush(false)` while newly typed DOM text is
pending, without refreshing its cached native selection. The insertion can
then be dispatched with the caret still before the inserted character.

Four failure-only traces captured this stack. In one, `v` was inserted at
offset 17182 and the actual native caret advanced to 17183, but the transaction
kept 17182. Later keystrokes produced `Revised aluev` instead of `Revised value`.
An independent uninstrumented baseline failed 20 times in 1,500 Find-handoff
rounds; direct-selection control passed 1,000 rounds. The separate missing-first-
character symptom was reproduced, but its own causal stack was not captured.
Adding even empty input-event listeners suppressed reproduction, so instrumented
clean runs are not used as evidence that the fault disappeared.

`typingIntegrity.ts` avoids this native insertion/reconciliation race for
ordinary physical-key typing. A trusted single-character keydown must be
followed by matching trusted, cancelable `insertText` on the focused editor
body. The character is committed through the ordered input-handler chain and
a normal multiple-selection transaction before native DOM insertion. Existing
pairing, selection, size/recovery/lock filters, host saves, and history remain
in force. No private CodeMirror APIs or dependency patches are used.

Modified keys, dead keys, composition, noncancelable input, replacement,
paste, and text committed without a matching physical key keep the native
path. Nested property/table fields and Find inputs are excluded. Synthetic
composition checks only verify bypass behavior; they are not native IME
certification. No new network, filesystem, clipboard, or HTML permissions
were introduced.

### Follow-up results

- The isolated proposed guard passed 2,000 zero-delay and 400 five-millisecond
  typing rounds, with 4,800 exact source comparisons.
- The actual shipped guard passed 1,000 uninstrumented control rounds with
  no transient or persistent mismatches; the accompanying textarea control
  also passed 1,000 rounds. Run the comparison with:

  ```sh
  node scripts/run-vanilla-typing-control.mjs --guarded --rounds 1000
  ```

- The full extension passed 1,000 repeated large-note folded-callout workflows,
  checking source, host edits, distant footer typing, deletion, and replacement.
- All 1,893 unit tests and all 901 non-native-clipboard browser tests passed.
  This includes 23 new typing regressions. One initial test expectation was
  corrected because the YAML serializer correctly retained double quotes.
- The minified production bundle passed all 141 repeated typing and extensive
  editor checks (47 cases repeated three times).
- Seven native macOS checks passed with exact source/disk comparisons: physical
  keys replacing a folded match, footer typing after Find, locked deletion and
  typing, headings/nested bullets, Unicode clipboard paste, Undo, and Redo.
- All 20 save-durability integration cases passed, including failed writes,
  rapid switching, unfinished drafts, delayed saves, and full recovery storage.
- Type checks, US English verification, dependency policy, and archive safety
  verification passed. Local follow-up evidence is in
  `.vscode-test/typing-integrity-native-2026-10-02`,
  `.vscode-test/typing-control`, and `/tmp/mdlp-typing-*.log`.

### Development dependency findings

The follow-up production-only audit reports zero findings. The full audit
reports 12 high-severity entries propagated from two development-only packages:
[braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and
[http-cache-semantics](https://github.com/advisories/GHSA-ch52-4w7c-c8xp).
Both advisories were updated October 2 and list no patched version.

These dependencies are not shipped in the VSIX. The installed extension does
not expose their affected functions to Markdown. The normal packaging path
uses explicit secret-scanning filenames rather than the affected CLI globbing
chain; the cache dependency comes through optional XML-validator build tools.
Install scripts remain disabled in repository guidance and CI. These are
development-tool risks, not a clean full-audit result. No findings or audit
gates were suppressed. A future packaging-tool migration needs separate
compatibility testing; a forced major upgrade/downgrade was not applied as an
unrelated part of the typing fix.

## Updated release decision

The typing fix and earlier QA corrections are included in the rebuilt
`releases/local-markdown-vault-0.2.0.vsix`, SHA256
`8eb8b0e32c2d608c2ece1fb0e41bf6f987bb1e9e46bd851949108f74cb5f12d7`.
Archive verification passed for 64 entries. The package was installed in the
normal macOS VS Code application; all 62 extension payload files match the
archive, allowing only VS Code's added package metadata. No personal window
was forcibly reloaded. Already-open windows need **Developer: Reload Window**
to activate updated code.

Installed-package checks passed all 16 applicable tests across trusted,
restricted, and disabled disposable profiles on an unchanged rerun. The first
run could not find the expected built-in preview table; the empty diagnostic
did not distinguish a different followed document from a missing or unfinished
preview. This failure is retained rather than counted as a pass. The fixed-
fixture test now pins its built-in preview and reports observed headings and
table counts on failure; rendering assertions remain unchanged. All 16
applicable installed-package checks passed again with this pinned setup.

The observed ordinary-typing failure no longer reproduced in the corrected
stress or native checks. This is not a guarantee against every form of data
loss. Native Linux/Windows and real IME sessions were not certified in this
follow-up; the development-tool audit findings remain disclosed above.
