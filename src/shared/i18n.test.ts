import { describe, expect, it } from 'vitest';
import { escapeAttribute, t } from './i18n';

describe('US English webview messages', () => {
	it('returns the English text', () => {
		expect(t('outline.empty')).toBe('No headings.');
	});

	it('substitutes positional placeholders', () => {
		expect(t('drawio.loading', 'diagram.drawio')).toBe('Loading diagram.drawio…');
	});

	it('leaves a placeholder intact when no argument supplies it', () => {
		expect(t('drawio.loadFailed')).toBe('Failed to load the draw.io file: {0}');
	});

	it('escapes host-provided attribute values', () => {
		expect(escapeAttribute(`A&B<\"'`)).toBe('A&amp;B&lt;&quot;&#39;');
	});
});
