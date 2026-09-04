import { describe, expect, it } from 'vitest';
import { catalogFor, t } from './i18n';

describe('catalogFor', () => {
	it('matches a bare language tag', () => {
		expect(catalogFor('ja')['outline.empty']).toBe('見出しがありません。');
	});

	it('ignores the region subtag', () => {
		expect(catalogFor('ja-JP')['outline.empty']).toBe('見出しがありません。');
		expect(catalogFor('ja_JP')['outline.empty']).toBe('見出しがありません。');
	});

	it('is case-insensitive', () => {
		expect(catalogFor('JA-jp')['outline.empty']).toBe('見出しがありません。');
	});

	it('returns an empty catalog for untranslated and missing locales', () => {
		expect(catalogFor('en')).toEqual({});
		expect(catalogFor('de-DE')).toEqual({});
		expect(catalogFor(undefined)).toEqual({});
		expect(catalogFor('')).toEqual({});
	});
});

describe('t', () => {
	// No host locale is stamped under test, so the active catalog is English.
	it('returns the English text', () => {
		expect(t('outline.empty')).toBe('No headings.');
	});

	it('substitutes positional placeholders', () => {
		expect(t('drawio.loading', 'diagram.drawio')).toBe('Loading diagram.drawio…');
	});

	it('leaves a placeholder alone when no argument supplies it', () => {
		expect(t('drawio.loadFailed')).toBe('Failed to load the draw.io file: {0}');
	});

	it('keeps every Japanese entry in step with the English keys', () => {
		const ja = catalogFor('ja');
		const keys = Object.keys(ja);
		expect(keys.length).toBeGreaterThan(0);
		for (const key of keys) {
			expect(t(key as never)).toBeTypeOf('string');
		}
	});
});
