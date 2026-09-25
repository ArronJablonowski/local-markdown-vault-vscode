import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('sticky table header preference', () => {
	beforeEach(() => vi.resetModules());
	it('defaults to off without a host message', async () => {
		const settings = await import('./tableHeaderSettings');
		expect(settings.stickyTableHeadersEnabled()).toBe(false);
	});
	it('notifies mounted tables only on changes and supports DOM cleanup', async () => {
		const settings = await import('./tableHeaderSettings');
		const listener = vi.fn();
		const dispose = settings.onStickyTableHeadersChange(listener);
		settings.setStickyTableHeaders(false);
		expect(listener).not.toHaveBeenCalled();
		settings.setStickyTableHeaders(true);
		expect(settings.stickyTableHeadersEnabled()).toBe(true);
		expect(listener).toHaveBeenCalledTimes(1);
		settings.setStickyTableHeaders(true);
		expect(listener).toHaveBeenCalledTimes(1);
		settings.setStickyTableHeaders(false);
		expect(settings.stickyTableHeadersEnabled()).toBe(false);
		expect(listener).toHaveBeenCalledTimes(2);
		dispose();
		settings.setStickyTableHeaders(true);
		expect(listener).toHaveBeenCalledTimes(2);
	});
	it('fails closed for a nonboolean value', async () => {
		const settings = await import('./tableHeaderSettings');
		settings.setStickyTableHeaders('true' as unknown as boolean);
		expect(settings.stickyTableHeadersEnabled()).toBe(false);
	});
});
