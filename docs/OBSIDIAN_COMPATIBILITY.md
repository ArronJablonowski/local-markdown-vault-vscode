# Obsidian compatibility

Local Markdown Vault supports a focused, local-only subset of the
Markdown workflows commonly used in Obsidian. Compatibility means that note
content remains ordinary Markdown and that the syntax listed below can be read
and edited without converting the vault to a proprietary format. It does not
mean that this extension is an Obsidian clone or that it reads Obsidian's
application configuration.

This document describes the compatibility target for the packaged extension.
Security restrictions take precedence when Obsidian or another Markdown
renderer would execute active content or load a remote resource.

The checked-in `test/fixtures/obsidian-core.md` document exercises the portable
core as one representative note. The browser suite renders that file with the
same JavaScript and CSS shipped in the VSIX and requires at least 95 percent of
its named compatibility checks to pass. Individual checks must also pass so the
percentage cannot conceal a known regression.

The multi-file `test/fixtures/obsidian-advanced/` vault is the broader visual
and behavioral comparison corpus. It is tested in Obsidian Live Preview and by
`test/e2e/advancedCompatibility.spec.ts` against the same editor bundle and CSS
that ship in the VSIX. The security-differences note is an explicit negative
test: active HTML, unsafe links, remote tracking media, and attempts to weaken
Mermaid strict mode must remain inert or blocked.

The deterministic 100-note matrix in
`test/fixtures/obsidian-comparison-100/` expands this coverage across ten syntax
and interaction categories with increasing file sizes. Its native and automated
results are recorded in [OBSIDIAN_100_FILE_COMPARISON.md](OBSIDIAN_100_FILE_COMPARISON.md).

## Research basis

