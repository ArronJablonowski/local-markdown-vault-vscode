import { afterEach, describe, expect, it, vi } from 'vitest';
import { runScopeHandlers, type EditorView } from '@codemirror/view';
import { renderedNoteShortcuts } from './renderedNoteShortcuts';

vi.mock('@codemirror/view', async importOriginal => ({
	...await importOriginal<typeof import('@codemirror/view')>(), runScopeHandlers: vi.fn(() => true),
}));

class Control extends EventTarget {
	field = false;
	inside = true;
	closest(): Control | null { return this.field ? this : null; }
	contains(target: unknown): boolean { return this.inside && target === this; }
}
const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).forEach(destroy => destroy()); vi.clearAllMocks(); vi.unstubAllGlobals(); });

function setup() {
	vi.stubGlobal('Element', Control);
	const dom = new Control();
	const view = { dom, contentDOM: dom, focus: vi.fn() } as unknown as EditorView;
	const plugin = (renderedNoteShortcuts as any).create(view);
	cleanup.push(() => plugin.destroy());
	const press = (key: string, options: Record<string, boolean> = {}, prevented = false) => {
		const event = Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key, ...options });
		if (prevented) event.preventDefault();
		const stop = vi.spyOn(event, 'stopPropagation');
		dom.dispatchEvent(event);
		return { event, stop };
	};
	return { dom, view, plugin, press };
}

describe('rendered note-command fallback', () => {
	it.each(['ctrlKey', 'metaKey'])('routes supported %s chords exactly once', modifier => {
		const { view, press } = setup();
		for (const [key, shiftKey] of [['z', false], ['Z', true], ['y', false], ['Y', false], ['a', false], ['f', false]] as const) {
			vi.mocked(runScopeHandlers).mockClear();
			const { event, stop } = press(key, { [modifier]: true, shiftKey });
			expect(runScopeHandlers).toHaveBeenCalledExactlyOnceWith(view, event, 'editor');
			expect(event.defaultPrevented).toBe(true); expect(stop).toHaveBeenCalledOnce();
		}
	});
	it('focuses source for Select All but lets Find choose its own field', () => {
		const { view, press } = setup();
		press('a', { metaKey: true }); expect(view.focus).toHaveBeenCalledOnce();
		vi.mocked(view.focus).mockClear();
		press('f', { metaKey: true, altKey: true }); expect(view.focus).not.toHaveBeenCalled();
		expect(runScopeHandlers).toHaveBeenCalledTimes(2);
	});
	it('captures Select All from a focused inline control before the ordinary keymap', () => {
		const { dom, plugin, view } = setup();
		vi.spyOn(dom, 'contains').mockReturnValue(true);
		const event = Object.assign(new Event('keydown', { cancelable: true }), { key: 'a', metaKey: true });
		Object.defineProperty(event, 'target', { value: new Control() });
		plugin.selectAll(event);
		expect(view.focus).toHaveBeenCalledOnce();
		expect(runScopeHandlers).toHaveBeenCalledOnce(); expect(event.defaultPrevented).toBe(true);
	});
	it('ignores already handled, composition, alternate, shifted Y and unrelated keys', () => {
		const { press } = setup();
		for (const [key, options, prevented] of [
			['z', { ctrlKey: true }, true], ['z', { ctrlKey: true, isComposing: true }, false],
			['z', { metaKey: true, altKey: true }, false], ['y', { metaKey: true, shiftKey: true }, false],
			['z', {}, false], ['c', { metaKey: true }, false],
			['a', { metaKey: true, altKey: true }, false], ['a', { metaKey: true, shiftKey: true }, false],
			['f', { metaKey: true, shiftKey: true }, false],
		] as Array<[string, Record<string, boolean>, boolean]>) {
			const { stop } = press(key, options, prevented); expect(stop).not.toHaveBeenCalled();
		}
		expect(runScopeHandlers).not.toHaveBeenCalled();
	});
	it('leaves native editable fields and controls outside the note alone', () => {
		const { dom, press } = setup();
		dom.field = true;
		expect(press('z', { ctrlKey: true }).event.defaultPrevented).toBe(false);
		dom.field = false; dom.inside = false;
		expect(press('z', { ctrlKey: true }).event.defaultPrevented).toBe(false);
		expect(runScopeHandlers).not.toHaveBeenCalled();
	});
	it('does not suppress a command that the keymap declines', () => {
		const { press } = setup(); vi.mocked(runScopeHandlers).mockReturnValueOnce(false);
		const { event, stop } = press('z', { metaKey: true });
		expect(event.defaultPrevented).toBe(false); expect(stop).not.toHaveBeenCalled();
	});
	it('removes the listener when the editor is disposed', () => {
		const { dom, plugin, press } = setup();
		const remove = vi.spyOn(dom, 'removeEventListener'); plugin.destroy();
		expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function), true);
		press('z', { ctrlKey: true }); expect(runScopeHandlers).not.toHaveBeenCalled();
	});
});
