import * as vscode from 'vscode';
import { extractVaultMetadata, MAX_INDEX_FILE_BYTES, type VaultMetadata } from './vaultMetadata';
import { boundedVaultExclusionPatterns, compileVaultExclusions, isVaultPathExcluded, type VaultExclusionMatcher } from './vaultExclusions';
import { VaultService } from './VaultService';
import { searchVaultRecords } from './vaultSearchQuery';
import { encodeVaultIndexCache, MAX_INDEX_CACHE_BYTES, validateVaultIndexCache } from './vaultIndexCache';
import { MAX_DISCOVERED_MARKDOWN_FILES, MAX_INDEXED_VAULT_NOTES, selectIndexCandidates } from './vaultIndexSelection';
import { IndexMemoryBudget, retainedIndexRecordBytes } from './indexMemoryBudget';
import { canonicalVaultRootHash, legacyVaultPathHash } from './vaultRootIdentity';

const INDEX_SCHEMA = 4;

export interface VaultIndexRecord extends VaultMetadata {
	mtime: number;
	size: number;
}

export class VaultIndex implements vscode.Disposable {
	private readonly records = new Map<string, VaultIndexRecord>();
	private readonly recordIdentityKeys = new Map<string, string>();
	private readonly identityPaths = new Map<string, string>();
	private readonly disposables: vscode.Disposable[] = [];
	private readonly changedEmitter = new vscode.EventEmitter<readonly string[]>();
	private readonly failedEmitter = new vscode.EventEmitter<unknown>();
	readonly onDidChange = this.changedEmitter.event;
	readonly onDidFail = this.failedEmitter.event;
	private persistTimer: ReturnType<typeof setTimeout> | undefined;
	private missingRecordPruneTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly missingRecordPruneParents = new Set<string>();
	private persistQueue: Promise<void> = Promise.resolve();
	private persistSequence = 0;
	private readonly documentTimers = new Map<string, {
		timer: ReturnType<typeof setTimeout>;
		document: vscode.TextDocument;
	}>();
	private readonly documentUpdates = new Map<string, Promise<void>>();
	private readonly rootHash: string;
	private readonly storageUri: vscode.Uri;
	private readonly legacyStorageUris: readonly vscode.Uri[];
	private readonly memoryBudget = new IndexMemoryBudget();
	private rebuildGeneration = 0;
	private readonly pendingRebuilds = new Set<Promise<void>>();
	private disposed = false;
	private indexingDisabled = false;
	private indexFailure: Error | undefined;
	readonly id: string;
	readonly legacyIds: readonly string[];

	constructor(
		readonly vault: VaultService,
		private readonly context: vscode.ExtensionContext,
	) {
		this.rootHash = canonicalVaultRootHash(vault.canonicalRootUri.toString());
		this.id = this.rootHash;
		const legacyPathId = legacyVaultPathHash(vault.canonicalRootPath);
		this.legacyIds = legacyPathId === this.rootHash ? [] : [legacyPathId];
		this.storageUri = vscode.Uri.joinPath(context.globalStorageUri, `vault-index-${this.rootHash}.json`);
		this.legacyStorageUris = this.legacyIds.map((id) =>
			vscode.Uri.joinPath(context.globalStorageUri, `vault-index-${id}.json`));
	}

