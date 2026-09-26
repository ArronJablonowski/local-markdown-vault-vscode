import type * as vscode from 'vscode';
import type { VaultService } from './VaultService';

export interface VaultMoveRequest {
	readonly source: vscode.Uri;
	readonly destination: vscode.Uri;
	readonly isFolder: boolean;
}

export interface VaultMovePolicy {
	readonly updateLinks: boolean;
	readonly exclusions: readonly string[];
}

/** Persistent identity only: editing file content must not invalidate a move. */
export interface VaultMoveIdentity {
	readonly dev: number;
	readonly ino: number;
	readonly birthtimeMs: number;
	readonly isFolder: boolean;
	readonly sourceParent?: VaultEntryIdentity;
	readonly destinationParent?: VaultEntryIdentity;
}

export type VaultEntryIdentity = Omit<VaultMoveIdentity, 'sourceParent' | 'destinationParent'>;

export interface VaultMoveExecution {
	readonly requests: readonly VaultMoveRequest[];
	readonly expectedPolicy?: VaultMovePolicy;
	readonly expectedSources?: readonly VaultMoveIdentity[];
	readonly assertCurrent: () => void;
	readonly expectRenames: (moves: readonly { source: vscode.Uri; destination: vscode.Uri }[]) => vscode.Disposable;
}

export interface VaultMoveOutcome {
	readonly applied: boolean;
	readonly policy: VaultMovePolicy;
	/** Missing identities mean a committed move cannot safely enter history. */
	readonly identities?: readonly VaultMoveIdentity[];
}

type MoveExecutor = (execution: VaultMoveExecution) => Promise<VaultMoveOutcome>;
interface HistoryEntry {
	readonly forward: readonly VaultMoveRequest[];
	readonly policy: VaultMovePolicy;
	readonly identities: readonly VaultMoveIdentity[];
	readonly execute: MoveExecutor;
}

const histories = new WeakMap<VaultService, VaultMoveHistory>();

export function vaultMoveHistoryFor(vault: VaultService): VaultMoveHistory {
	let history = histories.get(vault);
	if (!history) {
		history = new VaultMoveHistory();
		histories.set(vault, history);
	}
	return history;
}

/**
 * Session-only move history. Replays always ask the move planner to transform
 * CURRENT note contents; this class deliberately retains no document text.
 */
export class VaultMoveHistory implements vscode.Disposable {
	private readonly undoEntries: HistoryEntry[] = [];
	private readonly redoEntries: HistoryEntry[] = [];
	private readonly listeners = new Set<() => void>();
	private pending: Promise<unknown> = Promise.resolve();
	private generation = 0;
	private disposed = false;
	private busy = false;
	private readonly expectedRenames = new Map<string, number>();
	private static readonly limit = 50;

	readonly onDidChange: vscode.Event<void> = (listener, thisArgs, disposables) => {
		const bound = () => listener.call(thisArgs, undefined);
		this.listeners.add(bound);
		const disposable = { dispose: () => { this.listeners.delete(bound); } };
		disposables?.push(disposable);
		return disposable;
	};

	get isBusy(): boolean { return this.busy; }
	get canUndo(): boolean { return !this.disposed && !this.busy && this.undoEntries.length > 0; }
	get canRedo(): boolean { return !this.disposed && !this.busy && this.redoEntries.length > 0; }

	runMove(requests: readonly VaultMoveRequest[], execute: MoveExecutor): Promise<boolean> {
		if (requests.length === 0) return Promise.resolve(true);
		const forward = requests.map((request) => ({ ...request }));
		return this.enqueue(async (assertCurrent) => {
			const outcome = await execute({ requests: forward, assertCurrent, expectRenames: this.expectRenames });
			if (!outcome.applied) return false;
			// A lifecycle transition or unverifiable postcondition must not turn
			// a completed filesystem operation into a reported failed move.
			if (!this.canRecord(assertCurrent, outcome, forward.length)) return true;
			this.redoEntries.length = 0;
			this.undoEntries.push(this.entry(forward, execute, outcome));
			if (this.undoEntries.length > VaultMoveHistory.limit) this.undoEntries.shift();
			return true;
		});
	}

