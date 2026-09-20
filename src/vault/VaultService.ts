import * as vscode from 'vscode';
import { constants as fsConstants, type Stats } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, rmdir, stat, unlink, type FileHandle } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { isPathInside, resolveVaultRelativePath } from '../shared/pathContainment';
import { normalizeOpenOnlyAttachmentTarget } from '../shared/openOnlyAttachment';
import { noteFileName, validateVaultEntryName } from './vaultName';
import { classifyVaultWorkspace, isCurrentVaultWorkspace, type VaultUnavailableReason } from './vaultWorkspace';

export type { VaultUnavailableReason } from './vaultWorkspace';

const MAX_ATTACHMENT_SEARCH_RESULTS = 10_000;
const OPEN_ONLY_ATTACHMENT_GLOB = '**/*.{3gp,aac,flac,m4a,mp3,ogg,pdf,wav,webm,3GP,AAC,FLAC,M4A,MP3,OGG,PDF,WAV,WEBM}';

export type VaultResolution =
	| { available: true; service: VaultService }
	| { available: false; reason: VaultUnavailableReason };

export interface CreatedVaultFile {
	readonly uri: vscode.Uri;
	/** Opaque capability for committing or rolling back this exact creation. */
	readonly cleanupToken: string;
	/** The filesystem identity captured while the newly-created file was open. */
	readonly identity: Pick<Stats, 'dev' | 'ino' | 'birthtimeMs' | 'ctimeMs'>;
}

export interface VaultFileContents {
	readonly bytes: Uint8Array;
	readonly mtimeMs: number;
	readonly size: number;
	readonly identity: CreatedVaultFile['identity'];
}

interface CreatedVaultDirectory {
	readonly path: string;
	readonly identity: Stats;
}

export class VaultService {
	readonly canonicalRootUri: vscode.Uri;
	private readonly createdFileLeases = new Map<string, { uri: vscode.Uri; handle: FileHandle }>();

	private constructor(
		readonly rootUri: vscode.Uri,
		readonly canonicalRootPath: string,
	) {
		this.canonicalRootUri = vscode.Uri.file(canonicalRootPath);
	}

	static async resolve(): Promise<VaultResolution> {
		const folders = vscode.workspace.workspaceFolders;
		const classification = classifyVaultWorkspace(folders);
		if (!classification.available) return classification;
		try {
			const root = folders![0].uri;
			const canonicalRoot = await realpath(root.fsPath);
			const current = vscode.workspace.workspaceFolders;
			const currentClassification = classifyVaultWorkspace(current);
			if (!currentClassification.available) return currentClassification;
			if (!isCurrentVaultWorkspace(current, root.toString())) {
				return { available: false, reason: 'noWorkspace' };
			}
			return { available: true, service: new VaultService(root, canonicalRoot) };
		} catch {
			return { available: false, reason: 'nonLocalWorkspace' };
		}
	}

	/** Rejects a filesystem capability retained across a workspace transition. */
	assertWorkspaceCurrent(): void {
		const folders = vscode.workspace.workspaceFolders;
		if (!isCurrentVaultWorkspace(folders, this.rootUri.toString())) {
			throw new Error('The Document Vault changed before the operation completed.');
		}
	}

	private assertOperationCurrent(isCurrent: () => boolean): void {
		this.assertWorkspaceCurrent();
		if (!isCurrent()) throw new Error('The Document Vault changed before the operation completed.');
	}

	relativePath(uri: vscode.Uri): string | undefined {
		if (uri.scheme !== 'file') return undefined;
		const value = relative(this.rootUri.fsPath, uri.fsPath).replace(/\\/g, '/');
		return value === '' || (!value.startsWith('../') && value !== '..') ? value : undefined;
	}

	private async assertCanonicalParent(targetPath: string): Promise<void> {
		const canonicalParent = await realpath(dirname(targetPath));
		if (!isPathInside(this.canonicalRootPath, canonicalParent, process.platform === 'win32')) {
			throw new Error('The destination resolves outside the Document Vault.');
		}
	}

	private childPath(parent: vscode.Uri, name: string): string {
		const error = validateVaultEntryName(name);
		if (error) throw new Error(error);
		const target = resolve(parent.fsPath, name);
		if (!isPathInside(this.rootUri.fsPath, target, process.platform === 'win32')) {
			throw new Error('The destination is outside the Document Vault.');
		}
		return target;
	}

