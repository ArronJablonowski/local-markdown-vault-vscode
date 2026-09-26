import * as vscode from 'vscode';
import type { Stats } from 'node:fs';
import { dirname } from 'node:path';
import { rewriteLinksForMoves, type VaultMove } from './linkRewrite';
import { VaultService } from './VaultService';
import { assignWikiTargets, assertIndependentMoves, minimalTextReplacement } from './vaultMovePlan';
import { MAX_DISCOVERED_MARKDOWN_FILES, MAX_INDEXED_VAULT_NOTES, selectIndexCandidates } from './vaultIndexSelection';
import { CaseRenameCoordinator, caseRenameCoordinatorFor, type StagedCaseRename } from './CaseRenameCoordinator';
import {
	vaultMoveHistoryFor, type VaultEntryIdentity, type VaultMoveExecution,
	type VaultMoveIdentity, type VaultMoveOutcome, type VaultMovePolicy, type VaultMoveRequest,
} from './VaultMoveHistory';

const MAX_REWRITE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_REWRITE_TOTAL_BYTES = 200 * 1024 * 1024;

interface FileSnapshot {
	readonly uri: vscode.Uri;
	readonly mtime: number;
	readonly size: number;
	readonly type: vscode.FileType;
	readonly dev: number;
	readonly ino: number;
	readonly birthtimeMs: number;
	readonly ctimeMs: number;
}

interface LinkRewriteServiceOptions {
	readonly caseRenames?: CaseRenameCoordinator;
	readonly applyEdit?: (edit: vscode.WorkspaceEdit) => Thenable<boolean>;
	/** Production lifecycle guard; stale vault generations must not commit. */
	readonly isCurrent?: () => boolean;
	/** Development-test seam used to prove optimistic-concurrency failures are atomic. */
	readonly beforePreconditionCheck?: () => Thenable<void>;
	/** Development-test seam for the final case-only staging boundary. */
	readonly beforeCaseRenameStage?: () => Thenable<void>;
}

export type VaultTransactionConflictKind = 'source' | 'linkedDocument' | 'destination' | 'sourceOrDestination';

/**
 * A fail-closed optimistic-concurrency error whose only contextual data is an
 * already validated vault-relative path. UI callers can identify the file a
 * user must review without exposing an absolute provider path or file content.
 */
export class VaultTransactionConflictError extends Error {
	constructor(
		readonly conflictKind: VaultTransactionConflictKind,
		readonly affectedPath: string,
		readonly secondaryAffectedPath?: string,
	) {
		super(conflictKind === 'source'
			? 'A source changed while the move was being prepared.'
			: conflictKind === 'destination'
				? 'A destination changed while the move was being prepared.'
				: conflictKind === 'sourceOrDestination'
					? 'A source or destination changed while the move was being prepared.'
				: 'A linked document changed while the move was being prepared.');
		this.name = 'VaultTransactionConflictError';
	}
}

export class LinkRewriteService {
	private readonly caseRenames: CaseRenameCoordinator;
	private readonly applyEdit: (edit: vscode.WorkspaceEdit) => Thenable<boolean>;
	private readonly isCurrent: () => boolean;
	private readonly beforePreconditionCheck?: () => Thenable<void>;
	private readonly beforeCaseRenameStage?: () => Thenable<void>;

	constructor(
		private readonly vault: VaultService,
		options: LinkRewriteServiceOptions = {},
	) {
		this.caseRenames = options.caseRenames ?? caseRenameCoordinatorFor(vault);
		this.applyEdit = options.applyEdit ?? ((edit) => vscode.workspace.applyEdit(edit));
		this.isCurrent = options.isCurrent ?? (() => true);
		this.beforePreconditionCheck = options.beforePreconditionCheck;
		this.beforeCaseRenameStage = options.beforeCaseRenameStage;
	}

	async renameOrMove(source: vscode.Uri, destination: vscode.Uri, isFolder: boolean): Promise<boolean> {
		return this.renameOrMoveMany([{ source, destination, isFolder }]);
	}

