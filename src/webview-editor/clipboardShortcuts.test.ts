import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { clipboardShortcuts } from './clipboardShortcuts';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const destroy of cleanup.splice(0)) destroy(); vi.unstubAllGlobals(); });

function gesture(key: string, options: Record<string, boolean>) {
	const dom = new EventTarget();
	const view = { dom } as unknown as EditorView;
	const plugin = (clipboardShortcuts as any).create(view);
	cleanup.push(() => plugin.destroy());
	const event = Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key, ...options });
	const stop = vi.spyOn(event, 'stopPropagation');
	dom.dispatchEvent(event);
	return { event, stop, dom, plugin };
}

describe('clipboard shortcut containment', () => {
	it.each(['metaKey', 'ctrlKey'])('keeps ordinary clipboard commands local with %s without suppressing native events', modifier => {
		for (const key of ['c', 'x', 'v']) {
			const { event, stop } = gesture(key, { [modifier]: true });
			expect(stop).toHaveBeenCalledOnce(); expect(event.defaultPrevented).toBe(false);
		}
	});

	it.each(['metaKey', 'ctrlKey'])('keeps Shift+Paste local with %s without preventing plain-text paste', modifier => {
		for (const key of ['v', 'V']) {
			const { event, stop } = gesture(key, { [modifier]: true, shiftKey: true });
			expect(stop).toHaveBeenCalledOnce(); expect(event.defaultPrevented).toBe(false);
		}
	});

	it('leaves unrelated shifted, alternative, composition, and unmodified shortcuts alone', () => {
		for (const [key, options] of [
			['c', { metaKey: true, shiftKey: true }], ['x', { ctrlKey: true, shiftKey: true }],
			['v', { ctrlKey: true, altKey: true }], ['v', { metaKey: true, isComposing: true }], ['v', {}],
		] as Array<[string, Record<string, boolean>]>) {
			const { event, stop } = gesture(key, options);
			expect(stop).not.toHaveBeenCalled(); expect(event.defaultPrevented).toBe(false);
		}
	});

	it('removes its listener on disposal', () => {
		const { dom, plugin } = gesture('v', { ctrlKey: true });
		plugin.destroy();
		const event = Object.assign(new Event('keydown'), { key: 'v', ctrlKey: true });
		const stop = vi.spyOn(event, 'stopPropagation'); dom.dispatchEvent(event);
		expect(stop).not.toHaveBeenCalled();
	});

	describe.each(['metaKey', 'ctrlKey'])('trusted native paste with %s', modifier => {
		it.each([
			[false, 'success'], [false, 'unsupported'], [false, 'throws'],
			[true, 'success'], [true, 'unsupported'], [true, 'throws'],
		] as const)('handles shifted=%s command=%s without an asynchronous replay', (shiftKey, outcome) => {
			const execCommand = vi.fn(() => { if (outcome === 'throws') throw new Error('Clipboard unavailable'); return outcome === 'success'; });
			vi.stubGlobal('document', { execCommand });
			const { plugin } = gesture('v', { [modifier]: true });
			const event = { key: shiftKey ? 'V' : 'v', [modifier]: true, shiftKey, isTrusted: true,
				stopPropagation: vi.fn(), preventDefault: vi.fn() };
			expect(() => plugin.keydown(event)).not.toThrow();
			expect(execCommand).toHaveBeenCalledExactlyOnceWith('paste');
			expect(event.stopPropagation).toHaveBeenCalledOnce();
			expect(event.preventDefault).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0);
		});

		it.each([false, true])('does not replay an already-handled shifted=%s gesture', shiftKey => {
			const execCommand = vi.fn(); vi.stubGlobal('document', { execCommand });
			const { plugin } = gesture('v', { [modifier]: true });
			const event = { key: 'v', [modifier]: true, shiftKey, isTrusted: true, defaultPrevented: true,
				stopPropagation: vi.fn(), preventDefault: vi.fn() };
			plugin.keydown(event);
			expect(execCommand).not.toHaveBeenCalled();
			expect(event.preventDefault).not.toHaveBeenCalled();
		});
	});

	it.each(['false', 'throws'] as const)('prevents duplicate paste when a canceled event is delivered but the command returns %s', outcome => {
		const { dom, plugin } = gesture('v', { metaKey: true });
		const canceledPaste = vi.fn((event: Event) => event.preventDefault());
		dom.addEventListener('paste', canceledPaste);
		const remove = vi.spyOn(dom, 'removeEventListener');
		const execCommand = vi.fn(() => {
			dom.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }));
			if (outcome === 'throws') throw new Error('Clipboard command failed after dispatch');
			return false;
		});
		vi.stubGlobal('document', { execCommand });
		const event = { key: 'v', metaKey: true, isTrusted: true, stopPropagation: vi.fn(), preventDefault: vi.fn() };
		expect(() => plugin.keydown(event)).not.toThrow();
		expect(canceledPaste).toHaveBeenCalledOnce();
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(execCommand).toHaveBeenCalledOnce();
		expect(remove).toHaveBeenCalledWith('paste', expect.any(Function), true);
	});

	it.each([false, true])('never accesses the native clipboard for synthetic shifted=%s shortcuts', shiftKey => {
		const execCommand = vi.fn(); vi.stubGlobal('document', { execCommand });
		gesture('v', { ctrlKey: true, shiftKey });
		expect(execCommand).not.toHaveBeenCalled();
	});
});
