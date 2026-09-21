import { describe, expect, it } from 'vitest';
import { PendingLineNavigation } from './pendingLineNavigation';

describe('pending Live Preview line navigation', () => {
	it('delivers a valid line immediately when the webview is ready', () => {
		const navigation = new PendingLineNavigation();
		expect(navigation.request(4, 10, true)).toBe(4);
		expect(navigation.flush(true)).toBeUndefined();
	});

	it('retains only the newest line while the webview is unavailable', () => {
		const navigation = new PendingLineNavigation();
		expect(navigation.request(2, 10, false)).toBeUndefined();
		expect(navigation.request(7, 10, false)).toBeUndefined();
		expect(navigation.flush(true)).toBe(7);
		expect(navigation.flush(true)).toBeUndefined();
	});

	it('does not release a pending line until delivery is possible', () => {
		const navigation = new PendingLineNavigation();
		navigation.request(3, 10, false);
		expect(navigation.flush(false)).toBeUndefined();
		expect(navigation.flush(true)).toBe(3);
	});

	it('rejects non-integer and out-of-document lines without replacing a valid pending jump', () => {
		const navigation = new PendingLineNavigation();
		navigation.request(5, 10, false);
		for (const invalid of [0, -1, 1.5, 11, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(navigation.request(invalid, 10, false)).toBeUndefined();
		}
		expect(navigation.flush(true)).toBe(5);
	});
});
