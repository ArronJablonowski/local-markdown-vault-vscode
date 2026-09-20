import { describe, expect, it } from 'vitest';
import { IndexMemoryBudget, retainedIndexRecordBytes } from './indexMemoryBudget';

describe('vault index memory budget', () => {
	it('accounts replacements, deletions, and clear without double counting', () => {
		const budget = new IndexMemoryBudget(20);
		expect(budget.tryReplace('a', 8)).toBe(true);
		expect(budget.tryReplace('b', 7)).toBe(true);
		expect(budget.usedBytes).toBe(15);
		expect(budget.tryReplace('a', 12)).toBe(true);
		expect(budget.usedBytes).toBe(19);
		expect(budget.tryReplace('b', 9)).toBe(false);
		expect(budget.usedBytes).toBe(19);
		budget.delete('a');
		expect(budget.usedBytes).toBe(7);
		budget.clear();
		expect(budget.usedBytes).toBe(0);
	});

	it('rejects invalid sizes and conservatively counts expansion-heavy JSON strings', () => {
		const value = { text: 'Ω"\\'.repeat(10) };
		expect(retainedIndexRecordBytes(value)).toBe(JSON.stringify(value).length * 2);
		expect(retainedIndexRecordBytes(value)).toBeGreaterThan(new TextEncoder().encode(JSON.stringify(value)).byteLength);
		const budget = new IndexMemoryBudget(10);
		expect(budget.tryReplace('bad', Number.NaN)).toBe(false);
		expect(budget.tryReplace('bad', -1)).toBe(false);
		expect(budget.usedBytes).toBe(0);
	});
});
