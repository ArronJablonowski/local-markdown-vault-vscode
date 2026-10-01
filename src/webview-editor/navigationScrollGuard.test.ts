import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { navigationScrollGuard } from './navigationScrollGuard';
import { setDiagramHostVisibility } from './diagramVisibility';

const pointer = vi.hoisted(() => ({ held: false }));
vi.mock('./cmUtils', async importOriginal => ({
	...await importOriginal<typeof import('./cmUtils')>(),
	pointerSelectionInProgress: () => pointer.held,
}));

type Guard = { update(update: ViewUpdate): void; destroy(): void };
const cleanup: Array<() => void> = [];
afterEach(() => {
	for (const destroy of cleanup.splice(0)) destroy();
	pointer.held = false;
	setDiagramHostVisibility(true);
	vi.restoreAllMocks();
});

function harness() {
	const ownerWindow = new EventTarget();
	const owner = Object.assign(new EventTarget(), { hidden: false, defaultView: ownerWindow });
	const dom = Object.assign(new EventTarget(), { ownerDocument: owner, isConnected: true });
	const contentDOM = {};
	const root = { activeElement: contentDOM };
	let caret: { top: number; bottom: number; left: number; right: number } | null = { top: 800, bottom: 820, left: 20, right: 21 };
	const selection = { anchor: 5, head: 10 };
	const requests: Array<{ read: (view: EditorView) => unknown; write: (value: unknown, view: EditorView) => void }> = [];
	const dispatch = vi.fn();
	const view = {
		dom, contentDOM, root, hasFocus: true, state: { selection: { main: selection } },
		scrollDOM: { getBoundingClientRect: () => ({ top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 }) },
		coordsAtPos: vi.fn(() => caret), requestMeasure: (request: typeof requests[number]) => requests.push(request), dispatch,
	} as unknown as EditorView;
	// Instantiate only the plugin value, without a DOM editor; browser tests
	// separately verify CodeMirror's real measurement/scrolling lifecycle.
	const guard = (navigationScrollGuard as unknown as { create(view: EditorView): Guard }).create(view);
	cleanup.push(() => guard.destroy());
	const key = (key: string, isComposing = false) => dom.dispatchEvent(Object.assign(new Event('keydown'), { key, isComposing }));
	const update = (changes: Partial<ViewUpdate> = {}) => guard.update({ docChanged: false, focusChanged: false, ...changes } as ViewUpdate);
	const measure = async () => {
		const request = requests.shift();
		if (request) request.write(request.read(view), view);
		await Promise.resolve();
	};
	return { guard, view, dom, owner, ownerWindow, root, selection, dispatch, key, update, measure, requests, setCaret: (value: typeof caret) => { caret = value; } };
}

