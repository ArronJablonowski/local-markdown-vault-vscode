import * as vscode from 'vscode';
import type { VaultService } from './VaultService';

export interface StagedCaseRename {
	readonly source: vscode.Uri;
	readonly temporary: vscode.Uri;
	readonly destination: vscode.Uri;
}

interface CaseRenameTransaction {
	readonly plans: readonly StagedCaseRename[];
	readonly replay?: () => Promise<boolean>;
	state: 'forward' | 'undone' | 'replaying' | 'retired';
	preparedTabs?: Map<string, RetargetTab[]>;
}

const coordinators = new WeakMap<VaultService, CaseRenameCoordinator>();
const activeCoordinators = new Set<CaseRenameCoordinator>();
const undoneTransactions: Array<{ coordinator: CaseRenameCoordinator; transaction: CaseRenameTransaction }> = [];

export function caseRenameCoordinatorFor(vault: VaultService): CaseRenameCoordinator {
	let coordinator = coordinators.get(vault);
	if (!coordinator) {
		coordinator = new CaseRenameCoordinator(vault);
		coordinators.set(vault, coordinator);
		activeCoordinators.add(coordinator);
	}
	return coordinator;
}

export function disposeCaseRenameCoordinators(): void {
	for (const coordinator of activeCoordinators) coordinator.dispose();
	activeCoordinators.clear();
}

/** Restages an undone case-only transaction before VS Code executes its native redo. */
export async function executeCaseAwareRedo(run: () => Thenable<unknown>): Promise<void> {
	const entry = [...undoneTransactions].reverse().find(({ transaction }) => transaction.state === 'undone');
	if (!entry) {
		await run();
		return;
	}
	if (entry.transaction.replay) {
		await entry.coordinator.replayTransaction(entry.transaction);
		return;
	}
	await entry.coordinator.prepareTransactionRedo(entry.transaction);
	try {
		await run();
	} catch (error) {
		await entry.coordinator.rollbackPreparedRedo(entry.transaction);
		throw error;
	}
	if (await entry.coordinator.finishForward(entry.transaction.plans)) {
		await completeRedo(entry);
		return;
	}
	await entry.coordinator.rollbackPreparedRedo(entry.transaction);
}

async function completeRedo(entry: { coordinator: CaseRenameCoordinator; transaction: CaseRenameTransaction }): Promise<void> {
	entry.transaction.state = 'forward';
	const index = undoneTransactions.indexOf(entry);
	if (index >= 0) undoneTransactions.splice(index, 1);
	updateRedoContext();
	await entry.coordinator.completePreparedRedo(entry.transaction);
}

/**
 * Bridges VS Code's file-operation undo stack with case-only renames.
 *
 * A case-insensitive provider treats `Name.md -> name.md` as the same resource,
 * so the resource edit's generated inverse is a no-op. The forward operation is
 * instead recorded as `unique-temporary -> name.md`. After its native undo
 * restores the temporary entry, we immediately put the original casing back.
 * Redo normally runs the original validated vault operation again as a fresh
 * WorkspaceEdit. That avoids VS Code canonicalizing its recorded case-only URI
 * back to the old spelling, while retaining one-step undo and current-content
 * link planning. The older native-restaging path remains as a fallback for a
 * transaction registered without a replay operation.
 */
