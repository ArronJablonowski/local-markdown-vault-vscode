# Local Markdown Vault

Secure, local-only Markdown editing for Visual Studio Code, with an Obsidian-style Live Preview and a workspace Document Vault.

> **Project status:** active pre-release development. Install from source or a locally built VSIX. This extension is not yet published to the Visual Studio Marketplace.

Local Markdown Vault keeps notes and attachments as ordinary files in one local VS Code workspace. It does not provide cloud sync, accounts, telemetry, publishing, or background uploads.

## What it provides

### Live Preview editor

- CodeMirror-based Markdown editing with formatting rendered in place
- Source reveal around the cursor and normal text selection behavior
- Syntax highlighting, document outline, search, and editable tables
- Local images and attachments, Mermaid diagrams, draw.io diagrams, and themes
- Obsidian-style wikilinks, aliases, heading and block links, and inline embeds
- YAML properties, callouts, math, footnotes, tags, and interactive task lists

### Document Vault

- Native VS Code tree for notes, folders, and attachments
- Create, rename, move, delete/trash, drag-and-drop, sort, refresh, and reveal
- Automatic Markdown and wikilink updates after file or folder moves
- Local vault search, Quick Switcher, backlinks, unlinked mentions, recent notes, tags, aliases, and hover previews
- Incremental metadata index that can be rebuilt from the files in the workspace

### Local-first security

- Remote images are blocked by default
- Raw HTML is rendered as inert text
- Dangerous protocols and paths outside the vault are rejected
- Filesystem paths are canonicalized and checked after symlink resolution
- Webview messages, pasted images, YAML, diagrams, SVG, XML, and queued work are bounded and validated
- Mermaid uses strict security mode; generated SVG is sanitized before insertion
- Restricted Workspace Trust mode disables diagrams, custom CSS, remote media, and vault-wide mutations
- No extension-managed network requests unless the user explicitly enables HTTPS remote images for the current workspace

See [SECURITY.md](SECURITY.md) for the security policy and threat-model summary.

## Scope

Local Markdown Vault deliberately does not include:

- Cloud or peer-to-peer synchronization
- User accounts, telemetry, analytics, or advertising
- Publishing or hosted note sharing
- Community plugins
- Obsidian Canvas or Bases
- A complete clone of the Obsidian desktop application

The first supported vault model is exactly one local `file:` workspace folder. Multi-root workspaces, arbitrary folders outside the workspace, nested vaults, and remote filesystem providers are deferred.

## Requirements

- Visual Studio Code 1.90 or newer
- A local folder opened as a VS Code workspace
- Node.js 24 LTS and npm to build from source
- Git to clone the repository

## Install from source

### 1. Clone and install dependencies

Using SSH:

```bash
git clone git@github.com:ArronJablonowski/local-markdown-vault-vscode.git
cd local-markdown-vault-vscode
npm run security:dependencies
npm ci --ignore-scripts
```

Or using HTTPS:

```bash
git clone https://github.com/ArronJablonowski/local-markdown-vault-vscode.git
cd local-markdown-vault-vscode
npm run security:dependencies
npm ci --ignore-scripts
```

The policy check verifies the lockfile source, integrity, production licenses,
and reviewed install-script set. `npm ci --ignore-scripts` then installs the
exact locked dependencies without executing package lifecycle scripts.

### 2. Run in a Development Extension Host

```bash
npm run compile
code .
```

In VS Code, press `F5` and choose **VS Code Extension Development** if prompted. In the new Extension Development Host window, open a local folder, then open a Markdown file.

To select the editor manually, run **View: Reopen Editor With...** and choose **Markdown Live Preview**.

### 3. Build and install a VSIX

```bash
npm run package
code --install-extension local-markdown-vault-0.2.0.vsix --force
```

You can also open the Extensions view, choose **... > Install from VSIX...**, and select the generated file. Reload VS Code after installation.

To remove a source-installed build:

