import { describe, expect, it } from 'vitest';
import { quoteCalloutPaste } from './calloutPaste';
import { MAX_EDITOR_DOCUMENT_BYTES } from '../shared/messageValidation';

describe('bounded callout paragraph paste', () => {
	it('preserves paragraphs, blank lines, Unicode, and normalized line endings', () => {
		expect(quoteCalloutPaste('First Ω\r\n\r\nNext 🚀\rLast', '> > ')).toBe('First Ω\n> > \n> > Next 🚀\n> > Last');
	});
	it('preserves clipboard Markdown and HTML as source, not generated DOM', () => {
		expect(quoteCalloutPaste('> Nested\n<script>bad()</script>\n- Item', '> ')).toBe('> Nested\n> <script>bad()</script>\n> - Item');
	});
	it('reuses only a final untouched destination prefix', () => {
		expect(quoteCalloutPaste('One\n\n', '> ', true)).toBe('One\n> \n');
		expect(quoteCalloutPaste('One\nTwo', '> ', true)).toBe('One\n> Two');
	});
	it('rejects oversized original clipboard data', () => {
		expect(quoteCalloutPaste('a'.repeat(MAX_EDITOR_DOCUMENT_BYTES + 1), '> ')).toBeUndefined();
	});
	it('rejects excessive prefix amplification before allocating the expanded text', () => {
		expect(quoteCalloutPaste('a\n'.repeat(600000), '> '.repeat(20))).toBeUndefined();
	});
});
