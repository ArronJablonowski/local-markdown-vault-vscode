# Mermaid and draw.io QA — September 22, 2026

## Scope

Local Markdown Vault, starting at `4a85498`. macOS desktop testing uses isolated
VS Code profiles and disposable notes; no real user notes are edited. Browser
tests use the actual bundled editor, Mermaid renderer, and CSS in Chromium.
This is a functional and security-regression review, not a proof of absence of
vulnerabilities or full compatibility with every diagram shape/type.

## Findings and fixes

1. **Unreadable Mermaid output.** Generated Mermaid CSS includes animation
   rules. The previous sanitizer removed the entire stylesheet, leaving black
   shapes and unreadable labels. Visual inspection reproduced this even though
   older tests found SVG/text nodes. Sanitization now parses a detached CSS sheet,
   drops all at-rules and unsafe declarations/selectors, and retains safe paint
   and typography inside the isolated shadow root. Tests now check computed
   fill colors, not just the existence of an SVG. Network resources, animations,
   host selectors, scripts, foreign objects, and unsafe attributes remain blocked.
2. **Orphan Mermaid errors.** Invalid syntax created a second error SVG in the
   document body, outside the diagram panel. Protected `suppressErrorRendering`
   configuration now leaves error presentation to the extension's accessible
   error panel. The orphan-ID regression reproduced the issue before the fix.
3. **Stale draw.io file references.** Cached XML did not refresh after external
   changes. A bounded set of referenced paths now receives coalesced filesystem
   change notifications. A validated host-only invalidation message clears the
   cache, cancels pending reads, and rebuilds file widgets. Old read failures
   cannot delete a newer cache entry. Every new read still checks workspace
   trust, vault containment, symlinks, and size limits. Native VS Code tests
   verify edit/delete/recreate refresh and unchanged Markdown bytes.

The first two findings are rendering/isolation defects; these tests did not
demonstrate arbitrary code execution or data exfiltration. The third can display
outdated information and is a correctness issue. The fixes do not enable remote
diagram loading or weaken strict rendering.

## Coverage

- Mermaid flowchart, sequence, class, state, ER, Gantt, pie, journey, mindmap,
  timeline, and mixed-family notes; SVG visibility, labels, and computed paint.
- Mouse drag-to-pan, zoom in/out, modifier-wheel zoom, fit reset, and source
  controls for both renderers; keyboard draw.io page cycling and wraparound.
- Uncompressed draw.io XML, multiple pages, file references, out-of-order replies,
  stale reply rejection, external file edit/delete/recreate, and error recovery.
- Invalid Mermaid, oversized edge counts, malformed XML, DTD/entity rejection,
  compressed-input guidance, and preservation of surrounding document content.
- Mixed safe/hostile SVG CSS, strict-mode configuration, blocked external
  requests, malicious corpus, Restricted Mode, and existing parser/renderer
  resource-limit tests.

## Verification

- 971 unit tests, 85 host integration tests, both cache-restart phases, and four
  restricted-host checks passed.
- 234 browser tests passed, including 22 new diagram QA cases and existing
  malicious-diagram, network-isolation, accessibility, and rendering checks.
- Packaged VSIX checks passed: nine trusted, five restricted, and one disabled.
- All 18 focused native desktop tests passed, including external draw.io
  edit/delete/recreate refresh with unchanged Markdown bytes.
- Dependency policy passed for 797 locked packages (182 production packages);
  the advisory scan reported zero known vulnerabilities.
- The 10,000-item filesystem performance gate passed across five runs with
  the new watcher enabled; small-note delay was 75 ms and maximum measured
  continuous editor-host delay was 16 ms on this Mac.

Reproduce with `npm run test:all` and `npm run test:integration:focused`.
The new browser cases are in `test/e2e/diagramQa.spec.ts`; desktop refresh coverage
is in `test/integration/focusedDesktop.test.ts`.

## Limits and references

Live testing in this pass is macOS-only. Compressed draw.io payloads and complete
draw.io shape-library parity remain unsupported. Animations and external diagram
resources are intentionally disabled. Automatic refresh tracks at most 256
distinct file paths per open editor. Independent screen-reader review remains
outstanding. Browser screenshots were inspected for flowchart and mindmap output;
automated checks cover the other listed families, not pixel-perfect visual parity.

- [Mermaid security and configuration](https://mermaid.js.org/config/schema-docs/config)
- [draw.io uncompressed XML export](https://www.drawio.com/docs/manual/export/export-to-xml/)