	/**
	 * Creates and fills a new vault file without trusting a path check made
	 * before `open()`. The exclusive handle is compared with the path's
	 * canonical target both before and after writing, preventing a replaced
	 * attachment directory or filename from redirecting untrusted bytes.
	 */
	async createFileExclusive(
		parent: vscode.Uri,
		name: string,
		bytes: Uint8Array,
		maxBytes = 20 * 1024 * 1024,
		isCurrent: () => boolean = () => true,
	): Promise<CreatedVaultFile> {
		this.assertOperationCurrent(isCurrent);
		if (bytes.byteLength > maxBytes) throw new Error('The file exceeds the size limit.');
		const target = this.childPath(parent, name);
		await this.assertCanonicalParent(target);
		this.assertOperationCurrent(isCurrent);
		const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
		const handle = await open(
			target,
			fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
			0o600,
		);
		let openedIdentity: Stats | undefined;
		try {
			openedIdentity = await handle.stat();
			if (!openedIdentity.isFile()) throw new Error('The attachment destination is not a regular file.');
			await this.assertOpenedFileInside(target, openedIdentity);
			this.assertOperationCurrent(isCurrent);
			await handle.writeFile(bytes);
			const writtenIdentity = await handle.stat();
			if (!sameFileIdentity(openedIdentity, writtenIdentity) || writtenIdentity.size !== bytes.byteLength) {
				throw new Error('The attachment file changed while it was being written.');
			}
			openedIdentity = writtenIdentity;
			await this.assertOpenedFileInside(target, writtenIdentity);
			this.assertOperationCurrent(isCurrent);
			const cleanupToken = randomUUID();
			const uri = vscode.Uri.file(target);
			this.createdFileLeases.set(cleanupToken, { uri, handle });
			return {
				uri,
				cleanupToken,
				identity: fileIdentity(writtenIdentity),
			};
		} catch (error) {
			await handle.close().catch(() => undefined);
			if (openedIdentity) await removeIfSameFile(target, openedIdentity);
			throw error;
		}
	}

	/** Removes only the exact file returned by `createFileExclusive`. */
	async removeCreatedFile(file: CreatedVaultFile): Promise<void> {
		const lease = this.createdFileLeases.get(file.cleanupToken);
		if (!lease) return;
		this.createdFileLeases.delete(file.cleanupToken);
		try {
			if (lease.uri.toString() !== file.uri.toString() || this.relativePath(file.uri) === undefined) return;
			await this.assertCanonicalParent(file.uri.fsPath);
			const [opened, current] = await Promise.all([lease.handle.stat(), stat(file.uri.fsPath)]);
			if (sameFileIdentity(opened, file.identity) && sameFileIdentity(current, opened)) {
				await unlink(file.uri.fsPath);
			}
		} catch {
			// Cleanup is best-effort and must never delete a replacement file.
		} finally {
			await lease.handle.close().catch(() => undefined);
		}
	}

	/** Commits a created file by releasing its rollback capability. */
	async releaseCreatedFile(file: CreatedVaultFile): Promise<void> {
		const lease = this.createdFileLeases.get(file.cleanupToken);
		if (!lease) return;
		this.createdFileLeases.delete(file.cleanupToken);
		await lease.handle.close().catch(() => undefined);
	}

	private async assertOpenedFileInside(target: string, openedIdentity: Stats): Promise<void> {
		const canonicalTarget = await realpath(target);
		if (!isPathInside(this.canonicalRootPath, canonicalTarget, process.platform === 'win32')) {
			throw new Error('The destination resolves outside the Document Vault.');
		}
		const pathIdentity = await stat(canonicalTarget);
		if (!sameFileIdentity(openedIdentity, pathIdentity)) {
			throw new Error('The attachment destination changed while it was being opened.');
		}
	}

