import { describe, expect, it } from 'vitest';
import {
	validateOutlineToHostMessage,
	validatePreviewToHostMessage,
	validateSidebarToHostMessage,
	validateHostToOutlineMessage,
	validateHostToPreviewMessage,
	validateHostToSidebarMessage,
} from './auxMessageValidation';

describe('auxiliary webview message validation', () => {
	it('accepts exact benign messages', () => {
		expect(validateOutlineToHostMessage({ type: 'jumpToHeading', line: 3 }).ok).toBe(true);
		expect(validatePreviewToHostMessage({ type: 'ready' }).ok).toBe(true);
		expect(validateSidebarToHostMessage({ type: 'toggle', id: 'theme.css', enabled: true }).ok).toBe(true);
	});

	it('rejects unknown fields, unsafe ids, and arbitrary settings', () => {
		expect(validateOutlineToHostMessage({ type: 'ready', command: 'x' }).ok).toBe(false);
		expect(validateSidebarToHostMessage({ type: 'deleteStyle', id: '../outside.css' }).ok).toBe(false);
		expect(validateSidebarToHostMessage({ type: 'setSetting', key: 'remoteMedia', value: 'https' }).ok).toBe(false);
		expect(validateSidebarToHostMessage({ type: 'setSetting', key: 'defaultEditor', value: 'arbitrary' }).ok).toBe(false);
		expect(validateSidebarToHostMessage({ type: 'setSetting', key: 'codeTheme', value: 'https://remote.invalid' }).ok).toBe(false);
		expect(validateSidebarToHostMessage({ type: 'setSetting', key: 'defaultEditor', value: 'livePreview' }).ok).toBe(true);
		expect(validateSidebarToHostMessage({ type: 'setSetting', key: 'codeTheme', value: 'github-dark' }).ok).toBe(true);
	});

	it('validates messages sent into auxiliary webviews', () => {
		expect(validateHostToOutlineMessage({ type: 'update', headings: [{ level: 2, text: 'Title', line: 4 }] }).ok).toBe(true);
		expect(validateHostToOutlineMessage({ type: 'update', headings: [{ level: 99, text: 'Title', line: 4 }] }).ok).toBe(false);
		expect(validateHostToPreviewMessage({ type: 'highlight', selector: null }).ok).toBe(true);
		expect(validateHostToPreviewMessage({ type: 'highlight', selector: 'x'.repeat(5000) }).ok).toBe(false);
		expect(validateHostToPreviewMessage({
			type: 'update', css: '😀'.repeat(300_000), themeKind: 'vscode-dark', name: 'large.css',
		}).ok).toBe(false);
		const sidebar = {
			type: 'init',
			styles: [],
			settings: { defaultEditor: 'prompt', codeTheme: 'auto' },
			themeKind: 'vscode-dark',
			workspaceTrusted: false,
		};
		expect(validateHostToSidebarMessage(sidebar).ok).toBe(true);
		expect(validateHostToSidebarMessage({ ...sidebar, workspaceTrusted: 'yes' }).ok).toBe(false);
		expect(validateHostToSidebarMessage({ ...sidebar, unexpected: true }).ok).toBe(false);
		expect(validateHostToSidebarMessage({ ...sidebar, settings: { ...sidebar.settings, codeTheme: 'remote-theme' } }).ok).toBe(false);
		expect(validateHostToSidebarMessage({ ...sidebar, styles: [{ id: 'large.css', name: 'large.css', enabled: false, css: '😀'.repeat(300_000) }] }).ok).toBe(false);
	});
});