export class CaseRenameCoordinator implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[];
	private readonly transactions = new Map<string, CaseRenameTransaction>();
	private pending: Promise<void> = Promise.resolve();

	constructor(private readonly vault: VaultService) {
		this.disposables = [
			vscode.workspace.onDidChangeTextDocument(invalidateCaseRenameRedoHistory),
			vscode.workspace.onDidCreateFiles(invalidateCaseRenameRedoHistory),
			vscode.workspace.onDidDeleteFiles(invalidateCaseRenameRedoHistory),
			vscode.workspace.onDidRenameFiles((event) => {
				invalidateCaseRenameRedoHistory();
				this.finishUndo(event);
			}),
		];
	}

	register(plans: readonly StagedCaseRename[], replay?: () => Promise<boolean>): void {
		if (plans.length === 0) return;
		const transaction: CaseRenameTransaction = { plans: [...plans], replay, state: 'forward' };
		for (const plan of plans) this.transactions.set(plan.temporary.toString(), transaction);
	}

	unregister(plans: readonly StagedCaseRename[]): void {
		for (const plan of plans) {
			const transaction = this.transactions.get(plan.temporary.toString());
			this.transactions.delete(plan.temporary.toString());
			if (transaction) removeUndone(this, transaction);
		}
	}

	async settle(): Promise<void> {
		await this.pending;
	}

	/** Reapplies an undone case-only move through current vault validation. */
	async replayTransaction(transaction: CaseRenameTransaction): Promise<void> {
		await this.pending;
		if (transaction.state !== 'undone' || !transaction.replay) return;
		for (const plan of transaction.plans) this.transactions.delete(plan.temporary.toString());
		removeUndone(this, transaction);
		transaction.state = 'replaying';
		try {
			if (!await transaction.replay()) throw new Error('The case-only redo was rejected.');
		} catch (error) {
			transaction.state = 'undone';
			for (const plan of transaction.plans) this.transactions.set(plan.temporary.toString(), transaction);
			removeUndone(this, transaction);
			undoneTransactions.push({ coordinator: this, transaction });
			updateRedoContext();
			throw error;
		}
	}

	forgetTransaction(transaction: CaseRenameTransaction): void {
		transaction.state = 'retired';
		for (const plan of transaction.plans) {
			if (this.transactions.get(plan.temporary.toString()) === transaction) {
				this.transactions.delete(plan.temporary.toString());
			}
		}
	}

	private finishUndo(event: vscode.FileRenameEvent): void {
		const transactions = event.files.flatMap(({ oldUri, newUri }) => {
			const transaction = this.transactions.get(newUri.toString());
			if (!transaction) return [];
			return transaction.plans.some((plan) =>
				plan.temporary.toString() === newUri.toString() && sameProviderPath(oldUri, plan.source, plan.destination),
			) ? [transaction] : [];
		});
		if (transactions.length === 0) return;
		void this.enqueue(async () => {
			for (const transaction of unique(transactions)) {
				for (const plan of transaction.plans) {
					// The file event precedes VS Code's tab-model retarget. If an affected
					// tab is open, wait for that specific temporary URI instead of using a
					// timing guess; otherwise VS Code can publish a deleted temp tab after
					// the filesystem has already been restored.
					await waitForTemporaryTab(plan);
					await retargetOpenTabsAroundMove(
						[plan.temporary, plan.destination],
						plan.source,
						() => this.vault.finishCaseRenameUndo(plan.temporary, plan.source),
					);
					await closeLateTemporaryTabs(plan.temporary);
				}
				transaction.state = 'undone';
				removeUndone(this, transaction);
				undoneTransactions.push({ coordinator: this, transaction });
				updateRedoContext();
			}
		}).catch(() => {
			void vscode.window.showErrorMessage(vscode.l10n.t('Could not restore the exact casing while undoing the vault rename.'));
		});
	}

	async prepareTransactionRedo(transaction: CaseRenameTransaction): Promise<void> {
		await this.pending;
		transaction.preparedTabs = new Map();
		try {
			for (const plan of transaction.plans) {
				const tabs = captureOpenTabs([plan.source]);
				for (const item of tabs) {
					await closeTab(item, 'The editor tab could not be prepared for the case-only redo.');
				}
				transaction.preparedTabs.set(plan.temporary.toString(), tabs);
				await waitForDocumentClose(plan.source);
				await this.vault.prepareCaseRenameRedo(plan.source, plan.temporary);
			}
		} catch (error) {
			await this.rollbackPreparedRedo(transaction).catch(() => undefined);
			throw error;
		}
	}

	async completePreparedRedo(transaction: CaseRenameTransaction): Promise<void> {
		const preparedTabs = transaction.preparedTabs;
		transaction.preparedTabs = undefined;
		if (!preparedTabs) return;
		for (const plan of transaction.plans) {
			for (const item of preparedTabs.get(plan.temporary.toString()) ?? []) {
				await openRetargetedTab(item, plan.destination);
			}
		}
	}

	async finishForward(plans: readonly StagedCaseRename[]): Promise<boolean> {
		await this.pending;
		for (const plan of plans) {
			if (!await this.vault.hasExactEntry(plan.destination)) {
				if (await this.vault.hasExactEntry(plan.source)) {
					await this.vault.renameCaseOnly(plan.source, plan.destination, true);
				}
			}
		}
		const complete = (await Promise.all(plans.map((plan) => this.vault.hasExactEntry(plan.destination)))).every(Boolean);
		if (!complete) return false;
		for (const plan of plans) await retargetOpenTabs([plan.temporary, plan.source], plan.destination);
		return true;
	}

	async rollbackPreparedRedo(transaction: CaseRenameTransaction): Promise<void> {
		const preparedTabs = transaction.preparedTabs;
		transaction.preparedTabs = undefined;
		for (const plan of [...transaction.plans].reverse()) {
			if (await this.vault.hasExactEntry(plan.temporary)) {
				await this.vault.finishCaseRenameUndo(plan.temporary, plan.source);
			}
			for (const item of preparedTabs?.get(plan.temporary.toString()) ?? []) {
				await openRetargetedTab(item, plan.source);
			}
		}
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		// Undo events and tab retargeting share a queue; one failure must not block later work.
		const result = this.pending.catch(() => undefined).then(operation);
		this.pending = result.then(() => undefined, () => undefined);
		return result;
	}

	dispose(): void {
		for (const disposable of this.disposables) disposable.dispose();
		for (const transaction of new Set(this.transactions.values())) removeUndone(this, transaction);
		this.transactions.clear();
		activeCoordinators.delete(this);
	}
}