	/** Reads a bounded regular file through a verified handle, never a raw URI. */
	async readFileInside(uri: vscode.Uri, maxBytes: number): Promise<VaultFileContents> {
		this.assertWorkspaceCurrent();
		if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('The file size limit is invalid.');
		if (this.relativePath(uri) === undefined) throw new Error('The file is outside the Document Vault.');
		const canonical = await realpath(uri.fsPath);
		if (!isPathInside(this.canonicalRootPath, canonical, process.platform === 'win32')) {
			throw new Error('The file resolves outside the Document Vault.');
		}
		const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
		const handle = await open(canonical, fsConstants.O_RDONLY | noFollow);
		try {
			const opened = await handle.stat();
			if (!opened.isFile()) throw new Error('The vault item is not a regular file.');
			if (opened.size > maxBytes) throw new Error('The vault file exceeds the size limit.');
			await this.assertOpenedFileInside(canonical, opened);
			const bytes = await handle.readFile();
			const completed = await handle.stat();
			if (!sameFileIdentity(opened, completed) || completed.size !== bytes.byteLength) {
				throw new Error('The vault file changed while it was being read.');
			}
			await this.assertOpenedFileInside(canonical, completed);
			this.assertWorkspaceCurrent();
			return { bytes, mtimeMs: completed.mtimeMs, size: completed.size, identity: fileIdentity(completed) };
		} finally {
			await handle.close().catch(() => undefined);
		}
	}

	async createNote(parent: vscode.Uri, requestedName: string, isCurrent: () => boolean = () => true): Promise<vscode.Uri> {
		const name = noteFileName(requestedName);
		const created = await this.createFileExclusive(parent, name, new Uint8Array(), 0, isCurrent);
		try {
			this.assertOperationCurrent(isCurrent);
			await this.releaseCreatedFile(created);
			return created.uri;
		} catch (error) {
			await this.removeCreatedFile(created);
			throw error;
		}
	}

	async createNoteAtRelativePath(requestedPath: string, isCurrent: () => boolean = () => true): Promise<vscode.Uri> {
		const normalized = requestedPath.replace(/\\/g, '/').replace(/^\.\//, '');
		if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) {
			throw new Error('The note path must be relative to the Document Vault.');
		}
		const parts = normalized.split('/');
		if (parts.length > 64) throw new Error('The note path is too deeply nested.');
		for (const part of parts) {
			const error = validateVaultEntryName(part);
			if (error) throw new Error(error);
		}
		parts[parts.length - 1] = noteFileName(parts[parts.length - 1]);
		const target = resolve(this.rootUri.fsPath, ...parts);
		if (!isPathInside(this.rootUri.fsPath, target, process.platform === 'win32')) {
			throw new Error('The destination is outside the Document Vault.');
		}
		const parent = vscode.Uri.file(dirname(target));
		const ensured = await this.ensureDirectoryInsideTracked(parent, isCurrent);
		let created: CreatedVaultFile | undefined;
		try {
			created = await this.createFileExclusive(ensured.uri, basename(target), new Uint8Array(), 0, isCurrent);
			this.assertOperationCurrent(isCurrent);
			await this.releaseCreatedFile(created);
			return created.uri;
		} catch (error) {
			if (created) await this.removeCreatedFile(created);
			await rollbackCreatedDirectories(ensured.created);
			throw error;
		}
	}

	async createFolder(parent: vscode.Uri, name: string, isCurrent: () => boolean = () => true): Promise<vscode.Uri> {
		this.assertOperationCurrent(isCurrent);
		const target = this.childPath(parent, name);
		await this.assertCanonicalParent(target);
		this.assertOperationCurrent(isCurrent);
		await mkdir(target);
		let created: CreatedVaultDirectory | undefined;
		try {
			const directory = await this.assertDirectoryInside(target);
			created = { path: target, identity: directory.identity };
			this.assertOperationCurrent(isCurrent);
			return directory.uri;
		} catch (error) {
			if (created) await rollbackCreatedDirectories([created]);
			throw error;
		}
	}

	/**
	 * Creates missing directory segments one at a time and rejects symbolic-link
	 * segments. Recursive mkdir is deliberately avoided because it can traverse
	 * a parent that was replaced after a single up-front containment check.
	 */
	async ensureDirectoryInside(uri: vscode.Uri, isCurrent: () => boolean = () => true): Promise<vscode.Uri> {
		return (await this.ensureDirectoryInsideTracked(uri, isCurrent)).uri;
	}