	async renameOrMoveMany(
		requests: readonly VaultMoveRequest[],
	): Promise<boolean> {
		if (requests.length === 0) return true;
		if (requests.length > 256) throw new Error('At most 256 vault items can be moved at once.');
		return vaultMoveHistoryFor(this.vault).runMove(requests, (execution) => {
			if (!execution.expectedSources) return this.executeMove(execution);
			// A drag's CancellationToken only authorizes that original gesture.
			// Replays use their own history-generation/trust/workspace guards, not
			// a token that VS Code may have canceled after a successful drop.
			return new LinkRewriteService(this.vault, {
				caseRenames: this.caseRenames,
				applyEdit: this.applyEdit,
				beforePreconditionCheck: this.beforePreconditionCheck,
				beforeCaseRenameStage: this.beforeCaseRenameStage,
			}).executeMove(execution);
		});
	}

	private async executeMove(execution: VaultMoveExecution): Promise<VaultMoveOutcome> {
		const { requests } = execution;
		const policy = this.movePolicy();
		const assertCurrent = () => {
			this.assertCurrent();
			execution.assertCurrent();
			if (!samePolicy(policy, this.movePolicy()) || (execution.expectedPolicy && !samePolicy(policy, execution.expectedPolicy))) {
				throw new Error('Vault link-update settings changed. Move the items normally instead of using this history.');
			}
		};
		assertCurrent();
		if (execution.expectedSources && execution.expectedSources.length !== requests.length) {
			throw new Error('Vault move history is incomplete. Move the items normally instead of using this history.');
		}
		const plans = requests.map(({ source, destination, isFolder }) => {
			const oldPath = this.vault.relativePath(source);
			const newPath = this.vault.relativePath(destination);
			if (!oldPath || !newPath) throw new Error('Every move must remain inside the Document Vault.');
			return {
				source,
				destination,
				move: { oldPath, newPath, isFolder } satisfies VaultMove,
				caseSpelling: source.fsPath !== destination.fsPath &&
					source.fsPath.toLowerCase() === destination.fsPath.toLowerCase(),
			};
		});
		assertIndependentMoves(plans.map((plan) => plan.move));
		const sourceStats = await Promise.all(plans.map((plan) => this.vault.statEntryInside(plan.source)));
		if (execution.expectedSources && (await Promise.all(plans.map((plan) => this.vault.hasExactEntry(plan.source)))).some((exists) => !exists)) {
			throw new Error('A vault move endpoint was replaced or changed. Move the items normally instead of using this history.');
		}
		const parents = await Promise.all(plans.map(async (plan, index) => {
			const source = vscode.Uri.file(dirname(plan.source.fsPath));
			const destination = vscode.Uri.file(dirname(plan.destination.fsPath));
			const before = await this.vault.statEntryInside(source);
			const after = await this.vault.statEntryInside(destination);
			const expected = execution.expectedSources?.[index];
			if (!ordinaryDirectory(before) || !ordinaryDirectory(after)
				|| (!sourceStats[index].isSymbolicLink() && sourceStats[index].isDirectory() !== plan.move.isFolder)
				|| (expected && (!samePersistentIdentity(sourceStats[index], expected)
					|| !expected.destinationParent || !samePersistentIdentity(before, expected.destinationParent)
					|| !expected.sourceParent || !samePersistentIdentity(after, expected.sourceParent)))) {
				throw new Error('A vault move endpoint was replaced or changed. Move the items normally instead of using this history.');
			}
			return { source, destination, before, after };
		}));
		const assertParentsCurrent = async () => {
			for (const parent of parents) {
				if (!sameOperationIdentity(await this.vault.statEntryInside(parent.source), parent.before, Boolean(execution.expectedSources))
					|| !sameOperationIdentity(await this.vault.statEntryInside(parent.destination), parent.after, Boolean(execution.expectedSources))) {
					throw new Error('A vault move endpoint was replaced or changed. Move the items normally instead of using this history.');
				}
			}
		};
		const caseOnlyAliases = await Promise.all(plans.map((plan, index) =>
			plan.caseSpelling
				? this.vault.aliasesEntry(plan.destination, sourceStats[index])
				: Promise.resolve(false),
		));
		const resolvedPlans = plans.map((plan, index) => ({ ...plan, caseOnly: caseOnlyAliases[index] }));
		for (let index = 0; index < resolvedPlans.length; index++) {
			const plan = resolvedPlans[index];
			await this.vault.assertMutationSource(
				plan.source,
				sourceStats[index].isSymbolicLink(),
			);
			if (!plan.caseOnly && await this.existsInside(plan.destination)) throw new Error('An item already exists at a destination.');
		}
		const edit = new vscode.WorkspaceEdit();
		const versions = new Map<string, number>();
		const fileSnapshots = new Map<string, FileSnapshot>();
		if (policy.updateLinks) await this.addLinkEdits(
			edit,
			resolvedPlans.map((plan) => plan.move),
			versions,
			fileSnapshots,
			policy.exclusions,
		);
		await this.beforePreconditionCheck?.();
		for (let index = 0; index < resolvedPlans.length; index++) {
			const current = await this.vault.statEntryInside(resolvedPlans[index].source);
			const original = sourceStats[index];
			if (!sameEntrySnapshot(current, original)) {
				throw new VaultTransactionConflictError('source', resolvedPlans[index].move.oldPath);
			}
		}
		this.assertDocumentVersionsCurrent(versions);
		for (const [uriString, snapshot] of fileSnapshots) {
			const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === uriString);
			if (document && !versions.has(uriString)) {
				throw new VaultTransactionConflictError('linkedDocument', this.relativeConflictPath(snapshot.uri));
			}
			let current: Stats;
			try { current = await this.vault.statEntryInside(snapshot.uri); }
			catch { throw new VaultTransactionConflictError('linkedDocument', this.relativeConflictPath(snapshot.uri)); }
			if (!sameFileSnapshot(current, snapshot)) {
				throw new VaultTransactionConflictError('linkedDocument', this.relativeConflictPath(snapshot.uri));
			}
		}
		for (const plan of resolvedPlans) {
			if (!plan.caseOnly && await this.existsInside(plan.destination)) {
				throw new VaultTransactionConflictError('destination', plan.move.newPath);
			}
		}
		const stagedCaseRenames: StagedCaseRename[] = [];
		const assertSourceIdentitiesCurrent = async () => {
			for (let index = 0; index < resolvedPlans.length; index++) {
				const plan = resolvedPlans[index];
				const endpoint = stagedCaseRenames.find((staged) => staged.source.toString() === plan.source.toString())?.temporary ?? plan.source;
				const conflict = () => new VaultTransactionConflictError(
					plan.caseOnly ? 'sourceOrDestination' : 'source',
					plan.move.oldPath,
					plan.caseOnly ? plan.move.newPath : undefined,
				);
				let current: Stats;
				try { current = await this.vault.statEntryInside(endpoint); }
				catch { throw conflict(); }
				if (!sameOperationIdentity(current, sourceStats[index], Boolean(execution.expectedSources))) throw conflict();
			}
		};
		try {
			await this.saveDirtyCaseRenameSources(resolvedPlans);
			if (resolvedPlans.some((plan) => plan.caseOnly)) await this.beforeCaseRenameStage?.();
			// Saving can invoke formatters or other save participants. Do not stage
			// a rename with text replacements computed against their older source.
			this.assertDocumentVersionsCurrent(versions);
			await assertParentsCurrent();
			await assertSourceIdentitiesCurrent();
			assertCurrent();
			for (const plan of resolvedPlans) {
				if (plan.caseOnly) {
					let temporary: vscode.Uri;
					try {
						temporary = await this.vault.stageCaseOnlyRename(plan.source, plan.destination, () => { assertCurrent(); return true; });
					} catch (error) {
						if (error instanceof Error && error.message === 'A source or destination changed while the move was being prepared.') {
							throw new VaultTransactionConflictError(
								'sourceOrDestination',
								plan.move.oldPath,
								plan.move.newPath,
							);
						}
						throw error;
					}
					stagedCaseRenames.push({ source: plan.source, temporary, destination: plan.destination });
					edit.renameFile(temporary, plan.destination, { overwrite: false, ignoreIfExists: false });
				} else {
					edit.renameFile(plan.source, plan.destination, { overwrite: false, ignoreIfExists: false });
				}
			}
			const replayRequests = requests.map((request) => ({ ...request }));
			this.caseRenames.register(stagedCaseRenames, () => this.renameOrMoveMany(replayRequests));
			await assertParentsCurrent();
			await assertSourceIdentitiesCurrent();
			assertCurrent();
			// Staging awaits filesystem operations while the user can still type.
			// Recheck synchronously at the final native-edit handoff, rolling any
			// staged paths back if that invalidated the prepared text offsets.
			this.assertDocumentVersionsCurrent(versions);
			const expectedRenames = execution.expectRenames(resolvedPlans.flatMap((plan) => {
				const source = stagedCaseRenames.find((staged) => staged.source.toString() === plan.source.toString())?.temporary ?? plan.source;
				const expected = [{ source, destination: plan.destination }];
				// On case-insensitive providers VS Code may canonicalize the event
				// destination to the already validated ORIGINAL spelling. Accept
				// only these two exact spellings of this specific staged operation;
				// enforceCaseRenamePostconditions still verifies requested casing.
				if (plan.caseOnly) expected.push({ source, destination: plan.source });
				return expected;
			}));
			let applied: boolean;
			try { applied = await this.applyEdit(edit); }
			finally { expectedRenames.dispose(); }
			if (!applied) {
				this.caseRenames.unregister(stagedCaseRenames);
				await this.rollbackCaseRenames(stagedCaseRenames);
			} else {
				await this.enforceCaseRenamePostconditions(stagedCaseRenames);
				if (!await this.caseRenames.finishForward(stagedCaseRenames)) {
					throw new Error('The workspace rejected the requested filename casing.');
				}
			}
			// Recording is best-effort after a committed operation. Never report
			// an already successful move as failed because its history is unsafe.
			let identities: VaultMoveIdentity[] | undefined;
			if (applied) {
				try {
					identities = await Promise.all(resolvedPlans.map(async (plan, index) => {
						const current = await this.vault.statEntryInside(plan.destination);
						if (current.isSymbolicLink() || (!current.isFile() && !current.isDirectory())
							|| !samePersistentIdentity(current, persistentIdentity(sourceStats[index]))) throw new Error('Unverifiable moved entry.');
						return {
							...persistentIdentity(current),
							sourceParent: persistentIdentity(parents[index].before),
							destinationParent: persistentIdentity(parents[index].after),
						};
					}));
				} catch { identities = undefined; }
			}
			return { applied, policy, identities };
		} catch (error) {
			this.caseRenames.unregister(stagedCaseRenames);
			await this.rollbackCaseRenames(stagedCaseRenames);
			throw error;
		}
	}

	/**
	 * Case-only staging is intentionally performed below VS Code's resource-edit
	 * layer so the native undo operation has a distinct temporary endpoint. VS
	 * Code can otherwise mark an open dirty source clean without persisting its
	 * buffer. Make those bytes durable before staging, or abort the move.
	 */
	private async saveDirtyCaseRenameSources(plans: readonly {
		source: vscode.Uri;
		caseOnly: boolean;
	}[]): Promise<void> {
		for (const plan of plans) {
			if (!plan.caseOnly) continue;
			this.assertCurrent();
			const document = vscode.workspace.textDocuments.find(
				(candidate) => candidate.uri.toString() === plan.source.toString(),
			);
			if (document?.isDirty && (!await document.save() || document.isDirty)) {
				throw new Error('The open note could not be saved before applying its case-only rename.');
			}
		}
	}

	private assertCurrent(): void {
		this.vault.assertWorkspaceCurrent();
		if (vscode.workspace.isTrusted === false) throw new Error('Trust this workspace to move Document Vault files.');
		if (!this.isCurrent()) throw new Error('The Document Vault changed before the move could be applied.');
	}

	private movePolicy(): VaultMovePolicy {
		const configuration = vscode.workspace.getConfiguration('mdLivePreview.vault', this.vault.rootUri);
		return {
			updateLinks: configuration.get<boolean>('updateLinksOnMove', true),
			exclusions: [...configuration.get<string[]>('exclude', [])],
		};
	}

	private assertDocumentVersionsCurrent(versions: ReadonlyMap<string, number>): void {
		for (const [uriString, version] of versions) {
			const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === uriString);
			if (!document || document.version !== version) {
				throw new VaultTransactionConflictError('linkedDocument', this.relativeConflictPath(vscode.Uri.parse(uriString)));
			}
		}
	}

	/**
	 * VS Code can report a temporary-to-destination resource edit as successful
	 * while restoring an open document's original spelling on a case-insensitive
	 * filesystem. Enforce the requested directory-entry spelling before success
	 * is observable; the coordinator repeats this check after native redo.
	 */
	private async enforceCaseRenamePostconditions(plans: readonly StagedCaseRename[]): Promise<void> {
		for (const plan of plans) {
			if (await this.vault.hasExactEntry(plan.destination)) continue;
			if (!await this.vault.hasExactEntry(plan.source)) {
				throw new Error('The workspace did not leave the case-only rename at a safe endpoint.');
			}
			await this.vault.renameCaseOnly(plan.source, plan.destination, true);
			if (!await this.vault.hasExactEntry(plan.destination)) {
				throw new Error('The workspace rejected the requested filename casing.');
			}
		}
	}

	private async existsInside(uri: vscode.Uri): Promise<boolean> {
		try {
			await this.vault.statEntryInside(uri);
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
			throw error;
		}
	}

	private relativeConflictPath(uri: vscode.Uri): string {
		const path = this.vault.relativePath(uri);
		// Every caller obtained this URI from a previously authorized vault scan.
		// If that invariant is broken, do not surface an absolute fallback.
		return path || '(unknown vault item)';
	}

	private async rollbackCaseRenames(plans: readonly {
		source: vscode.Uri;
		destination: vscode.Uri;
		temporary: vscode.Uri;
	}[]): Promise<void> {
		for (const plan of [...plans].reverse()) {
			if (await this.vault.hasExactEntry(plan.temporary)) {
				await this.vault.finishCaseRenameUndo(plan.temporary, plan.source);
			} else if (await this.vault.hasExactEntry(plan.destination)) {
				await this.vault.renameCaseOnly(plan.destination, plan.source, true);
			}
		}
	}

	private async addLinkEdits(
		edit: vscode.WorkspaceEdit,
		moves: readonly VaultMove[],
		versions: Map<string, number>,
		fileSnapshots: Map<string, FileSnapshot>,
		exclusions: readonly string[],
	): Promise<void> {
		const discovered = await vscode.workspace.findFiles(
			new vscode.RelativePattern(this.vault.rootUri, '**/*.{md,markdown}'),
			'{**/.git/**,**/node_modules/**}',
			MAX_DISCOVERED_MARKDOWN_FILES + 1,
		);
		const selection = selectIndexCandidates(
			discovered.slice(0, MAX_DISCOVERED_MARKDOWN_FILES).flatMap((uri) => {
				const path = this.vault.relativePath(uri);
				return path === undefined ? [] : [{ item: uri, path }];
			}),
			exclusions,
			discovered.length > MAX_DISCOVERED_MARKDOWN_FILES,
		);
		if (selection.kind !== 'ok') {
			throw new Error(selection.kind === 'noteLimit'
				? 'Automatic link updates are limited to 10,000 non-excluded Markdown files.'
				: 'Automatic link updates are disabled when more than 100,000 Markdown files are discovered.');
		}
		const files = selection.candidates.map(({ item }) => item);
		const visiblePaths = selection.candidates.map(({ path }) => path);
		const plannedMoves = assignWikiTargets(moves, visiblePaths);
		let totalBytes = 0;
		for (const uri of files) {
			const sourcePath = this.vault.relativePath(uri);
			if (sourcePath === undefined) continue;
			await this.vault.assertExistingInside(uri);
			const stat = await this.vault.statEntryInside(uri);
			if (stat.isSymbolicLink() || !stat.isFile()) {
				throw new Error('A Markdown link source is not a regular vault file.');
			}
			let snapshot = fileSnapshot(uri, stat);
			const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === uri.toString());
			if (document) versions.set(uri.toString(), document.version);
			let original: string;
			if (document) {
				original = document.getText();
			} else {
				try {
					const file = await this.vault.readFileInside(uri, MAX_REWRITE_FILE_BYTES);
					original = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes);
					snapshot = fileSnapshotFromRead(uri, file);
				} catch {
					throw new Error('A Markdown file could not be decoded safely for automatic link updates.');
				}
			}
			const contentBytes = new TextEncoder().encode(original).byteLength;
			if (contentBytes > MAX_REWRITE_FILE_BYTES) {
				throw new Error('A Markdown file is too large for a safe automatic link update.');
			}
			totalBytes += contentBytes;
			if (totalBytes > MAX_REWRITE_TOTAL_BYTES) {
				throw new Error('The vault is too large for a safe automatic link update.');
			}
			fileSnapshots.set(uri.toString(), snapshot);
			const rewrite = rewriteLinksForMoves(original, sourcePath, plannedMoves);
			const rewritten = rewrite.text;
			const replacement = minimalTextReplacement(original, rewritten);
			if (replacement) {
				edit.replace(uri, new vscode.Range(
					document?.positionAt(replacement.from) ?? positionAt(original, replacement.from),
					document?.positionAt(replacement.to) ?? positionAt(original, replacement.to),
				), replacement.text);
			}
		}
	}

}

