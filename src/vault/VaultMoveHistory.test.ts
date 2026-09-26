import { describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import {
	VaultMoveHistory, vaultMoveHistoryFor, type VaultMoveExecution, type VaultMoveOutcome,
} from './VaultMoveHistory';
import type { VaultService } from './VaultService';

function uri(path: string): vscode.Uri { return { toString: () => `file:///vault/${path}` } as vscode.Uri; }
const request = { source: uri('Note.md'), destination: uri('Moved.md'), isFolder: false };
const outcome = (): VaultMoveOutcome => ({
	applied: true, policy: { updateLinks: true, exclusions: ['private/**'] },
	identities: [{ dev: 1, ino: 2, birthtimeMs: 3, isFolder: false }],
});
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

describe('dedicated vault move history', () => {
	it('is bound to the exact vault capability, not its displayed path', () => {
		const first = {} as VaultService;
		const second = {} as VaultService;
		expect(vaultMoveHistoryFor(first)).toBe(vaultMoveHistoryFor(first));
		expect(vaultMoveHistoryFor(first)).not.toBe(vaultMoveHistoryFor(second));
	});

	it('replays inverse and forward requests through the original fresh planner', async () => {
		const history = new VaultMoveHistory();
		const execute = vi.fn(async (_execution: VaultMoveExecution) => outcome());
		await history.runMove([request], execute);
		expect(history.canUndo).toBe(true);
		await history.undo();
		expect(execute.mock.calls[1][0].requests).toEqual([{ source: request.destination, destination: request.source, isFolder: false }]);
		expect(execute.mock.calls[1][0].expectedPolicy).toEqual(outcome().policy);
		expect(execute.mock.calls[1][0].expectedSources).toEqual(outcome().identities);
		expect(history.canUndo).toBe(false);
		expect(history.canRedo).toBe(true);
		await history.redo();
		expect(execute.mock.calls[2][0].requests).toEqual([request]);
		expect(history.canUndo).toBe(true);
		expect(history.canRedo).toBe(false);
	});

	it('snapshots caller-owned requests and policies instead of retaining mutable arrays', async () => {
		const history = new VaultMoveHistory();
		const requests = [{ ...request }];
		const result = outcome();
		const execute = vi.fn(async (_execution: VaultMoveExecution) => result);
		await history.runMove(requests, execute);
		requests[0].destination = uri('wrong.md');
		(result.policy.exclusions as string[]).push('**');
		await history.undo();
		expect(execute.mock.calls[1][0].requests[0].source).toBe(request.destination);
		expect(execute.mock.calls[1][0].expectedPolicy?.exclusions).toEqual(['private/**']);
	});

	it('a successful new move clears redo but a rejected move does not', async () => {
		const history = new VaultMoveHistory();
		await history.runMove([request], async () => outcome());
		await history.undo();
		await history.runMove([request], async () => ({ ...outcome(), applied: false }));
		expect(history.canRedo).toBe(true);
		await history.runMove([request], async () => outcome());
		expect(history.canRedo).toBe(false);
	});

	it('empty moves neither call a planner nor clear redo', async () => {
		const history = new VaultMoveHistory();
		await history.runMove([request], async () => outcome());
		await history.undo();
		const execute = vi.fn(async () => outcome());
		await history.runMove([], execute);
		expect(execute).not.toHaveBeenCalled();
		expect(history.canRedo).toBe(true);
	});

	it('preserves history when replay fails so a removable collision can be corrected', async () => {
		const history = new VaultMoveHistory();
		const execute = vi.fn(async () => outcome());
		await history.runMove([request], execute);
		execute.mockRejectedValueOnce(new Error('Destination collision'));
		await expect(history.undo()).rejects.toThrow('Destination collision');
		expect(history.canUndo).toBe(true);
		expect(history.canRedo).toBe(false);
		expect(await history.undo()).toBe(true);
	});

	it('serializes queued moves and undo against the newly committed stack', async () => {
		const history = new VaultMoveHistory();
		const gate = deferred();
		const calls: string[] = [];
		const execute = vi.fn(async (execution: VaultMoveExecution) => {
			calls.push(execution.expectedSources ? 'undo' : 'move');
			await gate.promise;
			return outcome();
		});
		const move = history.runMove([request], execute);
		const undo = history.undo();
		await Promise.resolve();
		expect(history.isBusy).toBe(true);
		expect(history.canUndo).toBe(false);
		expect(history.canRedo).toBe(false);
		expect(calls).toEqual(['move']);
		gate.resolve();
		expect(await move).toBe(true);
		expect(await undo).toBe(true);
		expect(calls).toEqual(['move', 'undo']);
		expect(history.canRedo).toBe(true);
	});

	it('two concurrent undo requests never replay one entry twice', async () => {
		const history = new VaultMoveHistory();
		const execute = vi.fn(async () => outcome());
		await history.runMove([request], execute);
		expect(await Promise.all([history.undo(), history.undo()])).toEqual([true, false]);
		expect(execute).toHaveBeenCalledTimes(2);
	});

	it('caps retained transactions at 50', async () => {
		const history = new VaultMoveHistory();
		for (let index = 0; index < 55; index++) await history.runMove([request], async () => outcome());
		let count = 0;
		while (await history.undo()) count++;
		expect(count).toBe(50);
	});

	it('reset invalidates both queued operations and an in-flight precommit guard', async () => {
		const history = new VaultMoveHistory();
		const gate = deferred();
		const running = history.runMove([request], async (execution) => {
			await gate.promise;
			execution.assertCurrent();
			return outcome();
		});
		const queued = history.undo();
		await Promise.resolve();
		history.clear();
		gate.resolve();
		await expect(running).rejects.toThrow('history changed');
		await expect(queued).rejects.toThrow('history changed');
		expect(history.canUndo).toBe(false);
	});

	it('returns honest success but retains no history if reset occurs after commit', async () => {
		const history = new VaultMoveHistory();
		expect(await history.runMove([request], async () => { history.clear(); return outcome(); })).toBe(true);
		expect(history.canUndo).toBe(false);
	});

	it('an unverifiable successful move clears both stacks without misreporting failure', async () => {
		const history = new VaultMoveHistory();
		await history.runMove([request], async () => outcome());
		expect(await history.runMove([request], async () => ({ ...outcome(), identities: undefined }))).toBe(true);
		expect(history.canUndo).toBe(false);
		expect(history.canRedo).toBe(false);
	});

	it('disposal clears memory and prevents future operations', async () => {
		const history = new VaultMoveHistory();
		await history.runMove([request], async () => outcome());
		history.dispose();
		expect(history.canUndo).toBe(false);
		await expect(history.undo()).rejects.toThrow('history changed');
	});

	it('invalidates native/external renames even while planning another operation', async () => {
		const history = new VaultMoveHistory();
		await expect(history.runMove([request], async (execution) => {
			history.observeRenames([{ oldUri: uri('Other.md'), newUri: uri('Elsewhere.md') }]);
			execution.assertCurrent();
			return outcome();
		})).rejects.toThrow('history changed');
	});

	it('accepts only the exact active native rename pair and stops ignoring it afterward', async () => {
		const history = new VaultMoveHistory();
		await history.runMove([request], async (execution) => {
			const lease = execution.expectRenames([request]);
			history.observeRenames([{ oldUri: request.source, newUri: request.destination }]);
			execution.assertCurrent();
			lease.dispose();
			return outcome();
		});
		expect(history.canUndo).toBe(true);
		history.observeRenames([{ oldUri: request.source, newUri: request.destination }]);
		expect(history.canUndo).toBe(false);
	});

	it('change notifications include busy state and observer exceptions do not break moves', async () => {
		const history = new VaultMoveHistory();
		const busy: boolean[] = [];
		history.onDidChange(() => { throw new Error('UI failure'); });
		const subscription = history.onDidChange(() => { busy.push(history.isBusy); });
		expect(await history.runMove([request], async () => outcome())).toBe(true);
		expect(busy).toEqual([true, false]);
		subscription.dispose();
		history.clear();
		expect(busy).toEqual([true, false]);
	});
});
