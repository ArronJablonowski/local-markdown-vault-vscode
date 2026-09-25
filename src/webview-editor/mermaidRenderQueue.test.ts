import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_QUEUED_MERMAID_RENDERS, renderMermaidBounded } from './mermaidRenderQueue';
import { DIAGRAM_RENDER_TIMEOUT_MS } from './diagramSecurity';
import { setDiagramHostVisibility } from './diagramVisibility';

function visibility(hidden: boolean) {
	const document = new EventTarget() as EventTarget & { hidden: boolean };
	document.hidden = hidden;
	vi.stubGlobal('document', document);
	return { document, set(value: boolean) { document.hidden = value; document.dispatchEvent(new Event('visibilitychange')); } };
}

describe('bounded Mermaid render queue', () => {
	afterEach(() => { setDiagramHostVisibility(true); vi.useRealTimers(); vi.unstubAllGlobals(); });
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

	it('defers hidden work without starting render deadlines and retains the queue cap', async () => {
		vi.useFakeTimers(); const state = visibility(true);
		const task = vi.fn(async () => 'rendered');
		const queued = Array.from({ length: MAX_QUEUED_MERMAID_RENDERS }, () => renderMermaidBounded(task));
		await expect(renderMermaidBounded(task)).rejects.toThrow('Too many Mermaid diagrams');
		await vi.advanceTimersByTimeAsync(DIAGRAM_RENDER_TIMEOUT_MS * 3);
		expect(task).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
		state.set(false); await expect(Promise.all(queued)).resolves.toHaveLength(MAX_QUEUED_MERMAID_RENDERS);
	});

	it('pauses queued deadlines while hidden but keeps the running renderer deadline', async () => {
		vi.useFakeTimers(); const state = visibility(false); let release!: () => void;
		const first = renderMermaidBounded(() => new Promise<void>(resolve => { release = resolve; }));
		const firstResult = expect(first).rejects.toThrow('2 second limit');
		const task = vi.fn(async () => 'next'); const queued = renderMermaidBounded(task);
		await vi.advanceTimersByTimeAsync(500); state.set(true);
		await vi.advanceTimersByTimeAsync(DIAGRAM_RENDER_TIMEOUT_MS * 3); await firstResult;
		expect(task).not.toHaveBeenCalled(); release(); await Promise.resolve(); await Promise.resolve();
		state.set(false); await expect(queued).resolves.toBe('next');
	});

	it('cleans up visibility listeners after visible work drains', async () => {
		const state = visibility(true); const remove = vi.spyOn(state.document, 'removeEventListener');
		const result = renderMermaidBounded(async () => 'done'); state.set(false); await result;
		await Promise.resolve(); await Promise.resolve();
		expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
	});

	it('defers rendering for a host-hidden retained iframe with native visibility still true', async () => {
		vi.useFakeTimers(); visibility(false); setDiagramHostVisibility(false);
		const task = vi.fn(async () => 'visible');
		const result = renderMermaidBounded(task);
		await vi.advanceTimersByTimeAsync(DIAGRAM_RENDER_TIMEOUT_MS * 3);
		expect(task).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
		setDiagramHostVisibility(true); await expect(result).resolves.toBe('visible');
	});
});
