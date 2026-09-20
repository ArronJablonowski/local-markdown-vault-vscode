import { describe, expect, it } from 'vitest';
import { makePersistedEditorState, parsePersistedEditorState } from './persistedState';

describe('persisted editor state', () => {
	it('accepts the bounded selection and scroll state needed to restore a hidden editor', () => {
		expect(parsePersistedEditorState({ version: 1, anchor: 3, head: 8, scrollTop: 120.5 }, 10)).toEqual({
			version: 1,
			anchor: 3,
			head: 8,
			scrollTop: 120.5,
		});
	});

	it.each([
		null,
		{ version: 2, anchor: 0, head: 0, scrollTop: 0 },
		{ version: 1, anchor: -1, head: 0, scrollTop: 0 },
		{ version: 1, anchor: 0, head: 11, scrollTop: 0 },
		{ version: 1, anchor: 0.5, head: 0, scrollTop: 0 },
		{ version: 1, anchor: 0, head: 0, scrollTop: Number.NaN },
		{ version: 1, anchor: 0, head: 0, scrollTop: 1_000_000_001 },
		{ version: 1, anchor: 0, head: 0, scrollTop: 0, text: 'must not be persisted' },
	])('rejects malformed, stale, excessive, or content-bearing state %#', (value) => {
		expect(parsePersistedEditorState(value, 10)).toBeUndefined();
	});

	it('refuses to construct a state from non-finite browser measurements', () => {
		expect(makePersistedEditorState(1, 1, Number.POSITIVE_INFINITY)).toBeUndefined();
	});
});