	undo(): Promise<boolean> { return this.replay(this.undoEntries, this.redoEntries, true); }
	redo(): Promise<boolean> { return this.replay(this.redoEntries, this.undoEntries, false); }

	/** Ignore only our exact active native resource edits, never every busy event. */
	observeRenames(files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[]): void {
		if (files.some(({ oldUri, newUri }) => !this.expectedRenames.has(renameKey(oldUri, newUri)))) this.clear();
	}

	clear(): void {
		this.generation++;
		this.undoEntries.length = 0;
		this.redoEntries.length = 0;
		this.emitChange();
	}

	dispose(): void {
		this.disposed = true;
		this.clear();
		this.listeners.clear();
	}

	private replay(source: HistoryEntry[], destination: HistoryEntry[], inverse: boolean): Promise<boolean> {
		return this.enqueue(async (assertCurrent) => {
			const entry = source.at(-1);
			if (!entry) return false;
			const requests = inverse
				? entry.forward.map(({ source, destination, isFolder }) => ({ source: destination, destination: source, isFolder }))
				: entry.forward;
			const outcome = await entry.execute({
				requests, expectedPolicy: entry.policy, expectedSources: entry.identities, assertCurrent,
				expectRenames: this.expectRenames,
			});
			if (!outcome.applied) return false;
			if (!this.canRecord(assertCurrent, outcome, requests.length)) return true;
			source.pop();
			destination.push(this.entry(entry.forward, entry.execute, outcome));
			return true;
		});
	}

	private canRecord(assertCurrent: () => void, outcome: VaultMoveOutcome, count: number): boolean {
		try { assertCurrent(); }
		catch { return false; }
		if (outcome.identities?.length !== count) {
			this.clear();
			return false;
		}
		return true;
	}

	private entry(forward: readonly VaultMoveRequest[], execute: MoveExecutor, outcome: VaultMoveOutcome): HistoryEntry {
		return {
			forward, execute,
			policy: { updateLinks: outcome.policy.updateLinks, exclusions: [...outcome.policy.exclusions] },
			identities: outcome.identities!.map((identity) => ({
				...identity,
				sourceParent: identity.sourceParent && { ...identity.sourceParent },
				destinationParent: identity.destinationParent && { ...identity.destinationParent },
			})),
		};
	}

	private enqueue(operation: (assertCurrent: () => void) => Promise<boolean>): Promise<boolean> {
		// Capture at enqueue time so clearing history also cancels work not yet started.
		const generation = this.generation;
		const assertCurrent = () => {
			if (this.disposed || generation !== this.generation) {
				throw new Error('Vault move history changed before the operation completed.');
			}
		};
		const next = this.pending.then(async () => {
			assertCurrent();
			this.busy = true;
			this.emitChange();
			try { return await operation(assertCurrent); }
			finally { this.busy = false; this.emitChange(); }
		});
		this.pending = next.catch(() => undefined);
		return next;
	}

	private emitChange(): void {
		for (const listener of this.listeners) {
			try { listener(); } catch { /* UI observers cannot invalidate a file operation. */ }
		}
	}

	private readonly expectRenames = (moves: readonly { source: vscode.Uri; destination: vscode.Uri }[]): vscode.Disposable => {
		// Reference counts keep overlapping exact event exemptions alive until every owner exits.
		const keys = moves.map(({ source, destination }) => renameKey(source, destination));
		for (const key of keys) this.expectedRenames.set(key, (this.expectedRenames.get(key) ?? 0) + 1);
		return { dispose: () => {
			for (const key of keys) {
				const count = (this.expectedRenames.get(key) ?? 0) - 1;
				if (count <= 0) this.expectedRenames.delete(key);
				else this.expectedRenames.set(key, count);
			}
		} };
	};
}

function renameKey(source: vscode.Uri, destination: vscode.Uri): string {
	return JSON.stringify([source.toString(), destination.toString()]);
}
