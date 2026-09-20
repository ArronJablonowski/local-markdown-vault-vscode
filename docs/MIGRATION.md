# Compatibility and migration

Local Markdown Vault keeps notes and attachments as ordinary files. It does not introduce a vault database or rewrite a workspace merely because the extension is installed, upgraded, disabled, or removed.

## Upgrading to the security-hardened release

The safer defaults can change what is displayed, but they do not change note text:

- Remote images are blocked until `mdLivePreview.remoteMedia` is enabled for that workspace. Only explicitly referenced HTTPS images are eligible after opt-in.
- Raw HTML is shown as inert text.
- External links remain visible. HTTPS and `mailto:` links may be opened; HTTP requires confirmation; executable and ambiguous schemes remain blocked.
- Local images, links, and attachments continue to work when their canonical target remains inside the current local workspace folder.
- Unsafe custom-CSS rules are ignored while safe sibling rules remain active. Remove remote imports, external URLs, fixed overlays, and similar rules from a theme rather than weakening the security policy. Applied CSS is limited to 1 MiB, 10,000 rules, and 32 conditional-rule nesting levels.
- Restricted Mode keeps plain Markdown editing available while diagrams, custom CSS, remote media, attachment writes, and vault-wide mutations are disabled.

No automatic content migration is required. Back up or commit important notes before upgrading, as you would before any editor change.

## Existing Obsidian vaults

Open the vault's folder as the single local VS Code workspace folder. Obsidian-compatible Markdown features such as wikilinks, embeds, properties, callouts, math, footnotes, tags, and tasks remain plain text.

The extension leaves `.obsidian/` untouched. It neither imports nor modifies Obsidian settings, community plugins, themes, sync configuration, or account data. Features outside the documented compatibility set may remain visible as source Markdown.

## Index and cache changes

The metadata index is rebuildable and does not contain note bodies. When its schema or validation rules change, the old cache is discarded and rebuilt; notes and attachments are never migrated to satisfy a cache version.

Recent-note history, Backlinks view preferences, and rebuildable index caches are stored under the SHA-256 identifier of the encoded canonical vault `file:` URI. On first activation after upgrading, valid path-hash or older unscoped values are copied into the URI-hash namespace. The new cache is committed before the path-hash cache is removed; legacy workspace-state keys are removed after their values are considered. This migration does not read, write, or create any file in the vault.

Use **Markdown Live Preview: Rebuild Vault Index** if navigation results appear stale after an upgrade. This deletes only rebuildable metadata and recent-note history for the workspace.

## Moving or renaming content

When automatic link updates are enabled, a vault move or rename and its affected Markdown-link and wikilink rewrites are submitted as one VS Code workspace operation. Review the affected notes and use Undo immediately if the result is not wanted. Files outside the canonical vault root are never included.

## Removing the extension

Disable or uninstall the extension normally. Markdown, attachments, folders, and `.obsidian/` remain usable by VS Code, Obsidian, Git, and other local tools. Rebuildable extension metadata may remain in VS Code workspace storage until VS Code clears it; it is not required to read the vault.
