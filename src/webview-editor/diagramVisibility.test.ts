import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiagramVisibilityGate, disposeDiagramVisibility, setDiagramHostVisibility, trackDiagramVisibility } from './diagramVisibility';

function owner(hidden = true) {
	const target = new EventTarget();
	Object.defineProperty(target, 'hidden', { value: hidden, writable: true });
	return target as unknown as Document;
}

describe('diagram visibility stage gate', () => {
	afterEach(() => setDiagramHostVisibility(true));
	it('runs visible stages synchronously, including detached toDOM construction', () => {
		const task = vi.fn(); new DiagramVisibilityGate(owner(false)).run(task);
		expect(task).toHaveBeenCalledExactlyOnceWith();
	});
	it('keeps only the latest deferred stage with one listener and resumes once', () => {
		const document = owner(); const add = vi.spyOn(document, 'addEventListener');
		const remove = vi.spyOn(document, 'removeEventListener');
		const gate = new DiagramVisibilityGate(document); const first = vi.fn(), latest = vi.fn();
		gate.run(first); gate.run(latest);
		expect(first).not.toHaveBeenCalled(); expect(latest).not.toHaveBeenCalled(); expect(add).toHaveBeenCalledTimes(1);
		(document as unknown as { hidden: boolean }).hidden = false;
		document.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('visibilitychange'));
		expect(first).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1);
	});
	it('removes its listener and drops late async stages after widget destruction', () => {
		const document = owner(); const remove = vi.spyOn(document, 'removeEventListener');
		const gate = new DiagramVisibilityGate(document); const task = vi.fn();
		gate.run(task); gate.dispose(); gate.dispose(); gate.run(task);
		(document as unknown as { hidden: boolean }).hidden = false; document.dispatchEvent(new Event('visibilitychange'));
		expect(task).not.toHaveBeenCalled(); expect(remove).toHaveBeenCalledTimes(1);
	});
	it('routes delayed rendering exceptions to the error boundary', () => {
		const document = owner(); const error = new Error('invalid SVG'); const failed = vi.fn();
		const gate = new DiagramVisibilityGate(document, failed);
		gate.run(() => { throw error; });
		(document as unknown as { hidden: boolean }).hidden = false;
		document.dispatchEvent(new Event('visibilitychange'));
		expect(failed).toHaveBeenCalledExactlyOnceWith(error);
	});
	it('cleans up by DOM identity even when an equal replacement widget owns destruction', () => {
		const document = owner(); const gate = new DiagramVisibilityGate(document); const task = vi.fn(), childCleanup = vi.fn();
		const dom = {} as HTMLElement;
		trackDiagramVisibility(dom, gate, childCleanup); gate.run(task);
		const replacement = { destroy: disposeDiagramVisibility };
		replacement.destroy(dom); replacement.destroy(dom);
		(document as unknown as { hidden: boolean }).hidden = false; document.dispatchEvent(new Event('visibilitychange'));
		expect(gate.isDisposed).toBe(true); expect(task).not.toHaveBeenCalled(); expect(childCleanup).toHaveBeenCalledTimes(1);
	});
	it('defers a host-hidden retained iframe even when document.hidden remains false', () => {
		const document = owner(false); const task = vi.fn();
		setDiagramHostVisibility(false);
		const gate = new DiagramVisibilityGate(document); gate.run(task);
		document.dispatchEvent(new Event('visibilitychange'));
		expect(task).not.toHaveBeenCalled();
		setDiagramHostVisibility(true); expect(task).toHaveBeenCalledTimes(1);
	});
	it('requires both native and host visibility before resuming', () => {
		const document = owner(true); const task = vi.fn();
		setDiagramHostVisibility(false);
		const gate = new DiagramVisibilityGate(document); gate.run(task);
		setDiagramHostVisibility(true); expect(task).not.toHaveBeenCalled();
		(document as unknown as { hidden: boolean }).hidden = false;
		document.dispatchEvent(new Event('visibilitychange')); expect(task).toHaveBeenCalledTimes(1);
	});
	it('does not resurrect a disposed widget when the host reveals the panel', () => {
		setDiagramHostVisibility(false); const task = vi.fn();
		const gate = new DiagramVisibilityGate(owner(false)); gate.run(task); gate.dispose();
		setDiagramHostVisibility(true); gate.run(task); expect(task).not.toHaveBeenCalled();
	});
});
