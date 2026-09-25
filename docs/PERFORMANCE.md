# Performance Baseline

This file records local, reproducible performance evidence for the PRD gates. It is not telemetry and no result leaves the machine running the tests.

## Reference machine

- Apple Mac mini, Apple M4
- 24 GiB RAM
- SSD storage
- macOS/Darwin arm64
- Measured 2026-09-19 with the repository's pinned Node.js dependencies

## Automated microbenchmark

Run:

```sh
npx vitest run src/vault/vaultPerformance.test.ts --reporter=verbose
```

Fixture:

- 10,000 Markdown notes
- 130,000 wikilinks
- nested tags, aliases, headings, Unicode text, and 100 path groups
- representative indexed searches over the complete 10,000-record set

Five clean-process runs recorded on 2026-09-19:

| Run | Metadata parse/index | Incremental 320 KiB parse | Indexed-search p95 | Quick Switcher p95 |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 326.0 ms | 6.6 ms | 24.0 ms | 8.6 ms |
| 2 | 329.0 ms | 6.6 ms | 24.1 ms | 8.8 ms |
| 3 | 325.5 ms | 6.7 ms | 24.3 ms | 8.6 ms |
| 4 | 330.9 ms | 6.8 ms | 23.6 ms | 8.9 ms |
| 5 | 332.1 ms | 6.6 ms | 24.6 ms | 8.6 ms |

Aggregate p95 across the five clean processes:

| Measurement | Result | PRD budget |
| --- | ---: | ---: |
| Metadata parse/index CPU time | 332.1 ms | 3,000 ms |
| Incremental 320 KiB note parse | 6.8 ms | 500 ms |
| Warm indexed-search p95 | 24.6 ms | 200 ms |
| Fuzzy Quick Switcher p95 | 8.9 ms | 200 ms |

The automated test fails when these budgets are exceeded. It deliberately measures parser/index/search CPU behavior without persisting note bodies.

## Automated large-note viewport benchmark

Run:

```sh
npx playwright test test/e2e/performance.spec.ts --reporter=line
```

The test opens five fresh browser pages with a 1 MiB Markdown note, waits for
the CodeMirror viewport, verifies that it is editable and contains the first
heading, then types into it and waits for the bounded host edit message. Every
run independently enforces the **PERF-004** one-second first-viewport budget.
The ordinary local command above enables that budget by default. Shared GitHub
Actions runners set `LMV_PERFORMANCE_GATES=off`: they still perform all five
mount, editability, and host-message checks, but their variable wall-clock
timings are informational rather than release evidence.

Five independent fresh-page runs in the complete browser suite on 2026-09-19
completed in 277.1, 283.3, 283.9, 287.9, and 292.7 ms (292.7 ms p95 on the
reference machine). The five trials run serially so the one-second product
budget never measures five simultaneous 1 MiB editor mounts created by the
benchmark itself;
the rest of the browser suite remains fully parallel.

## Automated filesystem benchmark

Run:

```sh
npm run test:performance:filesystem
```

The opt-in runner creates an isolated local vault before VS Code starts, opens
it in a clean profile, and removes both afterward. The fixture has exactly
10,000 ordinary files and a 1 GiB logical footprint: 8,000 Markdown notes in
100 path groups plus 2,000 sparse binary attachments. Every note contains YAML,
Unicode text, tags, aliases, and 13 wikilinks. Five rebuild trials delete the
rebuildable metadata cache first. Incremental trials require both the metadata
index and the native tree provider to converge after each operation.

Latest five clean-cache runs recorded on 2026-09-20:

| Measurement | Samples (ms) | p95 | PRD budget |
| --- | --- | ---: | ---: |
| Cold filesystem index | 805.8, 800.0, 765.0, 764.8, 774.1 | 805.8 ms | 3000 ms |
| Create convergence | 99.7, 164.3, 164.0, 149.7, 170.8 | 170.8 ms | 500 ms |
| Edit convergence | 163.7, 156.2, 163.9, 161.9, 161.3 | 163.9 ms | 500 ms |
| Rename convergence | 166.7, 166.8, 162.1, 164.6, 164.9 | 166.8 ms | 500 ms |
| Delete convergence | 156.9, 154.7, 157.0, 157.4, 158.9 | 158.9 ms | 500 ms |

While a complete 8,000-note rebuild had deliberately cleared the atomic live
index, the same run typed into and saved an ordinary note in 144.6 ms. A 5 ms
probe recorded only 20.9 ms maximum event-loop delay during that interaction;
the saved bytes remained intact and the rebuild restored all 8,000 records.
The test independently fails at 500 ms interaction latency or 100 ms continuous
blocking. This closes the direct reference-machine evidence for **PERF-005**.

Together these results close the documented reference-machine evidence for
**PERF-001**, **PERF-002**, and **PERF-005**. The benchmark is deliberately excluded from ordinary shared CI:
hosted-runner contention cannot redefine the published performance baseline.

