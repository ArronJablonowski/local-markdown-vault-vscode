import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { clipboardShortcuts, isClipboardShortcut } from './clipboardShortcuts';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const destroy of cleanup.splice(0)) destroy(); vi.unstubAllGlobals(); });

function gesture(key: string, options: Record<string, boolean>, execCommand = vi.fn()) {
	const ownerDocument = Object.assign(new EventTarget(), { execCommand });
	const dom = Object.assign(new EventTarget(), { ownerDocument, contains: (target: unknown): boolean => target === dom });
	const view = { dom } as unknown as EditorView;
	const plugin = (clipboardShortcuts as any).create(view);
	cleanup.push(() => plugin.destroy());
	const event = Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key, ...options });
	const stop = vi.spyOn(event, 'stopPropagation');
	dom.dispatchEvent(event);
	return { event, stop, dom, plugin, ownerDocument };
}

function dispatchClipboard(ownerDocument: EventTarget, target: EventTarget, command: string): Event {
	const event = new Event(command, { bubbles: true, cancelable: true });
	// EventTarget has no DOM ancestry. Deliver the document capture phase first.
	Object.defineProperty(event, 'target', { value: target });
	ownerDocument.dispatchEvent(event);
	target.dispatchEvent(event);
	return event;
}

describe('clipboard shortcut containment', () => {
	it('shares only unmodified Copy/Cut and ordinary or shifted Paste chords with controls', () => {
		for (const modifier of ['metaKey', 'ctrlKey']) {
			for (const key of ['c', 'x', 'v', 'C', 'X', 'V']) {
				const event = { key, [modifier]: true } as unknown as KeyboardEvent;
				expect(isClipboardShortcut(event)).toBe(true);
				expect(isClipboardShortcut({ ...event, shiftKey: true } as KeyboardEvent)).toBe(key.toLowerCase() === 'v');
				expect(isClipboardShortcut({ ...event, altKey: true } as KeyboardEvent)).toBe(false);
				expect(isClipboardShortcut({ ...event, isComposing: true } as KeyboardEvent)).toBe(false);
			}
		}
		expect(isClipboardShortcut({ key: 'v' } as KeyboardEvent)).toBe(false);
		expect(isClipboardShortcut({ key: 'a', metaKey: true } as KeyboardEvent)).toBe(false);
	});

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

	describe.each([
		['c', 'copy'], ['x', 'cut'], ['v', 'paste'], ['V', 'paste'],
	] as const)('trusted native %s command', (key, command) => {
		for (const modifier of ['metaKey', 'ctrlKey']) {
			it.each(['success', 'unsupported', 'throws'] as const)(`${modifier} handles %s without an asynchronous replay`, outcome => {
				const execCommand = vi.fn(() => { if (outcome === 'throws') throw new Error('Clipboard unavailable'); return outcome === 'success'; });
				const { plugin } = gesture(key, { [modifier]: true }, execCommand);
				const event = { key, [modifier]: true, shiftKey: key === 'V', isTrusted: true,
					stopPropagation: vi.fn(), preventDefault: vi.fn() };
				expect(() => plugin.keydown(event)).not.toThrow();
				expect(execCommand).toHaveBeenCalledExactlyOnceWith(command);
				expect(event.stopPropagation).toHaveBeenCalledOnce();
				expect(event.preventDefault).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0);
			});

			it(`${modifier} does not replay an already-handled gesture`, () => {
				const execCommand = vi.fn();
				const { plugin } = gesture(key, { [modifier]: true }, execCommand);
				const event = { key, [modifier]: true, shiftKey: key === 'V', isTrusted: true, defaultPrevented: true,
					stopPropagation: vi.fn(), preventDefault: vi.fn() };
				plugin.keydown(event);
				expect(execCommand).not.toHaveBeenCalled();
				expect(event.preventDefault).not.toHaveBeenCalled();
			});
		}
	});

	describe.each([['c', 'copy'], ['x', 'cut'], ['v', 'paste']] as const)('delivered %s events', (key, command) => {
		it.each(['false', 'throws'] as const)('prevents duplicate commands when a canceled event is delivered but the command returns %s', outcome => {
			const { dom, plugin, ownerDocument } = gesture(key, { metaKey: true });
			const canceledClipboard = vi.fn((event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); });
			dom.addEventListener(command, canceledClipboard);
			const remove = vi.spyOn(ownerDocument, 'removeEventListener');
			const execCommand = vi.fn(() => {
				dispatchClipboard(ownerDocument, dom, command);
				if (outcome === 'throws') throw new Error('Clipboard command failed after dispatch');
				return false;
			});
			ownerDocument.execCommand = execCommand;
			const event = { key, metaKey: true, isTrusted: true, stopPropagation: vi.fn(), preventDefault: vi.fn() };
			expect(() => plugin.keydown(event)).not.toThrow();
			expect(canceledClipboard).toHaveBeenCalledOnce();
			expect(event.preventDefault).toHaveBeenCalledOnce();
			expect(execCommand).toHaveBeenCalledOnce();
			expect(remove).toHaveBeenCalledWith(command, expect.any(Function), true);
		});

		it('does not mistake another editor clipboard event for a delivered command', () => {
			const { plugin, ownerDocument } = gesture(key, { metaKey: true });
			ownerDocument.execCommand = vi.fn(() => {
				dispatchClipboard(ownerDocument, new EventTarget(), command);
				return false;
			});
			const event = { key, metaKey: true, isTrusted: true, stopPropagation: vi.fn(), preventDefault: vi.fn() };
			plugin.keydown(event);
			expect(event.preventDefault).not.toHaveBeenCalled();
		});
	});

	it.each(['c', 'x', 'v', 'V'])('never accesses the native clipboard for synthetic %s shortcuts', key => {
		const execCommand = vi.fn();
		gesture(key, { ctrlKey: true, shiftKey: key === 'V' }, execCommand);
		expect(execCommand).not.toHaveBeenCalled();
	});
});