function samePolicy(actual: VaultMovePolicy, expected: VaultMovePolicy): boolean {
	return actual.updateLinks === expected.updateLinks && JSON.stringify(actual.exclusions) === JSON.stringify(expected.exclusions);
}

function ordinaryDirectory(stat: Stats): boolean {
	return stat.isDirectory() && !stat.isSymbolicLink();
}

function persistentIdentity(stat: Stats): VaultEntryIdentity {
	return { dev: stat.dev, ino: stat.ino, birthtimeMs: stat.birthtimeMs, isFolder: stat.isDirectory() };
}

function sameOperationIdentity(actual: Stats, expected: Stats, replay: boolean): boolean {
	return replay ? samePersistentIdentity(actual, persistentIdentity(expected))
		: actual.isSymbolicLink() === expected.isSymbolicLink()
			&& actual.isFile() === expected.isFile() && actual.isDirectory() === expected.isDirectory()
			&& sameIdentity(actual, expected);
}

function samePersistentIdentity(actual: Stats, expected: VaultEntryIdentity): boolean {
	if (actual.isSymbolicLink() || actual.isDirectory() !== expected.isFolder
		|| (!actual.isDirectory() && !actual.isFile())) return false;
	if (actual.dev !== 0 || actual.ino !== 0 || expected.dev !== 0 || expected.ino !== 0) {
		return actual.dev === expected.dev && actual.ino === expected.ino && actual.birthtimeMs === expected.birthtimeMs;
	}
	// Birthtime alone is not a reliable unique capability on all providers.
	// Refuse to replay rather than moving an unrelated replacement entry.
	return false;
}

