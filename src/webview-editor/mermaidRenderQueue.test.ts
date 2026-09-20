import { describe, expect, it } from 'vitest';
import { MAX_QUEUED_MERMAID_RENDERS, renderMermaidBounded } from './mermaidRenderQueue';

describe('bounded Mermaid render queue', () => {
	it('serializes renderer calls', async () => {
		const order: string[] = [];
		let release!: () => void;
		const first = renderMermaidBounded(async () => {
			order.push('first-start');
			await new Promise<void>((resolve) => { release = resolve; });
			order.push('first-end');
			return 1;
		});
		const second = renderMermaidBounded(async () => {
			order.push('second-start');
			return 2;
		});
		await Promise.resolve();
		expect(order).toEqual(['first-start']);
		release();
		expect(await Promise.all([first, second])).toEqual([1, 2]);
		expect(order).toEqual(['first-start', 'first-end', 'second-start']);
	});

	it('rejects work beyond the pending queue limit', async () => {
		let release!: () => void;
		const first = renderMermaidBounded(() => new Promise<void>((resolve) => { release = resolve; }));
		const queued = Array.from({ length: MAX_QUEUED_MERMAID_RENDERS }, () => renderMermaidBounded(async () => undefined));
		await expect(renderMermaidBounded(async () => undefined)).rejects.toThrow('Too many Mermaid diagrams');
		release();
		await first;
		await Promise.all(queued);
	});
});
