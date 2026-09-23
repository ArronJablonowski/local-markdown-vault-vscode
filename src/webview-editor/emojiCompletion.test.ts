import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { emojiCompletions } from './emojiCompletion';

function complete(doc: string, pos = doc.length) {
	const state = EditorState.create({ doc, extensions: [markdown()] });
	return emojiCompletions(new CompletionContext(state, pos, true));
}

describe('offline emoji completion', () => {
	it('inserts Unicode rather than nonportable shortcodes', () => {
		expect(complete('Hello :smile')?.options[0]).toMatchObject({ label: ':smile:', apply: '😄' });
		expect(complete(':warning:')).toMatchObject({ from: 0, to: 9 });
		expect(complete(':heart')?.options[0].apply).toBe('❤️');
	});
	it('does not modify unsupported shortcodes, URLs, or identifiers', () => {
		for (const doc of [':unknown:', 'https://host/:smile', 'name:smile', ':', ':' + 'a'.repeat(33)]) {
			expect(complete(doc)).toBeNull();
		}
	});
	it('does not offer emoji in code or link destinations', () => {
		for (const doc of ['```\n:smile\n```', '` :smile `', '[link](https://host/:smile)']) {
			expect(complete(doc, doc.indexOf(':smile') + 6)).toBeNull();
		}
	});
});
