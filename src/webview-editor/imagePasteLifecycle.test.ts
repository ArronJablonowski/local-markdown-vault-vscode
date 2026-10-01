import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Compartment, EditorState, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { createImagePasteHandler, flushPendingImagePastes, type ImagePasteCallback } from './imagePasteHandler';

const readers: TestReader[] = [];
class TestReader {
	static LOADING = 1;
	readyState = 0;
	result = '';
	error = new Error('Synthetic read failure');
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	aborted = false;
	constructor() { readers.push(this); }
	readAsDataURL() { this.readyState = TestReader.LOADING; }
	abort() { this.aborted = true; this.readyState = 2; }
	finish(base64 = 'cG5n') { this.result = `data:image/png;base64,${base64}`; this.readyState = 2; this.onload?.(); }
}

const cleanup: Array<() => void> = [];
beforeEach(() => { readers.length = 0; vi.stubGlobal('FileReader', TestReader); });
afterEach(() => {
	for (const destroy of cleanup.splice(0)) destroy();
	vi.unstubAllGlobals(); vi.useRealTimers();
});

function harness(doc = 'Anchor\nTail', editable = true, readOnly = false) {
	const mode = new Compartment();
	const view = { state: EditorState.create({ doc, extensions: [markdown({ extensions: GFM }),
		mode.of(EditorView.editable.of(editable)), EditorState.readOnly.of(readOnly)] }) } as EditorView;
	const onImages = vi.fn<ImagePasteCallback>(() => true);
	const onRejected = vi.fn();
	const plugin = createImagePasteHandler(onImages, onRejected) as any;
	const controller = plugin.create(view);
	cleanup.push(() => controller.destroy());
	const update = (spec: TransactionSpec) => {
		const transaction = view.state.update(spec);
		(view as any).state = transaction.state;
		controller.update({ docChanged: transaction.docChanged, changes: transaction.changes });
	};
	const start = (pos = 7, count = 1) => controller.start({ kind: 'valid',
		files: Array.from({ length: count }, () => ({ type: 'image/png', size: 3 })) }, pos);
	return { view, controller, onImages, onRejected, update, start,
		paste: (event: unknown) => plugin.domEventHandlers.paste.call(controller, event, view),
		setEditable: (enabled: boolean) => update({ effects: mode.reconfigure(EditorView.editable.of(enabled)) }) };
}

async function settleRead() { for (let n = 0; n < 4; n++) await Promise.resolve(); }