```bash
code --uninstall-extension arronjablonowski.local-markdown-vault
```

## Using the extension

1. Open one local folder in VS Code. That folder is the vault boundary.
2. Open a `.md` file with **Markdown Live Preview**.
3. Open the **Local Markdown Vault** activity-bar view to manage files and use knowledge-navigation tools.
4. Use `[[Note]]`, `[[Note|Alias]]`, `[[Note#Heading]]`, or `![[Attachment.png]]` for vault links and embeds.
5. Review workspace trust and security settings before enabling diagrams, custom CSS, or remote media in an unfamiliar workspace.

Common shortcuts:

| Action | macOS | Windows/Linux |
| --- | --- | --- |
| Quick Switcher | `Cmd+O` | `Ctrl+O` |
| Vault search | `Cmd+Shift+F` | `Ctrl+Shift+F` |
| Save | `Cmd+S` | `Ctrl+S` |
| Command Palette | `Cmd+Shift+P` | `Ctrl+Shift+P` |

## Important settings

Search for `Local Markdown Vault` or `mdLivePreview` in VS Code Settings.

| Setting | Purpose | Default posture |
| --- | --- | --- |
| Remote media | Permit HTTPS images for this workspace | Blocked |
| Automatic link updates | Rewrite affected links after rename or move | Enabled |
| Attachment location | Choose where pasted attachments are stored | Inside vault |
| Vault sort order | Configure Document Vault ordering | Name |
| Reveal active file | Follow the active note in the vault tree | Enabled |
| Excluded paths | Omit paths from indexing and navigation | Conservative defaults |
| Diagram rendering | Enable Mermaid and draw.io rendering | Trust-aware |

The internal setting and command prefix remains `mdLivePreview` for compatibility with existing installations and keybindings.

## Development

```bash
npm run security:dependencies # verify lockfile and dependency policy
npm ci --ignore-scripts       # install without package lifecycle scripts
npm run compile        # build the extension and webviews
npm test               # unit tests
npm run test:e2e       # browser end-to-end tests
npm run test:integration
npm run test:integration:cache-restart
npm run package        # verify and create the VSIX
```

Useful release and security checks are documented in [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md). The full engineering roadmap and acceptance criteria are in [docs/PRODUCT_REQUIREMENTS.md](docs/PRODUCT_REQUIREMENTS.md).

Additional references:

- [Contributing and development workflow](CONTRIBUTING.md)
- [Obsidian compatibility](docs/OBSIDIAN_COMPATIBILITY.md)
- [Migration and rollback](docs/MIGRATION.md)
- [Accessibility](docs/ACCESSIBILITY.md)
- [Security policy](SECURITY.md)

## Known limitations

- Only one local workspace folder is supported as a vault.
- Case-only rename transactions pass the automated Windows, macOS, and Linux matrix. Native macOS Trash movement is automated; focused UI undo/redo, accessibility announcements, and Windows/Linux Trash behavior still require manual platform sign-off.
- VoiceOver, NVDA, and Orca checks remain part of the manual pre-release matrix.
- Large-vault performance depends on storage, exclusions, note size, and available system resources.
- The extension is under active security hardening and is not yet declared production-ready for hostile files.

## Reporting bugs and security issues

- General bugs and feature requests: [GitHub Issues](https://github.com/ArronJablonowski/local-markdown-vault-vscode/issues)
- Security vulnerabilities: follow the private-reporting guidance in [SECURITY.md](SECURITY.md)

Please include the VS Code version, operating system, extension version, workspace trust state, and minimal reproduction steps. Do not attach private vault contents.

## Project history and license

This project began as a fork of [t-shoot/md-live-preview-editor](https://github.com/t-shoot/md-live-preview-editor). Local Markdown Vault retains compatible Markdown files and credits the upstream project and bundled dependencies in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Licensed under the [MIT License](LICENSE). Obsidian is a product of Dynalist Inc.; this independent project is not affiliated with or endorsed by Obsidian.