function sameFileSnapshot(actual: Stats, expected: FileSnapshot): boolean {
	return actual.mtimeMs === expected.mtime && actual.size === expected.size &&
		actual.isFile() && expected.type === vscode.FileType.File && sameIdentity(actual, expected);
}

function sameEntrySnapshot(actual: Stats, expected: Stats): boolean {
	return actual.mtimeMs === expected.mtimeMs && actual.size === expected.size &&
		actual.isFile() === expected.isFile() && actual.isDirectory() === expected.isDirectory() &&
		actual.isSymbolicLink() === expected.isSymbolicLink() && sameIdentity(actual, expected);
}

function sameIdentity(
	actual: Pick<Stats, 'dev' | 'ino' | 'birthtimeMs' | 'ctimeMs'>,
	expected: Pick<Stats, 'dev' | 'ino' | 'birthtimeMs' | 'ctimeMs'>,
): boolean {
	if (actual.dev !== 0 || actual.ino !== 0 || expected.dev !== 0 || expected.ino !== 0) {
		return actual.dev === expected.dev && actual.ino === expected.ino;
	}
	return actual.birthtimeMs === expected.birthtimeMs && actual.ctimeMs === expected.ctimeMs;
}

function fileSnapshot(uri: vscode.Uri, stat: Stats): FileSnapshot {
	return {
		uri,
		mtime: stat.mtimeMs,
		size: stat.size,
		type: vscode.FileType.File,
		dev: stat.dev,
		ino: stat.ino,
		birthtimeMs: stat.birthtimeMs,
		ctimeMs: stat.ctimeMs,
	};
}

function fileSnapshotFromRead(
	uri: vscode.Uri,
	file: Awaited<ReturnType<VaultService['readFileInside']>>,
): FileSnapshot {
	return {
		uri,
		mtime: file.mtimeMs,
		type: vscode.FileType.File,
		...file.identity,
		size: file.size,
	};
}

function positionAt(text: string, offset: number): vscode.Position {
	const bounded = Math.max(0, Math.min(offset, text.length));
	let line = 0;
	let lineStart = 0;
	for (let index = 0; index < bounded; index++) {
		if (text.charCodeAt(index) === 10) {
			line++;
			lineStart = index + 1;
		}
	}
	return new vscode.Position(line, bounded - lineStart);
}
