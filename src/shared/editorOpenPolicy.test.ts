import { describe, expect, it } from 'vitest';
import {
	configuredEditorViewTypeForPath,
	editorViewType,
	normalizeDefaultEditorSetting,
	shouldOpenInLivePreview,
} from './editorOpenPolicy';

describe('configured Markdown editor selection', () => {
	it('uses Live Preview for both supported Markdown extensions', () => {
		expect(shouldOpenInLivePreview('/Vault/Note.md', 'livePreview')).toBe(true);
		expect(shouldOpenInLivePreview('/Vault/Note.MARKDOWN', 'livePreview')).toBe(true);
		expect(shouldOpenInLivePreview('/Vault/Note.md', 'markdownEditor')).toBe(false);
	});

	it('leaves attachments and non-Live-Preview preferences with VS Code', () => {
		expect(shouldOpenInLivePreview('/Vault/Attachment.pdf', 'livePreview')).toBe(false);
		expect(shouldOpenInLivePreview('/Vault/Note.md', 'vscodeMarkdownEditor')).toBe(false);
		expect(shouldOpenInLivePreview('/Vault/Note.md', 'prompt')).toBe(false);
		expect(shouldOpenInLivePreview('/Vault/Note.md', undefined)).toBe(true);
	});

	it('maps every explicit viewing mode to its actual VS Code editor', () => {
		expect(editorViewType('prompt')).toBeUndefined();
		expect(editorViewType('textEditor')).toBe('default');
		expect(editorViewType('markdownPreview')).toBe('vscode.markdown.preview.editor');
		expect(editorViewType('vscodeMarkdownEditor')).toBe('vscode.markdown.editor');
		expect(editorViewType('markdownEditor')).toBe('vscode.markdown.editor');
		expect(editorViewType('livePreview')).toBe('mdLivePreview.editor');
	});

	it('migrates the legacy mislabeled default value to Markdown Editor', () => {
		expect(normalizeDefaultEditorSetting('default')).toBe('markdownEditor');
		expect(editorViewType('default')).toBe('vscode.markdown.editor');
	});

	it('uses Markdown Live Preview when no valid setting has been stored', () => {
		expect(normalizeDefaultEditorSetting(undefined)).toBe('livePreview');
		expect(normalizeDefaultEditorSetting('invalid')).toBe('livePreview');
		expect(editorViewType(undefined)).toBe('mdLivePreview.editor');
	});

	it('only applies viewing modes to Markdown files', () => {
		expect(configuredEditorViewTypeForPath('/Vault/Note.md', 'markdownPreview'))
			.toBe('vscode.markdown.preview.editor');
		expect(configuredEditorViewTypeForPath('/Vault/file.pdf', 'markdownPreview')).toBeUndefined();
	});

	it('does not mistake a suffix or query-like string for a Markdown extension', () => {
		expect(shouldOpenInLivePreview('/Vault/Note.md.exe', 'livePreview')).toBe(false);
		expect(shouldOpenInLivePreview('/Vault/Note.md?download=1', 'livePreview')).toBe(false);
	});
});