	private async ensureDirectoryInsideTracked(
		uri: vscode.Uri,
		isCurrent: () => boolean,
	): Promise<{ uri: vscode.Uri; created: CreatedVaultDirectory[] }> {
		this.assertOperationCurrent(isCurrent);
		const path = this.relativePath(uri);
		if (path === undefined) throw new Error('The directory is outside the Document Vault.');
		if (!path) {
			await this.assertExistingInside(this.rootUri);
			this.assertOperationCurrent(isCurrent);
			return { uri: this.rootUri, created: [] };
		}
		let current = this.rootUri;
		const created: CreatedVaultDirectory[] = [];
		try {
			for (const segment of path.split('/')) {
				this.assertOperationCurrent(isCurrent);
				const target = this.childPath(current, segment);
				await this.assertCanonicalParent(target);
				this.assertOperationCurrent(isCurrent);
				let made = false;
				try {
					await mkdir(target);
					made = true;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
				}
				const directory = await this.assertDirectoryInside(target);
				if (made) created.push({ path: target, identity: directory.identity });
				this.assertOperationCurrent(isCurrent);
				current = directory.uri;
			}
			return { uri: current, created };
		} catch (error) {
			await rollbackCreatedDirectories(created);
			throw error;
		}
	}

	private async assertDirectoryInside(target: string): Promise<{ uri: vscode.Uri; identity: Stats }> {
		const entry = await lstat(target);
		if (entry.isSymbolicLink() || !entry.isDirectory()) {
			throw new Error('The vault directory is not a regular directory.');
		}
		const canonical = await realpath(target);
		if (!isPathInside(this.canonicalRootPath, canonical, process.platform === 'win32')) {
			throw new Error('The directory resolves outside the Document Vault.');
		}
		const canonicalIdentity = await stat(canonical);
		if (!sameFileIdentity(entry, canonicalIdentity) || !canonicalIdentity.isDirectory()) {
			throw new Error('The vault directory changed while it was being created.');
		}
		return { uri: vscode.Uri.file(target), identity: entry };
	}

	async assertExistingInside(uri: vscode.Uri): Promise<void> {
		this.assertWorkspaceCurrent();
		const lexical = this.relativePath(uri);
		if (lexical === undefined) throw new Error('The item is outside the Document Vault.');
		const canonical = await realpath(uri.fsPath);
		if (!isPathInside(this.canonicalRootPath, canonical, process.platform === 'win32')) {
			throw new Error('The item resolves outside the Document Vault.');
		}
		this.assertWorkspaceCurrent();
	}

	/** Returns the provider's canonical spelling for an existing confined item. */
	async canonicalExistingUri(uri: vscode.Uri): Promise<vscode.Uri> {
		await this.assertExistingInside(uri);
		return vscode.Uri.file(await realpath(uri.fsPath));
	}

	/**
	 * Reads metadata for the directory entry itself. Unlike `workspace.fs.stat`,
	 * this never follows a symbolic-link leaf, so sorting the vault cannot read
	 * timestamps or sizes from an outside target.
	 */
	async statEntryInside(uri: vscode.Uri): Promise<Stats> {
		this.assertWorkspaceCurrent();
		const lexical = this.relativePath(uri);
		if (lexical === undefined) throw new Error('The item is outside the Document Vault.');
		if (!lexical) {
			const root = await stat(this.canonicalRootPath);
			if (!root.isDirectory()) throw new Error('The Document Vault root is not a directory.');
			this.assertWorkspaceCurrent();
			return root;
		}
		await this.assertCanonicalParent(uri.fsPath);
		const entry = await lstat(uri.fsPath);
		if (entry.isSymbolicLink()) return entry;
		const canonical = await realpath(uri.fsPath);
		if (!isPathInside(this.canonicalRootPath, canonical, process.platform === 'win32')) {
			throw new Error('The item resolves outside the Document Vault.');
		}
		const canonicalIdentity = await stat(canonical);
		if (!sameFileIdentity(entry, canonicalIdentity)) {
			throw new Error('The vault item changed while it was being inspected.');
		}
		this.assertWorkspaceCurrent();
		return entry;
	}

	/**
	 * Reports whether another spelling currently resolves to the same confined
	 * directory entry. This distinguishes a case-insensitive provider alias from
	 * two distinct names on a case-sensitive filesystem without guessing from
	 * the operating system or volume format.
	 */
	async aliasesEntry(
		uri: vscode.Uri,
		expected: Pick<Stats, 'dev' | 'ino' | 'birthtimeMs' | 'ctimeMs'>,
	): Promise<boolean> {
		try {
			return sameFileIdentity(await this.statEntryInside(uri), expected);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
			throw error;
		}
	}