The compatibility matrix is based on Obsidian's official documentation for
[basic formatting](https://help.obsidian.md/syntax),
[advanced syntax](https://help.obsidian.md/advanced-syntax),
[Obsidian-flavored Markdown](https://help.obsidian.md/obsidian-flavored-markdown),
[internal links](https://help.obsidian.md/links),
[embeds](https://help.obsidian.md/embeds),
[properties](https://help.obsidian.md/properties),
[callouts](https://help.obsidian.md/callouts),
[tags](https://help.obsidian.md/tags), and
[aliases](https://help.obsidian.md/aliases). The reusable fixture was also
opened directly in Obsidian 1.13.7 on macOS and reviewed in Live Preview. That
review confirmed source reveal, three-level list markers, non-empty task-state
completion, highlight presentation, editing-comment presentation, typed
properties, standard callout color families and icons, folding, nested
callouts, wikilinks, embeds, tables, math, footnotes, and Mermaid structure. A
direct Obsidian 1.13.7 keyboard comparison also confirmed that Shift+Enter
creates a continuation line without a new marker, aligned by two spaces after
a bullet, three after `1.`, and six after `- [ ]`.

## Supported note syntax

| Syntax or behavior | Compatibility | Notes |
| --- | --- | --- |
| CommonMark and GitHub-Flavored Markdown | Supported | Headings, emphasis, blockquotes, lists, code, links, images, rules, tasks, and tables remain plain Markdown. |
| Highlights and editing comments | Supported | `==highlight==` uses Live Preview source reveal. Obsidian `%%` comments remain visible as editing source and are never executable. |
| Wikilinks | Supported | Note paths, aliases, headings, and block IDs are supported. Typing `[[` opens local, bounded completion. |
| Internal Markdown links | Supported | Relative and vault-root note links resolve inside the current vault; heading and block fragments navigate locally. |
| Note embeds | Supported with limits | `![[Note]]`, heading embeds, and block embeds are read-only in the parent, detect cycles, and stop after three nested levels. |
| Image embeds | Supported with limits | Local raster images and bounded `|width` or `|widthxheight` aliases are supported after vault containment and image-dimension checks. |
| PDF and audio wikilinks | Open only | Valid local files open through VS Code. They are not rendered as active inline viewers. |
| YAML properties | Core typed values | Text, homogeneous lists, numbers, booleans, dates, date-times, tags, and quoted wikilinks have typed presentation and editing. Complex nested YAML remains source text. |
| Callouts | Supported | Standard callout markers, titles, aliases, nesting, fold state, distinct icons, and Obsidian-style color families render from the authoritative source. |
| Math | Supported with limits | Inline and block math use the bundled renderer with HTML and unsafe commands disabled. |
| Footnotes | Supported | References and definitions navigate in both directions and remain editable as Markdown. |
| Tags | Supported | Inline and YAML tags, including nested tags, feed the local Tags view. Code and headings are not interpreted as tags. |
| Tasks | Supported | Checkboxes are keyboard and pointer operable and change only their source marker. As in Obsidian, every non-space task-state character is treated as completed. |
| Tables | Supported | Cells can be edited in place; row and column insertion, deletion, movement, sorting, and alignment preserve Markdown source where possible. |
| Editing interactions | Supported | Shift+Enter creates an aligned soft continuation line. Mouse-highlighted text can be copied or deleted; complete rendered tables and fenced code blocks support safe whole-block copy or deletion. |
| Mermaid | Supported with security differences | Diagrams are bounded and sanitized. HTML labels, click callbacks, external resources, and document attempts to weaken strict mode are disabled. |
| draw.io file embeds | Supported with security differences | Local uncompressed diagram files are parsed with explicit limits and sanitized before display. Compressed draw.io input and active external content are not supported. |
| Raw HTML | Displayed as inert source | Raw HTML is never executed. No setting enables arbitrary HTML execution. |

Malformed or incomplete syntax remains visible and editable as source instead
of disappearing or producing an empty document.

## Vault and navigation behavior

- The vault is exactly one trusted, local `file:` VS Code workspace folder.
  Multi-root workspaces, remote filesystem providers, nested vaults, and
  arbitrary folders outside the workspace are not initial-release targets.
- The native Document Vault tree manages ordinary files and folders. Removing
  the extension leaves the vault usable by Obsidian, VS Code, Git, and other
  tools.
- Quick Switcher, Vault Search, backlinks, bounded unlinked mentions, nested
  tags, recent notes, broken links, aliases, and hover previews use a local,
  rebuildable metadata index. Note bodies are not retained in the index.
- Renaming or moving a vault item updates supported Markdown links and
  wikilinks when automatic link updates are enabled. Ordinary moves and their
  rewrites use one VS Code workspace operation. See the release checklist for
  the documented case-only rename limitation on case-insensitive macOS
  volumes.
- `.obsidian/` is left untouched. The extension does not import, interpret, or
  modify Obsidian settings, hotkeys, appearance files, plugin data, or sync
  configuration.

## Intentional security differences

| Area | This extension's behavior |
| --- | --- |
| Network access | Opening and editing a note is network-silent by default. There is no account, telemetry, cloud sync, publishing, or background upload. |
| Remote images | Blocked by default. A workspace may explicitly allow note-authored HTTPS images; redirects to a non-HTTPS destination remain blocked. |
| External links | HTTPS and `mailto:` may be opened. HTTP requires confirmation. Executable, local-file, ambiguous, and unknown schemes are rejected. |
| Local files | Reads, writes, embeds, navigation, and mutations must remain inside the canonical vault and may not traverse a symlink target outside it. |
| HTML and SVG | Markdown HTML is inert. Renderer-produced SVG passes a restrictive verifier that removes scripts, event handlers, external references, animation, and `foreignObject`. |
| CSS snippets | Safe rules are scoped to preview content. Imports, network URLs, and rules capable of obscuring or impersonating extension controls are ignored. |
| Restricted Mode | Plain Markdown editing remains available, while diagrams, custom CSS, remote media, attachment writes, and vault-wide mutations are disabled. |

These differences are product guarantees, not missing compatibility work. A
future relaxation requires a separate security review and explicit test
coverage.

## Explicit non-goals

The extension does not provide Obsidian Sync, accounts, publishing, telemetry,
community plugins, Canvas, Bases, a graph view, or a general-purpose executable
plugin API. It is not affiliated with or endorsed by Obsidian.

For upgrade behavior and cache migration, see [MIGRATION.md](MIGRATION.md). For
security reporting and the supported threat model, see
[../SECURITY.md](../SECURITY.md).