The latest isolated run also rewrote a fixture note to
exactly 1 MiB, waits for the incremental index to converge, and opens it in
Live Preview while a 5 ms event-loop probe records the longest scheduling
delay. The latest 2026-09-20 run recorded 16.6 ms; four earlier independent
clean-profile runs recorded 41.7, 31.9, 38.7, and 14.1 ms. Each is below
the **PERF-004** 100 ms continuous-blocking budget.
The scenario opens the large note before its small diagnostic control so the
measurement does not benefit from a pre-warmed editor.

## Runtime architecture

- Cold rebuilds use at most 16 concurrent file reads.
- Rebuilds yield to the extension-host event loop every 100 completed items.
- A newer rebuild or disposal cancels older work through a generation token.
- User-requested rebuilds also propagate a VS Code cancellation token through discovery and every bounded worker. Cancellation discards partial metadata rather than exposing an incomplete search or navigation snapshot.
- Open unsaved documents override disk text for incremental indexing and search context.
- Live and persisted index records retain bounded frontmatter property names only, with every arbitrary value replaced by `null`. Property-value filters verify candidates by parsing the same bounded authoritative note text on demand, so private YAML values are not retained in the metadata index.
- Search snippets read at most 50 ranked candidates on demand using eight workers; note content is discarded after the line, heading, and bounded snippet are produced.
- Individual indexed notes and on-demand search reads remain capped at 2 MiB.
- The complete in-memory index is capped at a conservative 128 MiB retained-data estimate. Crossing the limit clears partial knowledge metadata and disables indexing until a rebuild after exclusions or content are reduced; ordinary Markdown editing remains available.
- Metadata extraction has a 250 ms per-note deadline; notes that exceed it remain editable but are omitted from the rebuildable index.
- Up to 256 bounded exclusion globs are compiled once into an immutable matcher for each rebuild, tree listing, or link-rewrite scan instead of being reparsed for every discovered path.
- Retained editor panels stop document-tokenization timers while hidden. Background document edits are coalesced into one authoritative snapshot, and CSS or vault-summary updates are deferred until the panel is visible again.
- Vault-search generations are cancellable and serialized. Changing or closing the search picker prevents the obsolete generation from scheduling more note reads, while the eight-worker cap remains global to that picker instead of multiplying on every keystroke.
- Backlink and broken-link views use precomputed path, basename, and alias resolution maps and cooperatively yield while scanning large result sets. This removes activation-time quadratic link resolution from the extension host.
- Vault-note summaries cross the webview boundary in ordered, generation-scoped chunks of at most 100 records; incomplete, stale, oversized, or out-of-order generations are ignored.
- The rebuildable vault metadata cache is capped at 64 MiB on both read and write. Record-by-record UTF-8 accounting stops before consuming later metadata once the exact limit is crossed; serialized writes use unique temporary files and cleanup before atomic replacement. Oversized or structurally invalid caches are ignored and reconstructed from bounded note metadata rather than partially loaded. Its persisted form retains structural navigation data but replaces frontmatter values and task text, omits body-derived search tokens, and stores only the effective bounded exclusion snapshot; the startup rebuild restores the complete in-memory index from the authoritative Markdown files.
- Bulk rebuilds reconcile obsolete exact paths once, skip the incremental case-alias scan, and persist one coalesced snapshot. Incremental watcher updates retain exact-case reconciliation for case-insensitive filesystems.

## Hidden-panel idleness evidence

Run:

```sh
npx vscode-test --grep "defers syntax tokenization" --timeout 60000
```

The real extension-host scenario opens a Markdown file containing highlighted
code in Live Preview, covers the tab, edits its backing `TextDocument`, and
waits beyond the 150 ms highlighting debounce. The process-local tokenizer run
count remains unchanged while hidden and advances only after the Live Preview
tab is revealed. This verifies that hidden panels do not invoke host syntax
parsing for background edits. CSS and vault-summary notifications use the same
visibility gate.

Editable Live Preview panels retain their webview context while hidden. Native
spreadsheet-paste testing on September 25 reproduced a lost accepted edit when
VS Code destroyed a hidden iframe before its outgoing save messages arrived.
Retaining the context protects that transport and pending edit state; it costs
more memory per open editor. Close unused saved tabs or use the default reusable
tab to limit that cost. Style-preview panels still discard hidden contexts.
Retention does not replace save acknowledgments or make abrupt process failure
safe. See [spreadsheet paste QA](SPREADSHEET_PASTE_QA_2026-09-25.md).

## Remaining release evidence

The reference machine now has repeatable CPU, full-filesystem, incremental,
search, viewport, extension-host continuous-blocking, and hidden-panel
behavioral evidence. Remaining performance release work is operating-system
profiler corroboration for **PERF-006** and rerunning the filesystem benchmark
on Windows and Linux as part of the supported-platform matrix. Record those
results here without silently weakening any PRD budget.