	async initialize(): Promise<void> {
		await this.loadCache();
		let rebuildError: unknown;
		try { await this.rebuild(); }
		catch (error) { rebuildError = error; }
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(this.vault.rootUri, '**/*.{md,markdown}'),
		);
		watcher.onDidCreate((uri) => void this.updateUri(uri), undefined, this.disposables);
		watcher.onDidChange((uri) => void this.updateUri(uri), undefined, this.disposables);
		watcher.onDidDelete((uri) => this.removeUri(uri), undefined, this.disposables);
		// Markdown globs do not reliably emit descendant events when another app
		// renames a directory. Observe structural creates/deletes separately and
		// reconcile only the affected subtree; ordinary file changes stay on the
		// cheap Markdown watcher above.
		const structuralWatcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(this.vault.rootUri, '**/*'),
			false,
			true,
			false,
		);
		structuralWatcher.onDidCreate((uri) => void this.updateCreatedDirectory(uri), undefined, this.disposables);
		structuralWatcher.onDidDelete((uri) => this.removeStructuralRecords(uri), undefined, this.disposables);
		this.disposables.push(
			watcher,
			structuralWatcher,
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (this.isIndexedMarkdown(event.document.uri)) this.scheduleDocumentUpdate(event.document);
			}),
			vscode.workspace.onDidCloseTextDocument((document) => {
				const key = document.uri.toString();
				const scheduled = this.documentTimers.get(key);
				if (scheduled) clearTimeout(scheduled.timer);
				this.documentTimers.delete(key);
				if (this.isIndexedMarkdown(document.uri)) {
					void this.queueDocumentOperation(key, () => this.updateUri(document.uri));
				}
			}),
		);
		if (rebuildError) throw rebuildError;
	}

	all(): VaultIndexRecord[] {
		return [...this.records.values()];
	}

	get(relativePath: string): VaultIndexRecord | undefined {
		return this.records.get(normalize(relativePath));
	}

	search(query: string, limit = 100): VaultIndexRecord[] {
		return searchVaultRecords(this.all(), query, limit);
	}

	/** Exposed only through the non-production extension test API. */
	get cacheUri(): vscode.Uri {
		return this.storageUri;
	}

	/** Commits any pending cache update for extension-host privacy inspection. */
	async flushCache(): Promise<void> {
		if (this.persistTimer) {
			clearTimeout(this.persistTimer);
			this.persistTimer = undefined;
			await this.persist();
			return;
		}
		await this.persistQueue;
	}

	/**
	 * Commits debounced and in-flight open-document metadata before a user-facing
	 * search selects candidates. Unsaved text therefore wins deterministically
	 * even when search begins in the narrow gap between the timer firing and its
	 * asynchronous containment check completing.
	 */
	async flushDocumentUpdates(): Promise<void> {
		const scheduled = [...this.documentTimers.entries()];
		for (const [key, entry] of scheduled) {
			clearTimeout(entry.timer);
			this.documentTimers.delete(key);
			void this.runDocumentUpdate(entry.document);
		}
		await Promise.all([...this.documentUpdates.values()]);
	}

	/** Waits for complete snapshots, including a reset's asynchronous cache cleanup. */
	async waitForRebuild(signal?: AbortSignal): Promise<boolean> {
		while (!this.disposed && !signal?.aborted && this.pendingRebuilds.size > 0) {
			const settled = Promise.allSettled([...this.pendingRebuilds]);
			if (!signal) await settled;
			else await new Promise<void>((resolve) => {
				const finish = () => {
					signal.removeEventListener('abort', finish);
					resolve();
				};
				signal.addEventListener('abort', finish, { once: true });
				void settled.then(finish);
				if (signal.aborted) finish();
			});
		}
		return !this.disposed && !this.indexingDisabled && !signal?.aborted;
	}

	private trackRebuild(run: () => Promise<void>): Promise<void> {
		// Register before running so synchronous index-change listeners also see
		// the pending reset/rebuild and cannot observe a partial snapshot.
		const pending = Promise.resolve().then(run);
		this.pendingRebuilds.add(pending);
		const finished = () => { this.pendingRebuilds.delete(pending); };
		void pending.then(finished, finished);
		return pending;
	}

	/** Reads current note text on demand; content is never retained in the index or cache. */
	async readText(relativePath: string): Promise<string | undefined> {
		const record = this.get(relativePath);
		if (!record) return undefined;
		const generation = this.rebuildGeneration;
		const isCurrent = () => !this.disposed && !this.indexingDisabled
			&& generation === this.rebuildGeneration && this.get(record.path) !== undefined
			&& !this.isExcluded(record.path);
		if (!isCurrent()) return undefined;
		const uri = this.vault.uriForRelative(record.path);
		try { await this.vault.assertExistingInside(uri); }
		catch { return undefined; }
		if (!isCurrent()) return undefined;
		const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
		if (open) {
			const text = open.getText();
			return new TextEncoder().encode(text).byteLength <= MAX_INDEX_FILE_BYTES ? text : undefined;
		}
		try {
			const file = await this.vault.readFileInside(uri, MAX_INDEX_FILE_BYTES);
			if (!isCurrent()) return undefined;
			return new TextDecoder('utf-8', { fatal: true }).decode(file.bytes);
		} catch { return undefined; }
	}

	rebuild(cancellation?: vscode.CancellationToken): Promise<void> {
		const generation = ++this.rebuildGeneration;
		return this.trackRebuild(async () => {
			try {
				await this.rebuildGenerationSnapshot(generation, cancellation);
			} catch (error) {
				// Search, backlinks, tags, and aliases must never continue from a
				// cache that we could not reconcile with the current filesystem.
				if (!this.disposed && generation === this.rebuildGeneration) this.clearAfterFailedRebuild();
				throw error;
			}
		});
	}

	private async rebuildGenerationSnapshot(generation: number, cancellation?: vscode.CancellationToken): Promise<void> {
		this.indexFailure = undefined;
		throwIfCancelled(cancellation);
		const discovered = await vscode.workspace.findFiles(
			new vscode.RelativePattern(this.vault.rootUri, '**/*.{md,markdown}'),
			undefined,
			MAX_DISCOVERED_MARKDOWN_FILES + 1,
		);
		throwIfCancelled(cancellation);
		if (this.disposed || generation !== this.rebuildGeneration) return;
		const selection = selectIndexCandidates(
			discovered.slice(0, MAX_DISCOVERED_MARKDOWN_FILES).flatMap((uri) => {
				const path = this.vault.relativePath(uri);
				return path === undefined ? [] : [{ item: uri, path }];
			}),
			this.exclusions(),
			discovered.length > MAX_DISCOVERED_MARKDOWN_FILES,
		);
		if (selection.kind !== 'ok') {
			throw new Error(selection.kind === 'noteLimit'
				? 'The vault exceeds the 10,000-note indexing limit.'
				: 'The vault exceeds the 100,000-file Markdown discovery limit.');
		}
		this.indexingDisabled = false;
		const isExcluded = compileVaultExclusions(this.exclusions());
		const files = selection.candidates.map(({ item }) => item);
		const selectedPaths = new Set(selection.candidates.map(({ path }) => normalize(path)));
		// Exclusion changes and deletions can make prior cache entries ineligible.
		// Reclaim those bytes before parallel parsing so stale metadata cannot
		// falsely consume the new snapshot's aggregate memory budget.
		for (const path of this.records.keys()) {
			if (selectedPaths.has(path)) continue;
			this.deleteRecord(path);
		}
		const found = new Set<string>();
		let cursor = 0;
		let completed = 0;
		const worker = async (): Promise<void> => {
			while (!this.disposed && !this.indexingDisabled && !cancellation?.isCancellationRequested && generation === this.rebuildGeneration && cursor < files.length) {
				const uri = files[cursor++];
				const path = this.vault.relativePath(uri);
				if (path !== undefined && !isExcluded(path)) {
					found.add(normalize(path));
					await this.updateUri(uri, false, isExcluded);
				}
				completed++;
				// File reads already yield, but an in-memory/remote provider may resolve
				// synchronously. Force a cooperative yield between bounded batches.
				if (completed % 100 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
			}
		};
		await Promise.all(Array.from({ length: Math.min(16, files.length) }, () => worker()));
		throwIfCancelled(cancellation);
		if (this.indexFailure) throw this.indexFailure;
		if (this.disposed || this.indexingDisabled || generation !== this.rebuildGeneration) return;
		const removed: string[] = [];
		for (const path of this.records.keys()) {
			if (!found.has(path)) {
				this.deleteRecord(path);
				removed.push(path);
			}
		}
		if (removed.length) this.changedEmitter.fire(removed);
		this.schedulePersist();
		// `updateUri(..., false)` deliberately coalesces thousands of per-file
		// notifications during a rebuild. Emit one completion event so consumers
		// see newly included or refreshed records as well as removals.
		this.changedEmitter.fire([]);
	}

	/** Discards all rebuildable metadata and reconstructs it from current files. */
	reset(cancellation?: vscode.CancellationToken): Promise<void> {
		this.rebuildGeneration++;
		return this.trackRebuild(async () => {
			if (this.persistTimer) {
				clearTimeout(this.persistTimer);
				this.persistTimer = undefined;
			}
			const removed = [...this.records.keys()];
			this.records.clear();
			this.recordIdentityKeys.clear();
			this.identityPaths.clear();
			this.memoryBudget.clear();
			if (removed.length) this.changedEmitter.fire(removed);
			try { await vscode.workspace.fs.delete(this.storageUri, { useTrash: false }); }
			catch { /* missing or inaccessible cache is equivalent to an empty cache */ }
			for (const legacy of this.legacyStorageUris) {
				try { await vscode.workspace.fs.delete(legacy, { useTrash: false }); }
				catch { /* missing or inaccessible cache is equivalent to an empty cache */ }
			}
			await this.rebuild(cancellation);
		});
	}

	private async updateUri(uri: vscode.Uri, notify = true, exclusionMatcher?: VaultExclusionMatcher): Promise<void> {
		if (this.indexingDisabled) return;
		const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
		if (open) return this.updateDocument(open, notify, exclusionMatcher);
		const path = this.vault.relativePath(uri);
		if (path === undefined || (exclusionMatcher ? exclusionMatcher(path) : this.isExcluded(path)) || !isMarkdown(path)) return this.removeUri(uri, notify);
		try {
			const file = await this.vault.readFileInside(uri, MAX_INDEX_FILE_BYTES);
			const text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes);
			if (notify) await this.removeMissingCaseAliases(path, true);
			this.setRecord(path, text, file.mtimeMs, file.size, notify, file.identity);
		} catch {
			this.removeUri(uri, notify);
		}
	}

	private async updateDocument(document: vscode.TextDocument, notify = true, exclusionMatcher?: VaultExclusionMatcher): Promise<void> {
		if (this.indexingDisabled) return;
		const path = this.vault.relativePath(document.uri);
		if (path === undefined || (exclusionMatcher ? exclusionMatcher(path) : this.isExcluded(path)) || !isMarkdown(path)) return;
		let identity: { dev: number; ino: number; birthtimeMs: number };
		try {
			const entry = await this.vault.statEntryInside(document.uri);
			if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('The indexed note is not a regular file.');
			identity = entry;
		}
		catch { return this.removeUri(document.uri, notify); }
		const text = document.getText();
		if (new TextEncoder().encode(text).byteLength > MAX_INDEX_FILE_BYTES) return this.removeUri(document.uri);
		if (notify) await this.removeMissingCaseAliases(path, true);
		this.setRecord(path, text, Date.now(), new TextEncoder().encode(text).byteLength, notify, identity);
	}

	private async updateCreatedDirectory(uri: vscode.Uri): Promise<void> {
		if (this.disposed || this.indexingDisabled) return;
		try {
			const entry = await this.vault.statEntryInside(uri);
			if (!entry.isDirectory() || entry.isSymbolicLink()) return;
			const discovered = await vscode.workspace.findFiles(
				new vscode.RelativePattern(uri, '**/*.{md,markdown}'),
				undefined,
				MAX_DISCOVERED_MARKDOWN_FILES + 1,
			);
			if (this.disposed || this.indexingDisabled) return;
			const selection = selectIndexCandidates(
				discovered.slice(0, MAX_DISCOVERED_MARKDOWN_FILES).flatMap((candidate) => {
					const path = this.vault.relativePath(candidate);
					return path === undefined ? [] : [{ item: candidate, path }];
				}),
				this.exclusions(),
				discovered.length > MAX_DISCOVERED_MARKDOWN_FILES,
			);
			if (selection.kind !== 'ok') throw new Error(selection.kind === 'noteLimit'
				? 'The vault exceeds the 10,000-note indexing limit.'
				: 'The vault exceeds the 100,000-file Markdown discovery limit.');
			if (selection.candidates.length === 0) return;
			const isExcluded = compileVaultExclusions(this.exclusions());
			let cursor = 0;
			const workers = Array.from({ length: Math.min(16, selection.candidates.length) }, async () => {
				while (!this.disposed && !this.indexingDisabled && cursor < selection.candidates.length) {
					const candidate = selection.candidates[cursor++].item;
					await this.updateUri(candidate, false, isExcluded);
				}
			});
			await Promise.all(workers);
			if (this.disposed || this.indexingDisabled) return;
			// An older scan of an ancestor can overlap a later child deletion. Verify
			// every discovered candidate after parsing so that scan cannot resurrect
			// metadata for a note removed after its bytes were read.
			let verificationCursor = 0;
			const verificationWorkers = Array.from({ length: Math.min(16, selection.candidates.length) }, async () => {
				while (!this.disposed && !this.indexingDisabled && verificationCursor < selection.candidates.length) {
					const candidate = selection.candidates[verificationCursor++].item;
					try {
						const current = await this.vault.statEntryInside(candidate);
						if (current.isFile() && !current.isSymbolicLink()) continue;
					} catch { /* a concurrent delete or escape must remove stale metadata */ }
					this.removeUri(candidate, false);
				}
			});
			await Promise.all(verificationWorkers);
			if (this.disposed || this.indexingDisabled) return;
			// A delete/rename notification can race a subtree scan that already
			// opened one of its descendants. Re-check the directory after every
			// worker has settled so stale reads can never resurrect removed paths.
			try {
				const current = await this.vault.statEntryInside(uri);
				if (!current.isDirectory() || current.isSymbolicLink()) throw new Error('The reconciled path is no longer a directory.');
			} catch {
				this.removeDirectoryRecords(uri);
				return;
			}
			this.changedEmitter.fire([]);
			this.schedulePersist();
		} catch (error) {
			// The directory may have disappeared again before it was inspected.
			try { await this.vault.statEntryInside(uri); }
			catch {
				this.removeDirectoryRecords(uri);
				return;
			}
			this.clearAfterFailedRebuild();
			this.failedEmitter.fire(error);
		}
	}

	private removeDirectoryRecords(uri: vscode.Uri): void {
		const path = this.vault.relativePath(uri);
		if (path === undefined || path === '') return;
		const prefix = `${normalize(path)}/`;
		const removed: string[] = [];
		for (const candidate of this.records.keys()) {
			if (!candidate.startsWith(prefix)) continue;
			this.deleteRecord(candidate);
			removed.push(candidate);
		}
		if (removed.length === 0) return;
		this.changedEmitter.fire(removed);
		this.schedulePersist();
	}

	private removeStructuralRecords(uri: vscode.Uri): void {
		// Recursive deletes are provider-dependent: VS Code may report the removed
		// directory, each removed file, or both. Reconcile both possible shapes.
		this.removeUri(uri);
		this.removeDirectoryRecords(uri);
		this.scheduleMissingRecordPrune(uri);
	}

	private scheduleMissingRecordPrune(deletedUri: vscode.Uri): void {
		const deletedPath = this.vault.relativePath(deletedUri);
		if (deletedPath === undefined) return;
		const normalizedPath = normalize(deletedPath);
		const separator = normalizedPath.lastIndexOf('/');
		this.missingRecordPruneParents.add(separator < 0 ? '' : normalizedPath.slice(0, separator));
		if (this.missingRecordPruneTimer) clearTimeout(this.missingRecordPruneTimer);
		// Some providers coalesce a rapid rename followed by deletion into only
		// the old-path delete. Recheck indexed siblings after the burst settles.
		this.missingRecordPruneTimer = setTimeout(() => void this.pruneMissingRecords(), 150);
	}

	private async pruneMissingRecords(): Promise<void> {
		this.missingRecordPruneTimer = undefined;
		const parents = [...this.missingRecordPruneParents];
		this.missingRecordPruneParents.clear();
		if (this.disposed || this.indexingDisabled || parents.length === 0) return;
		const candidates = [...this.records.keys()].filter((path) => parents.some((parent) =>
			parent === '' || path.startsWith(`${parent}/`)));
		const removed: string[] = [];
		let cursor = 0;
		const workers = Array.from({ length: Math.min(16, candidates.length) }, async () => {
			while (!this.disposed && !this.indexingDisabled && cursor < candidates.length) {
				const path = candidates[cursor++];
				try {
					const current = await this.vault.statEntryInside(this.vault.uriForRelative(path));
					if (current.isFile() && !current.isSymbolicLink()) continue;
				} catch { /* missing or escaped records must be pruned */ }
				if (this.deleteRecord(path)) removed.push(path);
			}
		});
		await Promise.all(workers);
		if (this.disposed || removed.length === 0) return;
		this.changedEmitter.fire(removed);
		this.schedulePersist();
	}

	/**
	 * Case-insensitive providers can deliver a create/change event for the new
	 * spelling without a usable delete event for the old spelling. Remove only
	 * case-equivalent records whose exact directory entry is now absent. This
	 * preserves two legitimate files that differ only by case on a case-sensitive
	 * volume while preventing stale aliases, backlinks, and broken-link results.
	 */
	private async removeMissingCaseAliases(path: string, notify: boolean): Promise<void> {
		const normalizedPath = normalize(path);
		const foldedPath = foldPath(normalizedPath);
		const removed: string[] = [];
		for (const candidate of this.records.keys()) {
			if (candidate === normalizedPath || foldPath(candidate) !== foldedPath) continue;
			if (await this.vault.hasExactEntry(this.vault.uriForRelative(candidate))) continue;
			this.deleteRecord(candidate);
			removed.push(candidate);
		}
		if (removed.length === 0) return;
		if (notify) this.changedEmitter.fire(removed);
		this.schedulePersist();
	}

	private scheduleDocumentUpdate(document: vscode.TextDocument): void {
		const key = document.uri.toString();
		const existing = this.documentTimers.get(key);
		if (existing) clearTimeout(existing.timer);
		const timer = setTimeout(() => {
			this.documentTimers.delete(key);
			void this.runDocumentUpdate(document);
		}, 100);
		this.documentTimers.set(key, { timer, document });
	}

	private runDocumentUpdate(document: vscode.TextDocument): Promise<void> {
		const key = document.uri.toString();
		return this.queueDocumentOperation(key, async () => {
			if (!document.isClosed) await this.updateDocument(document);
		});
	}

	private queueDocumentOperation(key: string, run: () => Promise<void>): Promise<void> {
		const prior = this.documentUpdates.get(key) ?? Promise.resolve();
		const operation = prior.catch(() => undefined).then(run);
		this.documentUpdates.set(key, operation);
		const cleanup = () => {
			if (this.documentUpdates.get(key) === operation) this.documentUpdates.delete(key);
		};
		void operation.then(cleanup, cleanup);
		return operation;
	}

	private setRecord(
		path: string,
		text: string,
		mtime: number,
		size: number,
		notify: boolean,
		identity?: { dev: number; ino: number; birthtimeMs: number },
	): void {
		if (this.indexingDisabled) return;
		const normalizedPath = normalize(path);
		const knownIdentityPath = identity
			? this.identityPaths.get(recordIdentityKey(identity))
			: undefined;
		if (!this.records.has(normalizedPath) && !knownIdentityPath && this.records.size >= MAX_INDEXED_VAULT_NOTES) {
			const error = new Error('The vault exceeds the 10,000-note indexing limit.');
			this.clearAfterFailedRebuild();
			this.failedEmitter.fire(error);
			return;
		}
		const renamedFrom = identity ? this.prepareRecordIdentity(normalizedPath, identity) : undefined;
		let record: VaultIndexRecord;
		try {
			const metadata = extractVaultMetadata(normalizedPath, text);
			record = { ...metadata, mtime, size };
		} catch {
			// Filesystem identity remains authoritative when a renamed note becomes
			// ineligible, so its former path must not retain searchable metadata.
			// A note that crosses a size/time/parser limit must not leave stale
			// aliases, backlinks, tags, or search results in memory or the cache.
			const removed = this.deleteRecord(normalizedPath) || renamedFrom !== undefined;
			if (removed) {
				if (notify) {
					this.changedEmitter.fire(renamedFrom ? [renamedFrom, normalizedPath] : [normalizedPath]);
					this.schedulePersist();
				}
			}
			return;
		}
		if (!this.memoryBudget.tryReplace(normalizedPath, retainedIndexRecordBytes(record))) {
			const error = new Error('The vault exceeds the 128 MiB metadata indexing limit.');
			this.indexFailure = error;
			this.clearAfterFailedRebuild();
			this.failedEmitter.fire(error);
			return;
		}
		this.records.set(normalizedPath, record);
		if (notify) {
			this.changedEmitter.fire(renamedFrom ? [renamedFrom, normalizedPath] : [normalizedPath]);
			this.schedulePersist();
		}
	}

	/**
	 * A directory rename may be reported only as creates at the new descendant
	 * paths. Match those files to their prior runtime identity so stale old paths
	 * disappear without an O(vault-size) rescan for every watcher event.
	 */
	private prepareRecordIdentity(
		path: string,
		identity: { dev: number; ino: number; birthtimeMs: number },
	): string | undefined {
		const key = recordIdentityKey(identity);
		const previousKey = this.recordIdentityKeys.get(path);
		if (previousKey && previousKey !== key && this.identityPaths.get(previousKey) === path) {
			this.identityPaths.delete(previousKey);
		}
		const previousPath = this.identityPaths.get(key);
		let renamedFrom: string | undefined;
		if (previousPath && previousPath !== path) {
			this.deleteRecord(previousPath);
			renamedFrom = previousPath;
		}
		this.recordIdentityKeys.set(path, key);
		this.identityPaths.set(key, path);
		return renamedFrom;
	}

	private deleteRecord(path: string): boolean {
		const removed = this.records.delete(path);
		this.memoryBudget.delete(path);
		const key = this.recordIdentityKeys.get(path);
		this.recordIdentityKeys.delete(path);
		if (key && this.identityPaths.get(key) === path) this.identityPaths.delete(key);
		return removed;
	}

	private clearAfterFailedRebuild(): void {
		this.indexingDisabled = true;
		const removed = [...this.records.keys()];
		this.records.clear();
		this.recordIdentityKeys.clear();
		this.identityPaths.clear();
		this.memoryBudget.clear();
		if (removed.length) this.changedEmitter.fire(removed);
		this.changedEmitter.fire([]);
		this.schedulePersist();
	}

	private removeUri(uri: vscode.Uri, notify = true): void {
		const path = this.vault.relativePath(uri);
		const normalizedPath = path === undefined ? undefined : normalize(path);
		if (normalizedPath !== undefined && this.deleteRecord(normalizedPath)) {
			if (notify) {
				this.changedEmitter.fire([normalizedPath]);
				this.schedulePersist();
			}
		}
	}

	private isIndexedMarkdown(uri: vscode.Uri): boolean {
		const path = this.vault.relativePath(uri);
		return path !== undefined && isMarkdown(path) && !this.isExcluded(path);
	}

	private exclusions(): string[] {
		return boundedVaultExclusionPatterns(
			vscode.workspace.getConfiguration('mdLivePreview.vault', this.vault.rootUri).get<unknown[]>('exclude', []),
		);
	}

	private isExcluded(path: string): boolean {
		return isVaultPathExcluded(path, this.exclusions());
	}

	private async loadCache(): Promise<void> {
		if (await this.loadCacheFile(this.storageUri, this.rootHash)) return;
		for (let index = 0; index < this.legacyStorageUris.length; index++) {
			if (await this.loadCacheFile(this.legacyStorageUris[index], this.legacyIds[index])) return;
		}
	}

	private async loadCacheFile(cacheUri: vscode.Uri, expectedRootHash: string): Promise<boolean> {
		try {
			const stat = await vscode.workspace.fs.stat(cacheUri);
			if (stat.size > MAX_INDEX_CACHE_BYTES) return false;
			const bytes = await vscode.workspace.fs.readFile(cacheUri);
			if (bytes.byteLength > MAX_INDEX_CACHE_BYTES) return false;
			const records = validateVaultIndexCache(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), {
				schema: INDEX_SCHEMA,
				rootHash: expectedRootHash,
				extensionVersion: String(this.context.extension.packageJSON.version),
				exclusions: this.exclusions(),
				maxRecords: MAX_INDEXED_VAULT_NOTES,
			});
			if (!records) return false;
			for (const record of records) {
				if (this.vault.relativePath(this.vault.uriForRelative(record.path)) !== undefined && !this.isExcluded(record.path)) {
					const path = normalize(record.path);
					if (!this.memoryBudget.tryReplace(path, retainedIndexRecordBytes(record))) {
						this.records.clear();
						this.recordIdentityKeys.clear();
						this.identityPaths.clear();
						this.memoryBudget.clear();
						return false;
					}
					this.records.set(path, record);
				}
			}
			return true;
		} catch { return false; /* a missing or malformed cache is rebuilt */ }
	}

	private schedulePersist(): void {
		if (this.persistTimer) clearTimeout(this.persistTimer);
		this.persistTimer = setTimeout(() => void this.persist(), 500);
	}

	private async persist(): Promise<void> {
		this.persistTimer = undefined;
		const operation = this.persistQueue.then(() => this.persistNow());
		this.persistQueue = operation.catch(() => undefined);
		return operation;
	}

	private async persistNow(): Promise<void> {
		try {
			await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
			const encoded = encodeVaultIndexCache({
				schema: INDEX_SCHEMA,
				rootHash: this.rootHash,
				extensionVersion: String(this.context.extension.packageJSON.version),
				exclusions: this.exclusions(),
				records: this.records.values(),
			});
			if (!encoded) {
				try { await vscode.workspace.fs.delete(this.storageUri, { useTrash: false }); } catch { /* no prior cache */ }
				for (const legacy of this.legacyStorageUris) {
					try { await vscode.workspace.fs.delete(legacy, { useTrash: false }); } catch { /* no prior cache */ }
				}
				return;
			}
			const temporary = vscode.Uri.joinPath(
				this.context.globalStorageUri,
				`.${this.rootHash}.${process.pid}.${++this.persistSequence}.tmp`,
			);
			let committed = false;
			try {
				await vscode.workspace.fs.writeFile(temporary, encoded);
				await vscode.workspace.fs.rename(temporary, this.storageUri, { overwrite: true });
				committed = true;
				for (const legacy of this.legacyStorageUris) {
					try { await vscode.workspace.fs.delete(legacy, { useTrash: false }); } catch { /* migration cleanup is best-effort */ }
				}
			} finally {
				if (!committed) {
					try { await vscode.workspace.fs.delete(temporary, { useTrash: false }); } catch { /* no temporary file */ }
				}
			}
		} catch { /* the in-memory index remains usable */ }
	}

	dispose(): void {
		this.disposed = true;
		this.rebuildGeneration++;
		if (this.persistTimer) {
			clearTimeout(this.persistTimer);
			void this.persist();
		}
		if (this.missingRecordPruneTimer) clearTimeout(this.missingRecordPruneTimer);
		this.missingRecordPruneParents.clear();
		for (const disposable of this.disposables) disposable.dispose();
		for (const entry of this.documentTimers.values()) clearTimeout(entry.timer);
		this.documentTimers.clear();
		this.changedEmitter.dispose();
		this.failedEmitter.dispose();
	}
}

function isMarkdown(path: string): boolean {
	return /\.(?:md|markdown)$/i.test(path);
}

function normalize(path: string): string {
	return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function foldPath(path: string): string {
	return path.normalize('NFC').toLowerCase();
}

function recordIdentityKey(identity: { dev: number; ino: number; birthtimeMs: number }): string {
	return `${identity.dev}:${identity.ino}:${identity.birthtimeMs}`;
}

function throwIfCancelled(cancellation: vscode.CancellationToken | undefined): void {
	if (cancellation?.isCancellationRequested) throw new vscode.CancellationError();
}