describe('asynchronous image paste lifecycle', () => {
	it.each(['image/png', 'image/svg+xml'])('leaves readable external text with an alternate %s to the text handler', mime => {
		const h = harness();
		const event = { preventDefault: vi.fn(), clipboardData: { types: ['text/plain', 'Files'],
			getData: () => 'Exact external text', items: [{ kind: 'file', type: mime, getAsFile: () => ({ type: mime, size: 3 }) }] } };
		expect(h.paste(event)).toBe(false);
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(readers).toHaveLength(0);
		expect(h.onRejected).not.toHaveBeenCalled();
	});

	it('keeps image-only paste when external text metadata is empty', () => {
		const h = harness();
		const event = { preventDefault: vi.fn(), clipboardData: { types: ['text/plain', 'text/csv', 'Files'],
			getData: () => '', items: [{ kind: 'file', type: 'image/png', getAsFile: () => ({ type: 'image/png', size: 3 }) }] } };
		expect(h.paste(event)).toBe(true);
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(readers).toHaveLength(1);
	});

	it('maps a pending insertion through typing before its original position', async () => {
		const h = harness(); h.start();
		h.update({ changes: { from: 0, insert: 'PREFIX ' } });
		readers[0].finish(); await settleRead();
		expect(h.onImages).toHaveBeenCalledExactlyOnceWith(14, [{ mimeType: 'image/png', dataBase64: 'cG5n' }], false);
	});

	it('keeps the earlier paste before text typed at the exact same insertion point', async () => {
		const h = harness(); h.start(); h.update({ changes: { from: 7, insert: 'new text' } });
		readers[0].finish(); await settleRead();
		expect(h.onImages.mock.calls[0][0]).toBe(7);
	});

	it('cancels a removed insertion point rather than guessing a replacement location', async () => {
		const h = harness(); h.start(); h.update({ changes: { from: 1, to: 10, insert: 'replacement' } });
		expect(readers[0].aborted).toBe(true);
		readers[0].finish(); await settleRead();
		expect(h.onImages).not.toHaveBeenCalled(); expect(h.onRejected).toHaveBeenCalledWith('stale');
	});

	it.each([[false, false], [true, true]])('does not read images when editing is unavailable (%s, %s)', async (editable, readOnly) => {
		const h = harness(undefined, editable, readOnly); h.start(); h.setEditable(true);
		await settleRead(); expect(readers).toHaveLength(0); expect(h.onImages).not.toHaveBeenCalled();
	});

	it('locking permanently cancels an in-progress operation even after unlocking', async () => {
		const h = harness(); h.start(); h.setEditable(false); h.setEditable(true);
		expect(readers[0].aborted).toBe(true); readers[0].finish(); await settleRead();
		expect(h.onImages).not.toHaveBeenCalled();
	});

	it('keeps decoded data mapped while the host text channel is busy', async () => {
		const h = harness(); h.onImages.mockReturnValue(false); h.start(); readers[0].finish(); await settleRead();
		expect(h.onImages).toHaveBeenCalledTimes(1);
		h.update({ changes: { from: 0, insert: 'PREFIX ' } });
		h.onImages.mockReturnValue(true); flushPendingImagePastes(h.view);
		expect(h.onImages).toHaveBeenLastCalledWith(14, [{ mimeType: 'image/png', dataBase64: 'cG5n' }], false);
		flushPendingImagePastes(h.view); expect(h.onImages).toHaveBeenCalledTimes(2);
	});

	it('bounds overlapping operations and accepts a new gesture after completion', async () => {
		const h = harness(); h.start(); h.start();
		expect(readers).toHaveLength(1); expect(h.onRejected).toHaveBeenCalledExactlyOnceWith('busy');
		readers[0].finish(); await settleRead(); h.start(); expect(readers).toHaveLength(2);
	});

	it('reads each image sequentially and posts one ordered batch', async () => {
		const h = harness(); h.start(7, 2); expect(readers).toHaveLength(1);
		readers[0].finish('b25l'); await settleRead(); expect(readers).toHaveLength(2);
		expect(h.onImages).not.toHaveBeenCalled(); readers[1].finish('dHdv'); await settleRead();
		expect(h.onImages).toHaveBeenCalledExactlyOnceWith(7,
			[{ mimeType: 'image/png', dataBase64: 'b25l' }, { mimeType: 'image/png', dataBase64: 'dHdv' }], false);
	});

	it('expires both a stuck read and a decoded job waiting indefinitely for the host', async () => {
		vi.useFakeTimers();
		for (const decoded of [false, true]) {
			const h = harness(); h.onImages.mockReturnValue(false); h.start();
			if (decoded) { readers.at(-1)!.finish(); await settleRead(); }
			await vi.advanceTimersByTimeAsync(30_000);
			expect(h.onRejected).toHaveBeenCalledExactlyOnceWith('stale');
			h.onImages.mockClear(); flushPendingImagePastes(h.view); expect(h.onImages).not.toHaveBeenCalled();
		}
	});

	it('reports a read failure and releases the operation slot', async () => {
		const h = harness(); h.start(); readers[0].onerror?.(); await settleRead();
		expect(h.onImages).not.toHaveBeenCalled(); expect(h.onRejected).toHaveBeenCalledExactlyOnceWith('unreadable');
		h.start(); expect(readers).toHaveLength(2);
	});

	it('contains a host callback failure on an idle retry', async () => {
		const h = harness(); h.onImages.mockReturnValue(false); h.start(); readers[0].finish(); await settleRead();
		h.onImages.mockImplementation(() => { throw new Error('Synthetic host failure'); });
		expect(() => flushPendingImagePastes(h.view)).not.toThrow();
		expect(h.onRejected).toHaveBeenCalledExactlyOnceWith('unreadable');
	});

	it('disposal aborts reads and removes the idle-flush callback', async () => {
		const h = harness(); h.start(); h.controller.destroy();
		expect(readers[0].aborted).toBe(true); readers[0].finish(); await settleRead();
		flushPendingImagePastes(h.view); expect(h.onImages).not.toHaveBeenCalled();
	});
});
