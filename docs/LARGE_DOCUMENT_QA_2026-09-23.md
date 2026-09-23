# Large mixed-document QA - September 23, 2026

## Corpus and scope

The deterministic generator in `test/fixtures/largeMixedDocument.ts` creates
three disposable notes with 80, 240, and 600 mixed-content sections:

| Sections | UTF-8 bytes | Lines |
| --- | ---: | ---: |
| 80 | 329,055 | 5,857 |
| 240 | 985,501 | 17,510 |
| 600 | 2,463,673 | 43,758 |

Content combines YAML properties, headings, emphasis, highlights, escaped syntax,
inline code, math, currency, emoji, local and reference links, wikilinks, tags,
footnotes, nested tasks/lists, nested callouts with tables, wide tables, long code
blocks, Mermaid flowcharts, and draw.io XML. No personal notes are changed.

## Defect fixed

Find and Replace previously updated their query on keyup or focus change only.
Input without keyup, including mouse-pasted text, left the first Enter using the
previous query. The search panel now commits input immediately while retaining
case, whole-word, and regular-expression options. Regression tests cover both
find and replacement text and jumping across large notes.

## Interaction checks

- Browser tests use the shipped editor bundle and stylesheet, real keyboard
  events, mouse wheel scrolling, clicks, and mouse drag selection.
- All three sizes are searched at beginning, middle, and end, then edited at the
  end. A separate approximately 1 MB note is scrolled repeatedly through mixed
  widgets, with asynchronous diagram rendering checked before scrolling away.
- Nested callouts are folded/reopened; a callout table cell is edited; a long
  code block is folded, expanded, and copied with its final hidden line intact.
  Mouse-selected prose is deleted and the host undo request is checked.
- Isolated macOS VS Code tests use actual local files and the system clipboard.
  They search to the end, copy selected text, type, verify the entire saved file,
  and undo back to the exact original bytes. The previous clipboard is restored.
  Each fixture is closed before moving to the next file size.
- Screenshots are captured in the browser test output. Unit, browser, packaged
  extension, type-check, and US English checks are also run.

## Limits

Final results: 1,025 unit tests, 422 browser tests, and 15 packaged-extension
checks passed. The final native scenario passed twice consecutively across all
three sizes. One earlier native repetition stalled waiting for an undo change;
the two diagnostic reruns did not reproduce it. This remains an intermittent
observation, not a confirmed fixed defect. The test retains detailed failure
diagnostics for future runs. Native undo can require several steps for one burst
of typing because the host owns the undo stack.

This is sampled large-document interaction coverage, not inspection of every
rendered line or every combination of Markdown. The largest file is approximately
2.5 MB, below the 20 MiB security limit. No security limits were relaxed. Native
testing was on macOS; Windows/Linux and power-loss recovery were not tested.
Browser host stubs cannot prove clipboard writes or disk persistence; those
checks are performed separately in VS Code. Autosave remains asynchronous.
