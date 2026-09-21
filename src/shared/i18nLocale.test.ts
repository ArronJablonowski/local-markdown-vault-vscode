import { describe, expect, it } from 'vitest';
import { t } from './i18n';

describe('English-only webview messages', () => {
	it('does not change the interface language when the host locale changes', () => {
		(globalThis as { mlpLocale?: string }).mlpLocale = 'fr-FR';
		expect(t('outline.empty')).toBe('No headings.');
		delete (globalThis as { mlpLocale?: string }).mlpLocale;
	});
});