	async assertExpandableDirectory(uri: vscode.Uri): Promise<void> {
		const entry = await this.statEntryInside(uri);
		if (entry.isSymbolicLink() || !entry.isDirectory()) {
			throw new Error('The vault item is not an expandable directory.');
		}
	}

	/**
	 * Enumerates a verified ordinary vault directory. The directory entry is
	 * identified before and after the read so a rename or symlink replacement
	 * cannot turn an authorized listing into returned data from another path.
	 * Dirent type checks do not follow symbolic-link children.
	 */
	async readDirectoryInside(uri: vscode.Uri): Promise<readonly [string, vscode.FileType][]> {
		const before = await this.statEntryInside(uri);
		if (before.isSymbolicLink() || !before.isDirectory()) {
			throw new Error('The vault item is not an expandable directory.');
		}
		const entries = await readdir(uri.fsPath, { withFileTypes: true });
		const after = await this.statEntryInside(uri);
		if (!after.isDirectory() || !sameFileIdentity(before, after)) {
			throw new Error('The vault directory changed while it was being read.');
		}
		return entries.map((entry) => [entry.name, direntFileType(entry)] as const);
	}

	/**
	 * Authorizes the directory entry itself for a vault mutation. Symbolic
	 * links are intentionally checked without following the final component so
	 * an in-vault link can be removed even when its target is outside the vault.
	 * The canonical parent check prevents a forged URI beneath a symlinked
	 * directory from turning a command invocation into an outside-vault delete.
	 */
	async assertMutationSource(uri: vscode.Uri, symbolicLink: boolean): Promise<void> {
		const path = this.relativePath(uri);
		if (!path) throw new Error('The item is outside the Document Vault.');
		await this.assertCanonicalParent(uri.fsPath);
		if (!symbolicLink) await this.assertExistingInside(uri);
	}