function unique<T>(values: readonly T[]): T[] {
	return [...new Set(values)];
}

function removeUndone(coordinator: CaseRenameCoordinator, transaction: CaseRenameTransaction): void {
	for (let index = undoneTransactions.length - 1; index >= 0; index--) {
		const entry = undoneTransactions[index];
		if (entry.coordinator === coordinator && entry.transaction === transaction) undoneTransactions.splice(index, 1);
	}
	updateRedoContext();
}

function updateRedoContext(): void {
	void vscode.commands.executeCommand(
		'setContext',
		'mdLivePreview.caseRenameRedoAvailable',
		undoneTransactions.some(({ transaction }) => transaction.state === 'undone'),
	);
}

/** Mirrors VS Code clearing its native redo stack after any intervening mutation. */
function invalidateCaseRenameRedoHistory(): void {
	if (undoneTransactions.length === 0) return;
	const stale = undoneTransactions.splice(0);
	for (const { coordinator, transaction } of stale) coordinator.forgetTransaction(transaction);
	updateRedoContext();
}

function sameProviderPath(actual: vscode.Uri, source: vscode.Uri, destination: vscode.Uri): boolean {
	return actual.scheme === source.scheme && actual.scheme === destination.scheme &&
		actual.fsPath.toLowerCase() === source.fsPath.toLowerCase() &&
		actual.fsPath.toLowerCase() === destination.fsPath.toLowerCase();
}

async function retargetOpenTabs(from: readonly vscode.Uri[], destination: vscode.Uri): Promise<void> {
	const tabs = captureOpenTabs(from);
	for (const item of tabs) {
		const caseFoldedSamePath = item.uri.scheme === destination.scheme &&
			item.uri.fsPath.toLowerCase() === destination.fsPath.toLowerCase();
		if (caseFoldedSamePath) {
			// Close the old spelling first or VS Code may reuse its existing case-insensitive tab.
			await closeTab(item, 'The old editor tab could not be closed safely.');
			await openRetargetedTab(item, destination);
		} else {
			await openRetargetedTab(item, destination);
			await closeTab(item, 'The temporary editor tab could not be closed safely.');
		}
	}
}

async function retargetOpenTabsAroundMove(
	from: readonly vscode.Uri[],
	destination: vscode.Uri,
	move: () => Promise<void>,
): Promise<void> {
	const tabs = captureOpenTabs(from);
	for (const item of tabs) await closeTab(item, 'The editor tab could not be prepared for the case-only rename.');
	await move();
	for (const item of tabs) await openRetargetedTab(item, destination);
}

