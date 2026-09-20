import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');

describe('host security boundaries', () => {
	it('never delegates a local vault resource to the operating-system opener', () => {
		const source = readFileSync(join(ROOT, 'src', 'editor', 'documentSync.ts'), 'utf8');
		const calls = source.match(/vscode\.env\.openExternal\([^;]+/g) ?? [];
		expect(calls).toHaveLength(2);
		for (const call of calls) {
			expect(call).toContain('vscode.Uri.parse(target.href)');
		}
		expect(source).not.toMatch(/openExternal\(uri\)/);
	});

	it('never promotes a standalone document directory into a resource root', () => {
		const provider = readFileSync(join(ROOT, 'src', 'editor', 'MarkdownLivePreviewProvider.ts'), 'utf8');
		const sync = readFileSync(join(ROOT, 'src', 'editor', 'documentSync.ts'), 'utf8');
		const vault = readFileSync(join(ROOT, 'src', 'editor', 'workspaceVault.ts'), 'utf8');
		const workspace = readFileSync(join(ROOT, 'src', 'vault', 'vaultWorkspace.ts'), 'utf8');
		expect(provider).not.toMatch(/getWorkspaceFolder\(document\.uri\)\?\.uri\s*\?\?/);
		expect(sync).not.toMatch(/getWorkspaceFolder\(this\.document\.uri\)\?\.uri\s*\?\?\s*docDir/);
		expect(provider).not.toContain('localWorkspaceVaultRoot');
		expect(provider).toContain('Vault files are never resource roots.');
		expect(sync.match(/localWorkspaceVaultRoot\(/g)?.length).toBeGreaterThanOrEqual(7);
		expect(vault).toContain('classifyVaultWorkspace(folders)');
		expect(workspace).toContain('folders.length !== 1');
		expect(workspace).toContain("folders[0].uri.scheme !== 'file'");
		expect(sync).toContain('Local diagrams require one local workspace folder.');
		expect(sync).toContain('Local links require one local workspace folder.');
		expect(sync).not.toContain('asWebviewUri(');
		expect(sync).not.toContain('baseUri');
	});

	it('revokes stale vault authority across workspace-folder changes', () => {
		const registration = readFileSync(join(ROOT, 'src', 'vault', 'registerVault.ts'), 'utf8');
		const service = readFileSync(join(ROOT, 'src', 'vault', 'VaultService.ts'), 'utf8');
		const rewrites = readFileSync(join(ROOT, 'src', 'vault', 'LinkRewriteService.ts'), 'utf8');
		const tree = readFileSync(join(ROOT, 'src', 'vault', 'VaultTreeProvider.ts'), 'utf8');
		expect(registration).toContain('let workspaceRefresh: Promise<void> = Promise.resolve()');
		expect(registration).toContain('const generation = ++vaultGeneration');
		expect(registration).toContain('closeVaultPickers();');
		expect(registration).toContain('provider.invalidate(');
		expect(registration).toContain('generation === vaultGeneration && targetIndex === index');
		expect(tree).toContain('async initialize(isCurrent: () => boolean');
		expect(tree).toContain('if (!isCurrent()) return;');
		expect(service).toContain('isCurrentVaultWorkspace(current, root.toString())');
		expect(service).toContain('assertWorkspaceCurrent(): void');
		expect(rewrites.indexOf('this.vault.assertWorkspaceCurrent();')).toBeLessThan(
			rewrites.indexOf('const applied = await this.applyEdit(edit)'),
		);
		expect(rewrites).toContain('if (!this.isCurrent())');
	});

	it('does not retain hidden webview execution contexts', () => {
		const provider = readFileSync(join(ROOT, 'src', 'editor', 'MarkdownLivePreviewProvider.ts'), 'utf8');
		const preview = readFileSync(join(ROOT, 'src', 'sidebar', 'StylePreviewController.ts'), 'utf8');
		expect(provider).toContain('retainContextWhenHidden: false');
		expect(preview).toContain('retainContextWhenHidden: false');
		expect(`${provider}\n${preview}`).not.toContain('retainContextWhenHidden: true');
	});

	it('keeps oversized documents out of the executable webview', () => {
		const provider = readFileSync(join(ROOT, 'src', 'editor', 'MarkdownLivePreviewProvider.ts'), 'utf8');
		expect(provider).toContain('const documentWithinLimit = isEditorDocumentWithinLimit(document.getText())');
		expect(provider).toContain('enableScripts: documentWithinLimit');
		expect(provider).toContain('if (!documentWithinLimit)');
		expect(provider).toContain('buildDocumentLimitHtml');
		expect(provider).toContain("default-src 'none'; style-src ${webview.cspSource};");
	});

	it('enforces matching host and client concurrency ceilings for filesystem-backed content', () => {
		const sync = readFileSync(join(ROOT, 'src', 'editor', 'documentSync.ts'), 'utf8');
		const images = readFileSync(join(ROOT, 'src', 'webview-editor', 'localImageClient.ts'), 'utf8');
		const diagrams = readFileSync(join(ROOT, 'src', 'webview-editor', 'drawioFileClient.ts'), 'utf8');
		const embeds = readFileSync(join(ROOT, 'src', 'webview-editor', 'wikiEmbedClient.ts'), 'utf8');
		expect(sync).toContain('MAX_CONCURRENT_LOCAL_IMAGE_READS = 4');
		expect(sync).toContain('MAX_CONCURRENT_DRAWIO_READS = 4');
		expect(sync).toContain('MAX_CONCURRENT_EMBED_READS = 8');
		expect(sync.match(/new RequestLimiter\(/g)).toHaveLength(4);
		expect(images).toContain('MAX_PENDING_IMAGES = 4');
		expect(diagrams).toContain('MAX_PENDING_DRAWIO_FILES = 4');
		expect(embeds).toContain('MAX_PENDING_EMBEDS = 8');
	});

	it('routes every queued document mutation through one bounded serial gate', () => {
		const sync = readFileSync(join(ROOT, 'src', 'editor', 'documentSync.ts'), 'utf8');
		expect(sync).toContain('MAX_QUEUED_MUTATION_BATCHES = 64');
		expect(sync).toContain('new BoundedSerialQueue(MAX_QUEUED_MUTATION_BATCHES)');
		expect(sync).not.toContain('private mutationQueue: Promise<void>');
		expect(sync).not.toMatch(/this\.mutationQueue\s*=/);
		const editCase = sync.slice(sync.indexOf("case 'edit':"), sync.indexOf("case 'undo':"));
		const undoCase = sync.slice(sync.indexOf("case 'undo':"), sync.indexOf("case 'redo':"));
		const redoCase = sync.slice(sync.indexOf("case 'redo':"), sync.indexOf("case 'openLink':"));
		const pasteMethod = sync.slice(sync.indexOf('private enqueuePastedImages('), sync.indexOf('private async handlePasteImages('));
		for (const boundary of [editCase, undoCase, redoCase, pasteMethod]) {
			expect(boundary).toContain('this.enqueueMutation(');
		}
	});

	it('accepts only one initialization handshake per visible webview lifecycle', () => {
		const sync = readFileSync(join(ROOT, 'src', 'editor', 'documentSync.ts'), 'utf8');
		const readyCase = sync.slice(sync.indexOf("case 'ready':"), sync.indexOf("case 'edit':"));
		expect(readyCase).toContain('if (this.readyReceived)');
		expect(readyCase).toContain("diagnosticEventRateLimited('protocol.duplicateReadyRejected')");
		expect(readyCase.indexOf('if (this.readyReceived)')).toBeLessThan(readyCase.indexOf('this.sendInit()'));
		expect(sync).toContain('reloadWebview(html: string): void {\n\t\tthis.readyReceived = false;');
		const setVisible = sync.slice(sync.indexOf('setVisible(visible: boolean)'), sync.indexOf('\n\tdispose()', sync.indexOf('setVisible(visible: boolean)')));
		const hiddenCase = setVisible.slice(setVisible.indexOf('if (!visible) {'), setVisible.indexOf('if (this.needsFullSync)'));
		expect(hiddenCase).toContain('this.readyReceived = false;');
	});

	it('bounds privileged link navigation by concurrency and sustained rate', () => {
		const sync = readFileSync(join(ROOT, 'src', 'editor', 'documentSync.ts'), 'utf8');
		expect(sync).toContain('MAX_CONCURRENT_LINK_OPENS = 1');
		expect(sync).toContain('LINK_OPEN_BURST = 4');
		expect(sync).toContain('LINK_OPEN_REFILL_MS = 1_000');
		const linkCase = sync.slice(sync.indexOf("case 'openLink':"), sync.indexOf("case 'pasteImage':"));
		expect(linkCase).toContain('this.linkLimiter.tryAcquire()');
		expect(linkCase).toContain('this.linkRateLimiter.tryTake()');
		expect(linkCase).toContain("diagnosticEventRateLimited('protocol.linkRequestRejected')");
		expect(linkCase).toContain('.finally(release)');
	});

	it('does not echo attacker-authored draw.io paths in host error messages', () => {
		const sync = readFileSync(join(ROOT, 'src', 'editor', 'documentSync.ts'), 'utf8');
		expect(sync).not.toContain('Cannot read the file: {0}');
		expect(sync).toContain("reply({ error: vscode.l10n.t('Could not read the file.') })");
	});

	it('authorizes vault trash targets before prompting and never falls back to permanent deletion', () => {
		const vault = readFileSync(join(ROOT, 'src', 'vault', 'registerVault.ts'), 'utf8');
		const service = readFileSync(join(ROOT, 'src', 'vault', 'VaultService.ts'), 'utf8');
		const command = vault.slice(
			vault.indexOf("registerCommand('mdLivePreview.vault.delete'"),
			vault.indexOf("registerCommand('mdLivePreview.vault.copyRelativePath'"),
		);
		expect(command.match(/assertMutationSource\(/g)).toHaveLength(1);
		expect(command.indexOf('assertMutationSource(')).toBeLessThan(
			command.indexOf('const confirm = await vscode.window.showWarningMessage'),
		);
		expect(command).toContain('await service.moveToTrash(item.uri');
		expect(service).toContain('await this.assertMutationSource(uri, symbolicLink)');
		expect(service.match(/assertMutationSource\(uri, symbolicLink\)/g)).toHaveLength(2);
		expect(service).toContain('useTrash: true');
		expect(command).not.toContain('useTrash: false');
		expect(service).not.toContain('useTrash: false');
		expect(command).not.toMatch(/fs\.delete\([^\n]+\{[^}]*recursive:\s*true\s*\}\)/);
	});

	it('enforces mutation-source containment inside the link-rewrite transaction boundary', () => {
		const service = readFileSync(join(ROOT, 'src', 'vault', 'LinkRewriteService.ts'), 'utf8');
		expect(service).toContain('await this.vault.assertMutationSource(');
		expect(service.indexOf('await this.vault.assertMutationSource(')).toBeLessThan(
			service.indexOf('const edit = new vscode.WorkspaceEdit()'),
		);
	});

	it('confines file-manager reveal commands to authorized vault entries', () => {
		const vault = readFileSync(join(ROOT, 'src', 'vault', 'registerVault.ts'), 'utf8');
		const command = vault.slice(
			vault.indexOf("registerCommand('mdLivePreview.vault.revealInOS'"),
			vault.indexOf('\n\t);', vault.indexOf("registerCommand('mdLivePreview.vault.revealInOS'")),
		);
		expect(command).toContain('await service.assertMutationSource(');
		expect(command.indexOf('assertMutationSource(')).toBeLessThan(command.indexOf("executeCommand('revealFileInOS'"));
	});

	it('does not follow vault symlinks while expanding or sorting the tree', () => {
		const tree = readFileSync(join(ROOT, 'src', 'vault', 'VaultTreeProvider.ts'), 'utf8');
		expect(tree).toContain('await this.resolution.service.readDirectoryInside(parent)');
		expect(tree).not.toContain('workspace.fs.readDirectory(parent)');
		expect(tree).toContain('await service.statEntryInside(node.uri)');
		expect(tree).not.toContain('workspace.fs.stat(node.uri)');
	});

	it('keeps operating-system trash execution inside the vault service boundary', () => {
		const registration = readFileSync(join(ROOT, 'src', 'vault', 'registerVault.ts'), 'utf8');
		const service = readFileSync(join(ROOT, 'src', 'vault', 'VaultService.ts'), 'utf8');
		expect(registration).toContain('await service.moveToTrash(item.uri');
		expect(registration).not.toContain('workspace.fs.delete(item.uri');
		expect(service).toContain("await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true })");
		expect(service).not.toContain('useTrash: false');
	});

	it('reads indexed note bytes through the verified vault file handle', () => {
		const index = readFileSync(join(ROOT, 'src', 'vault', 'VaultIndex.ts'), 'utf8');
		const rewrites = readFileSync(join(ROOT, 'src', 'vault', 'LinkRewriteService.ts'), 'utf8');
		expect(index.match(/vault\.readFileInside\(/g)?.length).toBeGreaterThanOrEqual(2);
		expect(index).not.toContain('workspace.fs.readFile(uri)');
		expect(rewrites).toContain('this.vault.readFileInside(uri, MAX_REWRITE_FILE_BYTES)');
		expect(rewrites).not.toContain('workspace.fs.readFile(uri)');
	});

	it('revalidates stale index results immediately before opening them', () => {
		const vault = readFileSync(join(ROOT, 'src', 'vault', 'registerVault.ts'), 'utf8');
		const openRecord = vault.slice(
			vault.indexOf('async function openIndexedRecord'),
			vault.indexOf('\nfunction recentKey', vault.indexOf('async function openIndexedRecord')),
		);
		expect(openRecord).toContain('await index.vault.assertRegularFileInside(uri)');
		expect(openRecord.indexOf('assertRegularFileInside(uri)')).toBeLessThan(openRecord.indexOf("executeCommand('vscode.open'"));
	});

	it('revalidates Markdown and wikilink navigation as ordinary vault files', () => {
		const sync = readFileSync(join(ROOT, 'src', 'editor', 'documentSync.ts'), 'utf8');
		expect(sync.match(/service\.assertRegularFileInside\(uri\)/g)?.length).toBeGreaterThanOrEqual(2);
		const registration = readFileSync(join(ROOT, 'src', 'vault', 'registerVault.ts'), 'utf8');
		expect(registration).toContain('await service.assertRegularFileInside(entry.uri)');
	});

	it('does not send or mutate custom CSS through the sidebar in Restricted Mode', () => {
		const provider = readFileSync(join(ROOT, 'src', 'sidebar', 'StyleManagerViewProvider.ts'), 'utf8');
		const preview = readFileSync(join(ROOT, 'src', 'sidebar', 'StylePreviewController.ts'), 'utf8');
		const store = readFileSync(join(ROOT, 'src', 'sidebar', 'styleStore.ts'), 'utf8');
		const sidebar = readFileSync(join(ROOT, 'src', 'webview-sidebar', 'main.ts'), 'utf8');
		expect(provider).toContain('const loadedStyles = trustedAtStart ? await this.styleStore.listEntries() : []');
		expect(provider).toContain('const workspaceTrusted = trustedAtStart && vscode.workspace.isTrusted');
		expect(provider).toContain('const styles = workspaceTrusted ? loadedStyles : []');
		expect(provider).toContain("message.type !== 'ready' && message.type !== 'setSetting'");
		expect(provider).toContain('this.preview.refreshSecurityPolicy()');
		expect(preview.match(/if \(!vscode\.workspace\.isTrusted\)/g)?.length).toBeGreaterThanOrEqual(4);
		expect(preview).toContain('if (!vscode.workspace.isTrusted) return this.clearPreviewCss()');
		expect(preview).toContain("css: ''");
		for (const method of ['setEnabled', 'createNewStyle', 'duplicateStyle', 'renameStyle', 'deleteStyle', 'openStyleForEditing']) {
			const start = store.indexOf(`async ${method}(`);
			expect(start, `${method} is missing`).toBeGreaterThanOrEqual(0);
			expect(store.slice(start, start + 180), `${method} lacks a direct trust guard`).toContain('vscode.workspace.isTrusted');
		}
		expect(sidebar).toContain("t('sidebar.restrictedStyles')");
		expect(sidebar).toContain('prepareSidebarPreviewCss(style.css)');
		expect(sidebar).toContain("preview.style.setProperty('contain', 'paint', 'important')");
	});

	it('rechecks Workspace Trust inside queued filesystem handlers', () => {
		const sync = readFileSync(join(ROOT, 'src', 'editor', 'documentSync.ts'), 'utf8');
		const drawio = sync.slice(
			sync.indexOf('private async handleReadDrawioFile'),
			sync.indexOf('/**\n\t * Follows a link', sync.indexOf('private async handleReadDrawioFile')),
		);
		const paste = sync.slice(
			sync.indexOf('private async handlePasteImages'),
			sync.indexOf('private sendInit()', sync.indexOf('private async handlePasteImages')),
		);
		expect(drawio.match(/!vscode\.workspace\.isTrusted/g)).toHaveLength(2);
		expect(drawio.lastIndexOf('!vscode.workspace.isTrusted')).toBeLessThan(drawio.indexOf('reply({ text:'));
		expect(paste.match(/!vscode\.workspace\.isTrusted/g)?.length).toBeGreaterThanOrEqual(3);
		expect(paste.lastIndexOf('!vscode.workspace.isTrusted')).toBeLessThan(paste.indexOf('vscode.workspace.applyEdit(edit)'));
		const create = sync.slice(sync.indexOf("const create = vscode.l10n.t('Create note')"), sync.indexOf('\n\t\t}', sync.indexOf("const create = vscode.l10n.t('Create note')")));
		expect(create).toContain('if (!vscode.workspace.isTrusted) return;');
	});

	it('bounds custom CSS before reading it into host memory', () => {
		const store = readFileSync(join(ROOT, 'src', 'sidebar', 'styleStore.ts'), 'utf8');
		const controller = readFileSync(join(ROOT, 'src', 'sidebar', 'StylePreviewController.ts'), 'utf8');
		const preview = readFileSync(join(ROOT, 'src', 'webview-preview', 'main.ts'), 'utf8');
		expect(store).toContain('MAX_STYLE_FILES = 1_000');
		expect(store).toContain('MAX_STYLE_BYTES = 1024 * 1024');
		expect(store.match(/stat\.size > MAX_STYLE_BYTES|stat\.size <= remainingBytes/g)?.length).toBeGreaterThanOrEqual(2);
		expect(store.match(/bytes\.byteLength/g)?.length).toBeGreaterThanOrEqual(3);
		expect(controller).toContain('content.length > MAX_STYLE_BYTES || new TextEncoder().encode(content).byteLength > MAX_STYLE_BYTES');
		expect(preview).toContain('stripNetworkedCss(message.css)');
	});

	it('persists only the privacy-reduced vault-index record form', () => {
		const index = readFileSync(join(ROOT, 'src', 'vault', 'VaultIndex.ts'), 'utf8');
		const cache = readFileSync(join(ROOT, 'src', 'vault', 'vaultIndexCache.ts'), 'utf8');
		expect(index).toContain('const INDEX_SCHEMA = 4');
		expect(index).toContain('const encoded = encodeVaultIndexCache({');
		expect(index).toContain('records: this.records.values()');
		expect(cache).toContain('JSON.stringify(toPersistedVaultIndexRecord(record))');
		expect(cache).toContain("tasks: record.tasks.map((task) => ({ ...task, text: '' }))");
		expect(cache).toContain('properties: Object.fromEntries');
		expect(cache).not.toContain('searchTokens: record.searchTokens');
	});

	it('names every persisted vault-state surface with the canonical-root hash', () => {
		const index = readFileSync(join(ROOT, 'src', 'vault', 'VaultIndex.ts'), 'utf8');
		const registration = readFileSync(join(ROOT, 'src', 'vault', 'registerVault.ts'), 'utf8');
		const migration = readFileSync(join(ROOT, 'src', 'vault', 'vaultStateMigration.ts'), 'utf8');
		expect(index).toContain('canonicalVaultRootHash(vault.canonicalRootUri.toString())');
		expect(index).not.toContain("update(vault.canonicalRootPath).digest('hex')");
		expect(index).toContain('`vault-index-${this.rootHash}.json`');
		expect(index).toContain('this.legacyStorageUris');
		expect(registration).toContain('migrateVaultScopedState(index.id, index.legacyIds, context.workspaceState)');
		expect(migration).toContain('...legacyIds.flatMap');
		for (const kind of ['recent', 'backlinks.filter', 'backlinks.sort']) {
			expect(registration).toContain(`vaultStateKey(index.id, '${kind}')`);
		}
		expect(registration).not.toContain("const backlinkFilterKey = 'mdLivePreview.backlinks.filter'");
		expect(registration).not.toContain("const backlinkSortKey = 'mdLivePreview.backlinks.sort'");
	});
});