	/**
	 * Moves one authorized vault entry to the operating-system trash. Both the
	 * parent and leaf identities are captured and checked again immediately
	 * before invoking VS Code's trash-only filesystem operation. There is
	 * deliberately no permanent-delete fallback.
	 */
	async moveToTrash(
		uri: vscode.Uri,
		symbolicLink: boolean,
		isCurrent: () => boolean = () => true,
	): Promise<void> {
		await this.assertMutationSource(uri, symbolicLink);
		const parent = vscode.Uri.file(dirname(uri.fsPath));
		const parentBefore = await this.statEntryInside(parent);
		const entryBefore = await this.statEntryInside(uri);
		if (entryBefore.isSymbolicLink() !== symbolicLink) {
			throw new Error('The vault item changed before it could be moved to trash.');
		}

		await this.assertMutationSource(uri, symbolicLink);
		const parentAfter = await this.statEntryInside(parent);
		const entryAfter = await this.statEntryInside(uri);
		if (!sameFileIdentity(parentBefore, parentAfter) || !sameFileIdentity(entryBefore, entryAfter) ||
			entryAfter.isSymbolicLink() !== symbolicLink) {
			throw new Error('The vault item changed before it could be moved to trash.');
		}
		this.assertOperationCurrent(isCurrent);
		await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });
	}

	/**
	 * Resolves an image reference authored in Markdown without granting the
	 * webview direct filesystem authority. Both the note used as the relative
	 * base and the resulting file are checked lexically and again after symlink
	 * resolution. Only bounded raster files are returned; SVG remains excluded
	 * because it is an active document format rather than inert image bytes.
	 */
	async resolveLocalImage(contextPath: string, authoredPath: string, maxBytes = 20 * 1024 * 1024): Promise<vscode.Uri> {
		if (!contextPath || contextPath.includes('\0') || authoredPath.includes('\0') || /[\u0000-\u001f\u007f]/.test(authoredPath)) {
			throw new Error('The local image path is invalid.');
		}
		const trimmed = authoredPath.trim();
		if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('\\\\') || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || /^[a-z]:[\\/]/i.test(trimmed)) {
			throw new Error('The local image path is invalid.');
		}
		const pathEnd = Math.min(...[trimmed.indexOf('?'), trimmed.indexOf('#')].filter((index) => index >= 0), trimmed.length);
		let decoded: string;
		try { decoded = decodeURIComponent(trimmed.slice(0, pathEnd)).replace(/\\/g, '/'); }
		catch { throw new Error('The local image path is invalid.'); }
		if (!decoded || decoded.includes('\0')) throw new Error('The local image path is invalid.');

		const contextUri = this.uriForRelative(contextPath);
		await this.assertExistingInside(contextUri);
		const targetPath = decoded.startsWith('/')
			? resolve(this.rootUri.fsPath, `.${decoded}`)
			: resolve(dirname(contextUri.fsPath), decoded);
		const target = vscode.Uri.file(targetPath);
		if (this.relativePath(target) === undefined) throw new Error('The local image is outside the Document Vault.');
		await this.assertExistingInside(target);

		const supported = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
		if (!supported.has(extname(target.fsPath).toLowerCase())) throw new Error('The local image type is not supported.');
		const stat = await this.statEntryInside(target);
		if (stat.isSymbolicLink() || !stat.isFile()) {
			throw new Error('The local image is not a file.');
		}
		if (stat.size > maxBytes) throw new Error('The local image exceeds the size limit.');
		return target;
	}

	/**
	 * Resolves a PDF or audio wikilink without handing untrusted Markdown to the
	 * shell or operating system. Explicit paths must match exactly. A bare name
	 * may use Obsidian-style shortest-path resolution only when it identifies one
	 * unique file in a bounded vault search.
	 */
	async resolveLinkedAttachment(authoredTarget: string): Promise<vscode.Uri> {
		const normalized = normalizeOpenOnlyAttachmentTarget(authoredTarget);
		if (!normalized) throw new Error('The attachment target is not supported.');

		const direct = this.uriForRelative(normalized);
		let directExists = false;
		try {
			await this.statEntryInside(direct);
			directExists = true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			// A missing bare filename may still resolve uniquely below.
		}
		if (directExists) {
			await this.assertRegularFileInside(direct);
			return direct;
		}
		if (normalized.includes('/')) throw new Error('The attachment target was not found.');

		const candidates = await vscode.workspace.findFiles(
			new vscode.RelativePattern(this.rootUri, OPEN_ONLY_ATTACHMENT_GLOB),
			undefined,
			MAX_ATTACHMENT_SEARCH_RESULTS + 1,
		);
		if (candidates.length > MAX_ATTACHMENT_SEARCH_RESULTS) throw new Error('The attachment search limit was exceeded.');
		const wanted = normalized.toLocaleLowerCase();
		const matches = candidates.filter((candidate) => basename(candidate.fsPath).toLocaleLowerCase() === wanted);
		if (matches.length !== 1) throw new Error(matches.length ? 'The attachment target is ambiguous.' : 'The attachment target was not found.');
		await this.assertRegularFileInside(matches[0]);
		return matches[0];
	}

	/** Authorizes an existing ordinary file for navigation without following a symlink leaf. */
	async assertRegularFileInside(uri: vscode.Uri): Promise<void> {
		await this.assertExistingInside(uri);
		const stat = await this.statEntryInside(uri);
		if (stat.isSymbolicLink() || !stat.isFile()) {
			throw new Error('The attachment target is not a file.');
		}
	}

	async moveDestination(source: vscode.Uri, parent: vscode.Uri, requestedName: string): Promise<vscode.Uri> {
		this.assertWorkspaceCurrent();
		if (this.relativePath(source) === undefined || this.relativePath(parent) === undefined) {
			throw new Error('The source or destination is outside the Document Vault.');
		}
		const target = this.childPath(parent, requestedName);
		await this.assertCanonicalParent(target);
		this.assertWorkspaceCurrent();
		if (resolve(source.fsPath) === target) throw new Error('The item already has that name.');
		return vscode.Uri.file(target);
	}

	/** Applies exact directory-entry casing without following a symlink target. */
	async renameCaseOnly(source: vscode.Uri, destination: vscode.Uri, idempotent = false): Promise<void> {
		const sourcePath = this.relativePath(source);
		const destinationPath = this.relativePath(destination);
		if (!sourcePath || !destinationPath || source.fsPath === destination.fsPath ||
			source.fsPath.toLowerCase() !== destination.fsPath.toLowerCase()) {
			throw new Error('The case-only rename is invalid.');
		}
		await this.assertCanonicalParent(source.fsPath);
		await this.assertCanonicalParent(destination.fsPath);
		const parent = dirname(source.fsPath);
		if (resolve(parent) !== resolve(dirname(destination.fsPath))) {
			throw new Error('The case-only rename is invalid.');
		}
		const sourceName = basename(source.fsPath);
		const destinationName = basename(destination.fsPath);
		const entries = await readdir(parent);
		const sourceExact = entries.includes(sourceName);
		const destinationExact = entries.includes(destinationName);
		const foldedMatches = entries.filter((name) => name.toLowerCase() === sourceName.toLowerCase());
		if (sourceExact && destinationExact && sourceName !== destinationName) {
			throw new Error('An item already exists at a destination.');
		}
		if (!sourceExact) {
			if (idempotent && destinationExact && foldedMatches.length === 1) return;
			throw new Error('A source changed while the move was being prepared.');
		}
		if (foldedMatches.length !== 1) throw new Error('An item already exists at a destination.');
		await rename(source.fsPath, destination.fsPath);
		const updated = await readdir(parent);
		if (!updated.includes(destinationName) || updated.includes(sourceName)) {
			throw new Error('The workspace rejected the rename.');
		}
	}

	/** Moves a case-only rename to a collision-resistant sibling used by VS Code's native undo stack. */
	async stageCaseOnlyRename(source: vscode.Uri, destination: vscode.Uri): Promise<vscode.Uri> {
		this.assertWorkspaceCurrent();
		await this.assertCaseRenamePair(source, destination);
		const parent = dirname(source.fsPath);
		const sourceName = basename(source.fsPath);
		const destinationName = basename(destination.fsPath);
		const entries = await readdir(parent);
		if (!entries.includes(sourceName) || entries.includes(destinationName) ||
			entries.filter((name) => name.toLowerCase() === sourceName.toLowerCase()).length !== 1) {
			throw new Error('A source or destination changed while the move was being prepared.');
		}
		for (let attempt = 0; attempt < 32; attempt++) {
			const temporary = vscode.Uri.file(resolve(parent, `.mdlp-case-rename-${randomUUID()}.tmp`));
			if (entries.includes(basename(temporary.fsPath))) continue;
			this.assertWorkspaceCurrent();
			await vscode.workspace.fs.rename(source, temporary, { overwrite: false });
			try {
				await this.assertExactEntry(temporary);
			} catch (error) {
				try {
					await vscode.workspace.fs.rename(temporary, source, { overwrite: false });
					await this.assertExactEntry(source);
				} catch {
					throw new Error('Case-only staging failed and the original item could not be restored.');
				}
				throw error;
			}
			return temporary;
		}
		throw new Error('Could not allocate a temporary name for the case-only rename.');
	}

	/** Recreates the temporary source immediately before VS Code redoes its recorded rename. */
	async prepareCaseRenameRedo(source: vscode.Uri, temporary: vscode.Uri): Promise<void> {
		await this.renameSiblingExact(source, temporary, true);
	}

	/** Restores the original directory-entry casing after VS Code undoes to the temporary source. */
	async finishCaseRenameUndo(temporary: vscode.Uri, source: vscode.Uri): Promise<void> {
		await this.renameSiblingExact(temporary, source, false);
	}

	private async assertCaseRenamePair(source: vscode.Uri, destination: vscode.Uri): Promise<void> {
		const sourcePath = this.relativePath(source);
		const destinationPath = this.relativePath(destination);
		if (!sourcePath || !destinationPath || source.fsPath === destination.fsPath ||
			source.fsPath.toLowerCase() !== destination.fsPath.toLowerCase() ||
			resolve(dirname(source.fsPath)) !== resolve(dirname(destination.fsPath))) {
			throw new Error('The case-only rename is invalid.');
		}
		await this.assertCanonicalParent(source.fsPath);
		await this.assertCanonicalParent(destination.fsPath);
	}

	private async renameSiblingExact(source: vscode.Uri, destination: vscode.Uri, idempotent: boolean): Promise<void> {
		if (this.relativePath(source) === undefined || this.relativePath(destination) === undefined ||
			resolve(dirname(source.fsPath)) !== resolve(dirname(destination.fsPath))) {
			throw new Error('The staged rename is invalid.');
		}
		await this.assertCanonicalParent(source.fsPath);
		await this.assertCanonicalParent(destination.fsPath);
		const entries = await readdir(dirname(source.fsPath));
		const sourceExact = entries.includes(basename(source.fsPath));
		const destinationExact = entries.includes(basename(destination.fsPath));
		if (!sourceExact) {
			if (idempotent && destinationExact) return;
			throw new Error('The staged rename source is missing.');
		}
		if (destinationExact) throw new Error('The staged rename destination already exists.');
		await vscode.workspace.fs.rename(source, destination, { overwrite: false });
		await this.assertExactEntry(destination);
	}

	private async assertExactEntry(uri: vscode.Uri): Promise<void> {
		const entries = await readdir(dirname(uri.fsPath));
		if (!entries.includes(basename(uri.fsPath))) throw new Error('The workspace rejected the exact entry name.');
	}

	async hasExactEntry(uri: vscode.Uri): Promise<boolean> {
		if (this.relativePath(uri) === undefined) return false;
		try {
			await this.assertCanonicalParent(uri.fsPath);
			return (await readdir(dirname(uri.fsPath))).includes(basename(uri.fsPath));
		} catch {
			return false;
		}
	}

	/** Counts folder descendants without following symbolic-link directories. */
	async countDescendants(folder: vscode.Uri, limit = 10_000): Promise<{ count: number; truncated: boolean }> {
		const queue = [folder];
		let count = 0;
		while (queue.length) {
			const current = queue.shift()!;
			for (const [name, type] of await this.readDirectoryInside(current)) {
				count++;
				if (count >= limit) return { count, truncated: true };
				if ((type & vscode.FileType.Directory) && !(type & vscode.FileType.SymbolicLink)) {
					queue.push(vscode.Uri.joinPath(current, name));
				}
			}
		}
		return { count, truncated: false };
	}

	uriForRelative(relativePath: string): vscode.Uri {
		const target = resolveVaultRelativePath(this.rootUri.fsPath, relativePath, process.platform === 'win32');
		if (target === undefined) throw new Error('The item is outside the Document Vault.');
		return vscode.Uri.file(target);
	}
}