type RetargetTab = {
	tab: vscode.Tab;
	group: vscode.TabGroup;
	uri: vscode.Uri;
	active: boolean;
	preview: boolean;
} & ({ kind: 'text' } | { kind: 'custom'; viewType: string });

function captureOpenTabs(from: readonly vscode.Uri[]): RetargetTab[] {
	const sourceKeys = new Set(from.map((uri) => uri.toString()));
	const tabs: RetargetTab[] = [];
	for (const group of vscode.window.tabGroups.all) for (const tab of group.tabs) {
		const input = tab.input;
		if (input instanceof vscode.TabInputText && sourceKeys.has(input.uri.toString())) {
			tabs.push({ tab, group, uri: input.uri, kind: 'text', active: tab.isActive, preview: tab.isPreview });
		}
		if (input instanceof vscode.TabInputCustom && sourceKeys.has(input.uri.toString())) {
			tabs.push({ tab, group, uri: input.uri, kind: 'custom', viewType: input.viewType, active: tab.isActive, preview: tab.isPreview });
		}
	}
	return tabs;
}

async function waitForTemporaryTab(plan: StagedCaseRename): Promise<boolean> {
	if (captureOpenTabs([plan.temporary]).length > 0) return true;
	if (captureOpenTabs([plan.destination, plan.source]).length === 0) return true;
	return new Promise<boolean>((resolve) => {
		let settled = false;
		const finish = (ready: boolean) => {
			if (settled) return;
			settled = true;
			disposable.dispose();
			clearTimeout(timeout);
			resolve(ready);
		};
		const disposable = vscode.window.tabGroups.onDidChangeTabs(() => {
			if (captureOpenTabs([plan.temporary]).length > 0) finish(true);
		});
		const timeout = setTimeout(() => finish(false), 500);
	});
}

/**
 * On macOS, VS Code can publish the tab-input URI after the rename event and
 * after the temporary file has already been restored. Reconcile only the exact
 * collision-resistant URI for a bounded period so a deleted editor never
 * survives the undo while unrelated tabs remain untouched.
 */
async function closeLateTemporaryTabs(temporary: vscode.Uri): Promise<void> {
	const deadline = Date.now() + 1_000;
	do {
		const tabs = captureOpenTabs([temporary]);
		if (tabs.length > 0) {
			let allClosed = true;
			for (const item of tabs) {
				allClosed = await vscode.window.tabGroups.close(item.tab, true) && allClosed;
			}
			if (allClosed) return;
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 20));
	} while (Date.now() < deadline);
	if (captureOpenTabs([temporary]).length > 0) {
		throw new Error('The temporary editor tab could not be closed safely.');
	}
}

async function waitForDocumentClose(uri: vscode.Uri): Promise<void> {
	const key = uri.toString();
	if (!vscode.workspace.textDocuments.some((document) => document.uri.toString() === key)) return;
	await new Promise<void>((resolve, reject) => {
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			disposable.dispose();
			clearTimeout(timeout);
			error ? reject(error) : resolve();
		};
		const disposable = vscode.workspace.onDidCloseTextDocument((document) => {
			if (document.uri.toString() === key) finish();
		});
		const timeout = setTimeout(() => {
			if (vscode.workspace.textDocuments.some((document) => document.uri.toString() === key)) {
				finish(new Error('The editor document could not be closed safely for the case-only redo.'));
			} else {
				finish();
			}
		}, 1_000);
	});
}

async function closeTab(item: RetargetTab, message: string): Promise<void> {
	if (!await vscode.window.tabGroups.close(item.tab, true)) throw new Error(message);
}

async function openRetargetedTab(item: RetargetTab, destination: vscode.Uri): Promise<void> {
	const options = { viewColumn: item.group.viewColumn, preserveFocus: !item.active, preview: item.preview };
	if (item.kind === 'custom') {
		await vscode.commands.executeCommand('vscode.openWith', destination, item.viewType, options);
	} else {
		await vscode.window.showTextDocument(destination, options);
	}
}
