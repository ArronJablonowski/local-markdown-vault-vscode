# External App Paste QA

## Findings and fixes

Native macOS testing reproduced four independent paste failures:

1. Ordinary Command+V reached Live Preview but Electron did not dispatch a
   paste event. Native Edit → Paste and Command+Shift+V worked as controls.
   Trusted paste shortcuts now invoke the native command synchronously while
   the selection is current. Observing a delivered event prevents a second
   default paste, even when a guarded handler cancels that event.
2. Large Markdown reports starting with comma-containing text were mistaken
   for oversized spreadsheets. Optional plain-text conversion now falls back
   to the original text at grid limits, including output-expansion limits.
   Explicit CSV/TSV and rendered table-cell limits remain enforced.
3. An advertised but empty text clipboard field could erase selected text in
   an unfinished table-cell edit. It now leaves the draft and selection intact.
4. After unlocking, focus could remain on the Lock/Edit button. Paste could
   succeed, but the next typed space locked the document again and subsequent
   typing never reached the note. Explicit unlock now focuses the editor at
   its retained selection. Locking retains accessible button focus; background
   updates and recovery-blocked states do not steal focus.

## Native source coverage

All content was synthetic. Tests used a disposable VS Code profile and vault,
not personal notes. Real clicks, keyboard shortcuts, and native menu actions
were performed through the computer-use interface. The helper observed editor
state and compared complete source and saved bytes without driving the UI or
reading the system clipboard.

| Actual source | Content and interaction |
| --- | --- |
| TextEdit | Formatted text, Unicode, emoji, multiple lines; actual Select All/Copy; ordinary paste, repeated paste, paste-as-text, immediate typing |
| Chrome | Markdown Copy button, rendered rich-text selection, and a 331,120-byte report containing 4,300 paragraphs |
| Firefox | Code Copy button, tab-indented code pasted inside a fence, and a copied TSV selection pasted into an existing table |
| Safari | Markdown Copy button; ordinary Command+V; locked paste; unlock, paste, and immediate leading-space typing |
| VS Code Text Editor | Actual source selection and Copy, then native Edit → Paste into Live Preview |

The local source page includes a representative chatbot-style Copy button,
but this is **not an actual ChatGPT app test**. The computer-use tool explicitly
denied access to the app exposed as ChatGPT (`com.openai.codex`). That restriction
was not bypassed. A user-provided failing ChatGPT clipboard example is still
valuable. Excel, Word, native Linux, and native Windows were not exercised in
this session; CSV/TSV, HTML+text, image+text, and other MIME combinations were
covered by browser regression fixtures rather than claimed as those apps.

## Verification

- 1,827 unit tests passed across 138 files.
- 324 focused browser checks passed: 108 cases repeated three times.
- All 799 non-native browser tests passed. Five OS-clipboard browser tests were
  excluded so they could not compete with the real-app clipboard session.
- The final native development pass completed seven exact source-and-disk
  checks, including a delayed recheck for duplicate/replayed paste. Earlier
  candidate passes also exercised rich text, code fences, and table pastes.
- Source/test type checks, script syntax, repository language verification,
  dependency lockfile policy, and dependency audit passed. The audit reported
  zero known vulnerabilities; this is not a guarantee against unknown issues.
- Independent runtime review found no additional actionable security or
  data-loss issue; 230 related unit checks passed.

The changes add no dependency, network access, clipboard permission, or HTML
import. Existing locked-document, image, document-size, and host-message
validation remain active. Browser simulations verify absent, empty, malformed,
oversized, and mixed clipboard representations; they do not replace native
platform testing.

## Reproduction and evidence

Use `test/fixtures/external-copy-sources.html` in a local browser and copy from
its buttons, rendered text, code, and TSV field. Run the isolated destination:

```sh
npm run compile
node scripts/run-external-source-handoff-qa.mjs
```

The helper accepts one JSON object per line with `action`: `fixture`, `inspect`,
`verify`, or `finish`. `verify` requires exact `expected` source, `unchanged: true`,
or both `expectedSha256` and `expectedBytes`. Open the fixture through the UI;
the helper does not choose a file or paste for you. `finish` closes its own
test process and removes its temporary vault/profile. Evidence remains local.
Normal native Copy actions replace the clipboard; this session did not restore
the original clipboard contents.

Regression tests are in `externalPasteAdversarialQa.spec.ts`,
`externalPasteTargetsQa.spec.ts`, `spreadsheetPaste.spec.ts`,
`clipboardShortcuts.test.ts`, and `spreadsheetAutoProse.test.ts`.

Local evidence includes:

- `.vscode-test/external-app-final-2026-10-02/report.json`
- `.vscode-test/external-app-verified-2026-10-02/report.json`
- `.vscode-test/external-app-candidate-2026-10-02/report.json`
- `.vscode-test/external-app-baseline-2026-10-02/report.json`
- `/tmp/external-paste-unlock-fixed.log`
- `/tmp/external-paste-unlock-full-browser.log`
- `/tmp/mdlp-external-app-final-units.log`

Earlier reports are retained, not overwritten with passing results. One rich
selection expectation omitted the blank line supplied by Chrome and was
corrected after inspecting the actual source. Another session received an
incorrect helper command (`command` instead of `action`). Those are test-driver
errors, not extension failures. The initial helper also selected a stale hidden
webview; it now binds observations to the requested fixture and retains that
binding. Earlier ambiguous observations are not used as proof of a fix.
