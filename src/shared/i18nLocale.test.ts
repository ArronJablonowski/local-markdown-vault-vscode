import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * `t()` binds its catalog at import time from `globalThis.mlpLocale`, the way a
 * webview bundle does when the host stamps the locale into the page. These
 * tests re-import the module with the global set, to prove a Japanese webview
 * actually gets Japanese.
 */
describe('locale binding at import time', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		delete (globalThis as { mlpLocale?: string }).mlpLocale;
	});

	it('serves Japanese when the host stamps a Japanese locale', async () => {
		(globalThis as { mlpLocale?: string }).mlpLocale = 'ja';
		const { t } = await import('./i18n');
		expect(t('outline.empty')).toBe('見出しがありません。');
	});

	it('accepts a region-qualified tag', async () => {
		(globalThis as { mlpLocale?: string }).mlpLocale = 'ja-JP';
		const { t } = await import('./i18n');
		expect(t('sidebar.applied')).toBe('適用中');
	});

	it('substitutes placeholders in the translated text', async () => {
		(globalThis as { mlpLocale?: string }).mlpLocale = 'ja';
		const { t } = await import('./i18n');
		expect(t('drawio.loading', 'a.drawio')).toBe('a.drawio を読み込んでいます…');
	});

	it('falls back to English for an untranslated locale', async () => {
		(globalThis as { mlpLocale?: string }).mlpLocale = 'de-DE';
		const { t } = await import('./i18n');
		expect(t('outline.empty')).toBe('No headings.');
	});

	it('falls back to English when the host stamps nothing', async () => {
		const { t } = await import('./i18n');
		expect(t('outline.empty')).toBe('No headings.');
	});
});