describe('keyboard navigation scroll guard', () => {
	it.each(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'])('repairs an offscreen %s destination without changing source or selection', async key => {
		const h = harness();
		h.key(key);
		await h.measure();
		expect(h.dispatch).toHaveBeenCalledTimes(1);
		expect(h.dispatch.mock.calls[0][0]).toEqual({ effects: expect.anything() });
		expect(h.selection).toEqual({ anchor: 5, head: 10 });
	});

	it('uses the latest selection head after measurement instead of a stale captured offset', async () => {
		const h = harness(); h.key('ArrowRight'); h.selection.head = 25;
		await h.measure();
		expect(h.dispatch.mock.calls[0][0].effects.value.range.head).toBe(25);
		expect(h.dispatch.mock.calls[0][0].effects.value.range.assoc).toBe(-1);
		expect(h.view.coordsAtPos).toHaveBeenCalledWith(25, -1);
		expect(h.selection.anchor).toBe(5);
	});

	it('measures the selected side of a widget boundary without retrying for its unselected box', async () => {
		const h = harness();
		vi.mocked(h.view.coordsAtPos).mockImplementation((_head, side) => side === -1
			? { top: 560, bottom: 580, left: 20, right: 21 }
			: { top: 610, bottom: 640, left: 20, right: 21 });
		h.key('ArrowDown'); await h.measure();
		expect(h.view.coordsAtPos).toHaveBeenCalledWith(10, -1);
		expect(h.dispatch).not.toHaveBeenCalled();
	});

	it.each([-1, 0, 1] as const)('uses consistent measurement and scrolling sides for empty caret affinity %s', async assoc => {
		const h = harness(); Object.assign(h.selection, { anchor: 10, empty: true, assoc });
		h.key('ArrowDown'); await h.measure();
		expect(h.view.coordsAtPos).toHaveBeenCalledWith(10, assoc || 1);
		expect(h.dispatch.mock.calls[0][0].effects.value.range.assoc).toBe(assoc || 1);
	});

	it('uses the following side for a backward selection head', async () => {
		const h = harness(); h.selection.head = 3;
		h.key('ArrowUp'); await h.measure();
		expect(h.view.coordsAtPos).toHaveBeenCalledWith(3, 1);
		expect(h.dispatch.mock.calls[0][0].effects.value.range.assoc).toBe(1);
	});

	it('recovers an unmounted caret with the same bounded scroll effect', async () => {
		const h = harness(); h.setCaret(null); h.key('PageDown');
		await h.measure(); expect(h.dispatch).toHaveBeenCalledTimes(1);
	});

	it('leaves an already visible caret alone', async () => {
		const h = harness(); h.setCaret({ top: 40, bottom: 60, left: 20, right: 21 }); h.key('ArrowDown');
		await h.measure(); expect(h.dispatch).not.toHaveBeenCalled();
	});

	it.each(['wheel', 'pointerdown', 'mousedown', 'pointercancel', 'touchstart', 'focusout'])('cancels pending correction on %s', async event => {
		const h = harness(); h.key('ArrowDown'); h.dom.dispatchEvent(new Event(event));
		await h.measure(); h.update(); await h.measure();
		expect(h.dispatch).not.toHaveBeenCalled();
	});

	it('does not follow typing, composition, or real document edits', async () => {
		for (const cancel of [(h: ReturnType<typeof harness>) => h.key('a'),
			(h: ReturnType<typeof harness>) => h.key('ArrowRight', true),
			(h: ReturnType<typeof harness>) => h.update({ docChanged: true })]) {
			const h = harness(); h.key('ArrowDown'); cancel(h); await h.measure();
			expect(h.dispatch).not.toHaveBeenCalled();
		}
	});

	it('ignores keys owned by table/property/search fields and pointer selection', async () => {
		const h = harness(); h.root.activeElement = {}; h.key('ArrowDown'); await h.measure();
		expect(h.requests).toHaveLength(0); expect(h.dispatch).not.toHaveBeenCalled();
		h.root.activeElement = h.view.contentDOM; pointer.held = true; h.key('ArrowDown'); await h.measure();
		expect(h.dispatch).not.toHaveBeenCalled();
	});

	it.each(['host', 'document', 'window'])('cancels retained navigation when %s visibility/focus disappears', async mode => {
		const h = harness(); h.key('ArrowDown');
		if (mode === 'host') { setDiagramHostVisibility(false); setDiagramHostVisibility(true); }
		if (mode === 'document') { h.owner.hidden = true; h.owner.dispatchEvent(new Event('visibilitychange')); h.owner.hidden = false; }
		if (mode === 'window') h.ownerWindow.dispatchEvent(new Event('blur'));
		await h.measure(); h.update(); await h.measure();
		expect(h.dispatch).not.toHaveBeenCalled();
	});

	it('bounds retries even if a target cannot become visible', async () => {
		const h = harness(); h.key('ArrowDown');
		for (let n = 0; n < 20; n++) { h.update(); await h.measure(); }
		expect(h.dispatch).toHaveBeenCalledTimes(8);
		expect(h.requests).toHaveLength(0);
	});

	it('expires old intent without polling or reviving it on later layout updates', async () => {
		let time = 1000; vi.spyOn(Date, 'now').mockImplementation(() => time);
		const h = harness(); h.key('ArrowDown'); time = 2001;
		await h.measure(); h.update(); await h.measure(); expect(h.dispatch).not.toHaveBeenCalled();
	});

	it('disposes listeners and ignores already queued measurement work', async () => {
		const h = harness(); h.key('ArrowDown'); h.guard.destroy();
		await h.measure(); h.key('ArrowDown'); h.update(); await h.measure();
		expect(h.requests).toHaveLength(0); expect(h.dispatch).not.toHaveBeenCalled();
	});
});