function direntFileType(entry: import('node:fs').Dirent): vscode.FileType {
	if (entry.isSymbolicLink()) return vscode.FileType.SymbolicLink;
	if (entry.isDirectory()) return vscode.FileType.Directory;
	if (entry.isFile()) return vscode.FileType.File;
	return vscode.FileType.Unknown;
}

function fileIdentity(value: Pick<Stats, 'dev' | 'ino' | 'birthtimeMs' | 'ctimeMs'>): CreatedVaultFile['identity'] {
	return {
		dev: value.dev,
		ino: value.ino,
		birthtimeMs: value.birthtimeMs,
		ctimeMs: value.ctimeMs,
	};
}

function sameFileIdentity(
	left: Pick<Stats, 'dev' | 'ino' | 'birthtimeMs' | 'ctimeMs'>,
	right: Pick<Stats, 'dev' | 'ino' | 'birthtimeMs' | 'ctimeMs'>,
): boolean {
	if (left.dev !== 0 || left.ino !== 0 || right.dev !== 0 || right.ino !== 0) {
		return left.dev === right.dev && left.ino === right.ino;
	}
	// Some Windows filesystems report zero device/inode identifiers. Creation
	// timestamps retain the replacement guard there without weakening Unix.
	return left.birthtimeMs === right.birthtimeMs && left.ctimeMs === right.ctimeMs;
}

async function removeIfSameFile(target: string, identity: Stats): Promise<void> {
	try {
		const current = await stat(target);
		if (sameFileIdentity(current, identity)) await unlink(target);
	} catch {
		// The path was already removed or replaced; never chase it during cleanup.
	}
}

async function rollbackCreatedDirectories(directories: readonly CreatedVaultDirectory[]): Promise<void> {
	for (let index = directories.length - 1; index >= 0; index--) {
		const directory = directories[index];
		try {
			const current = await lstat(directory.path);
			if (!current.isSymbolicLink() && current.isDirectory() && sameFileIdentity(current, directory.identity)) {
				// rmdir is intentionally non-recursive: concurrent user content makes
				// rollback stop safely instead of deleting anything it did not create.
				await rmdir(directory.path);
			}
		} catch {
			// The directory was removed, replaced, or became non-empty. Never chase
			// a replacement and never turn rollback into recursive deletion.
		}
	}
}
