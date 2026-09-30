import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDarkDiagramTheme, onDiagramThemeChange } from './diagramTheme';

function fixture() {
	const classes = new Set(['vscode-dark']);
	const owner = { body: { classList: { contains: (name: string) => classes.has(name) } } } as unknown as Document;
	const observers: Array<{ notify: () => void; disconnect: ReturnType<typeof vi.fn>; observe: ReturnType<typeof vi.fn> }> = [];
	vi.stubGlobal('MutationObserver', class {
		observe = vi.fn();
		disconnect = vi.fn();
		constructor(readonly notify: () => void) { observers.push(this); }
	});
	return { owner, classes, observers };
}

afterEach(() => vi.unstubAllGlobals());

describe('diagram theme subscriptions', () => {
	it('shares one observer, ignores unrelated classes, and notifies only palette changes', () => {
		const { owner, classes, observers } = fixture();
		const first = vi.fn(), second = vi.fn();
		const offFirst = onDiagramThemeChange(first, owner);
		const offSecond = onDiagramThemeChange(second, owner);
		expect(observers).toHaveLength(1);
		classes.add('mlp-sticky-table-headers'); observers[0].notify();
		expect(first).not.toHaveBeenCalled();
		classes.delete('vscode-dark'); classes.add('vscode-light'); observers[0].notify();
		expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
		offFirst(); classes.add('vscode-high-contrast'); observers[0].notify();
		expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(2);
		offSecond(); expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
	});

	it('does not let repeated disposal remove a newer observer', () => {
		const { owner, classes, observers } = fixture();
		const old = onDiagramThemeChange(vi.fn(), owner); old();
		const current = vi.fn(); const offCurrent = onDiagramThemeChange(current, owner);
		old(); classes.delete('vscode-dark'); observers[1].notify();
		expect(current).toHaveBeenCalledTimes(1);
		offCurrent();
	});

	it('treats high contrast light as light and dark high contrast as dark', () => {
		const { owner, classes } = fixture();
		expect(isDarkDiagramTheme(owner)).toBe(true);
		classes.clear(); classes.add('vscode-high-contrast-light');
		expect(isDarkDiagramTheme(owner)).toBe(false);
		classes.clear(); classes.add('vscode-high-contrast');
		expect(isDarkDiagramTheme(owner)).toBe(true);
	});
});
