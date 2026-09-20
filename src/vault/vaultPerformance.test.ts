import { describe, expect, it } from 'vitest';
import { extractVaultMetadata } from './vaultMetadata';
import { searchVaultRecords } from './vaultSearchQuery';
import type { VaultIndexRecord } from './VaultIndex';
import { searchQuickSwitcherRecords } from './quickSwitcher';
import { findBrokenVaultLinks } from './brokenLinks';
import { IndexMemoryBudget, retainedIndexRecordBytes } from './indexMemoryBudget';

const NOTE_COUNT = 10_000;
const LINKS_PER_NOTE = 13;
let records: VaultIndexRecord[] = [];

describe.sequential('10,000-item vault performance gates', () => {
	it('indexes 10,000 notes and at least 130,000 links within three seconds', () => {
		const started = performance.now();
		records = Array.from({ length: NOTE_COUNT }, (_, index) => {
			const links = Array.from({ length: LINKS_PER_NOTE }, (__, link) => `[[Note-${(index + link + 1) % NOTE_COUNT}]]`).join(' ');
			const text = `---\ntags: [fixture/group-${index % 20}]\naliases: [Alias ${index}]\n---\n# Note ${index}\n\n${links}\n\nSearch term-${index % 100} unicode Ω${index}.\n`;
			return { ...extractVaultMetadata(`Folder-${index % 100}/Note-${index}.md`, text), mtime: index, size: text.length };
		});
		const elapsed = performance.now() - started;
		console.info(`[performance] metadata-index=${elapsed.toFixed(1)}ms notes=${NOTE_COUNT} links=${NOTE_COUNT * LINKS_PER_NOTE}`);
		expect(elapsed).toBeLessThan(3_000);
	});

	it('applies an incremental note parse within 500 milliseconds', () => {
		const started = performance.now();
		extractVaultMetadata('Changed.md', '# Changed\n\n' + 'updated content '.repeat(20_000));
		const elapsed = performance.now() - started;
		console.info(`[performance] incremental-parse=${elapsed.toFixed(1)}ms`);
		expect(elapsed).toBeLessThan(500);
	});

	it('accounts the complete in-memory index within 500 milliseconds', () => {
		const budget = new IndexMemoryBudget();
		const started = performance.now();
		for (const record of records) {
			expect(budget.tryReplace(record.path, retainedIndexRecordBytes(record))).toBe(true);
		}
		const elapsed = performance.now() - started;
		console.info(`[performance] metadata-accounting=${elapsed.toFixed(1)}ms retained=${budget.usedBytes}`);
		expect(elapsed).toBeLessThan(500);
	});

	it('returns a typical first search page within 200 milliseconds at p95', () => {
		const samples: number[] = [];
		for (let run = 0; run < 6; run++) {
			const started = performance.now();
			const result = searchVaultRecords(records, 'tag:fixture term-42', 50);
			const elapsed = performance.now() - started;
			if (run > 0) samples.push(elapsed);
			expect(result.length).toBeGreaterThan(0);
		}
		samples.sort((a, b) => a - b);
		const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
		console.info(`[performance] indexed-search-p95=${p95.toFixed(1)}ms samples=${samples.map((value) => value.toFixed(1)).join(',')}`);
		expect(p95).toBeLessThan(200);
	});

	it('returns fuzzy Quick Switcher results within 200 milliseconds at p95', () => {
		const samples: number[] = [];
		for (let run = 0; run < 6; run++) {
			const started = performance.now();
			const result = searchQuickSwitcherRecords(records, 'f42 n42', 100);
			const elapsed = performance.now() - started;
			if (run > 0) samples.push(elapsed);
			expect(result.length).toBeGreaterThan(0);
		}
		samples.sort((a, b) => a - b);
		const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
		console.info(`[performance] quick-switcher-p95=${p95.toFixed(1)}ms samples=${samples.map((value) => value.toFixed(1)).join(',')}`);
		expect(p95).toBeLessThan(200);
	});

	it('resolves broken links across 10,000 notes without a quadratic scan', () => {
		const started = performance.now();
		const broken = findBrokenVaultLinks(records, true, 500);
		const elapsed = performance.now() - started;
		console.info(`[performance] broken-link-scan=${elapsed.toFixed(1)}ms links=${NOTE_COUNT * LINKS_PER_NOTE}`);
		expect(broken).toHaveLength(0);
		expect(elapsed).toBeLessThan(500);
	});
});
