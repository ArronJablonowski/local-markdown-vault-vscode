import { describe, expect, it } from 'vitest';
import {
	validateOutlineToHostMessage,
	validatePreviewToHostMessage,
	validateSidebarToHostMessage,
	validateHostToOutlineMessage,
	validateHostToPreviewMessage,
	validateHostToSidebarMessage,
} from './auxMessageValidation';

describe('auxiliary enum types', () => {
	for (const [key, value] of [['defaultEditor', 'livePreview'], ['defaultEditingMode', 'locked'], ['codeTheme', 'auto'], ['vaultOpenBehavior', 'reuseTab']]) {
		it(`rejects non-string ${key} without coercing attacker-controlled values`, () => {
			for (const malformed of [[value], { toString: null, valueOf: null }, null, 1, false]) {
				expect(validateSidebarToHostMessage({ type: 'setSetting', key, value: malformed }).ok).toBe(false);
			}
		});
	}
	it('rejects array or uncoercible theme kinds in preview updates', () => {
		for (const themeKind of [['vscode-dark'], { toString: null, valueOf: null }]) {
			expect(validateHostToPreviewMessage({ type: 'update', css: '', name: 'Theme', themeKind }).ok).toBe(false);
		}
	});
	it('rejects non-string settings and theme kinds in sidebar snapshots', () => {
		const settings = { defaultEditor: 'livePreview', defaultEditingMode: 'editing', codeTheme: 'auto', vaultOpenBehavior: 'reuseTab', showWhitespace: 'off', stickyTableHeaders: false };
		const message = { type: 'init', styles: [], settings, themeKind: 'vscode-dark', workspaceTrusted: true };
		for (const key of ['defaultEditor', 'defaultEditingMode', 'codeTheme', 'vaultOpenBehavior'] as const) {
			expect(validateHostToSidebarMessage({ ...message, settings: { ...settings, [key]: [settings[key]] } }).ok).toBe(false);
		}
		expect(validateHostToSidebarMessage({ ...message, themeKind: ['vscode-dark'] }).ok).toBe(false);
	});
});

describe('auxiliary webview message validation', () => {
	it('accepts only the on/off whitespace setting', () => {
		for (const value of ['on', 'off']) expect(validateSidebarToHostMessage({ type: 'setSetting', key: 'showWhitespace', value }).ok).toBe(true);
		for (const value of [true, 'all', {}, null]) expect(validateSidebarToHostMessage({ type: 'setSetting', key: 'showWhitespace', value }).ok).toBe(false);
	});
	it('accepts sticky table header setting changes only as exact booleans', () => {
		for (const value of [true, false]) expect(validateSidebarToHostMessage({ type: 'setSetting', key: 'stickyTableHeaders', value }).ok).toBe(true);
		for (const value of ['true', 'false', 'on', 'off', 0, 1, null, undefined, [], {}]) {
			expect(validateSidebarToHostMessage({ type: 'setSetting', key: 'stickyTableHeaders', value }).ok).toBe(false);
		}
		expect(validateSidebarToHostMessage({ type: 'setSetting', key: 'stickyTableHeaders', value: true, command: 'unsafe' }).ok).toBe(false);
	});
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
		expect(validateSidebarToHostMessage({ type: 'setSetting', key: 'defaultEditor', value: 'textEditor' }).ok).toBe(true);
		expect(validateSidebarToHostMessage({ type: 'setSetting', key: 'defaultEditor', value: 'markdownPreview' }).ok).toBe(true);
		expect(validateSidebarToHostMessage({ type: 'setSetting', key: 'defaultEditor', value: 'vscodeMarkdownEditor' }).ok).toBe(true);
		expect(validateSidebarToHostMessage({ type: 'setSetting', key: 'defaultEditor', value: 'markdownEditor' }).ok).toBe(true);
		expect(validateSidebarToHostMessage({ type: 'setSetting', key: 'defaultEditor', value: 'default' }).ok).toBe(false);
		expect(validateSidebarToHostMessage({ type: 'setSetting', key: 'defaultEditingMode', value: 'locked' }).ok).toBe(true);
		expect(validateSidebarToHostMessage({ type: 'setSetting', key: 'defaultEditingMode', value: 'arbitrary' }).ok).toBe(false);
		expect(validateSidebarToHostMessage({ type: 'setSetting', key: 'codeTheme', value: 'github-dark' }).ok).toBe(true);
		expect(validateSidebarToHostMessage({ type: 'setSetting', key: 'vaultOpenBehavior', value: 'reuseTab' }).ok).toBe(true);
		expect(validateSidebarToHostMessage({ type: 'setSetting', key: 'vaultOpenBehavior', value: 'newTab' }).ok).toBe(true);
		expect(validateSidebarToHostMessage({ type: 'setSetting', key: 'vaultOpenBehavior', value: 'replacePinnedTab' }).ok).toBe(false);
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
			settings: {
				defaultEditor: 'prompt',
				defaultEditingMode: 'editing',
				codeTheme: 'auto',
				vaultOpenBehavior: 'reuseTab',
				showWhitespace: 'off',
				stickyTableHeaders: false,
			},
			themeKind: 'vscode-dark',
			workspaceTrusted: false,
		};
		expect(validateHostToSidebarMessage(sidebar).ok).toBe(true);
		expect(validateHostToSidebarMessage({ ...sidebar, settings: { ...sidebar.settings, stickyTableHeaders: true } }).ok).toBe(true);
		for (const stickyTableHeaders of ['false', 'on', 1, null, undefined, []]) {
			expect(validateHostToSidebarMessage({ ...sidebar, settings: { ...sidebar.settings, stickyTableHeaders } }).ok).toBe(false);
		}
		expect(validateHostToSidebarMessage({ ...sidebar, workspaceTrusted: 'yes' }).ok).toBe(false);
		expect(validateHostToSidebarMessage({ ...sidebar, unexpected: true }).ok).toBe(false);
		expect(validateHostToSidebarMessage({ ...sidebar, settings: { ...sidebar.settings, codeTheme: 'remote-theme' } }).ok).toBe(false);
		expect(validateHostToSidebarMessage({ ...sidebar, styles: [{ id: 'large.css', name: 'large.css', enabled: false, css: '😀'.repeat(300_000) }] }).ok).toBe(false);
	});
});
