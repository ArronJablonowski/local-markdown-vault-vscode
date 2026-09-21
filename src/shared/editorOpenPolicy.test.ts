import { describe, expect, it } from 'vitest';
import { shouldOpenInLivePreview } from './editorOpenPolicy';

describe('configured Markdown editor selection', () => {
	it('uses Live Preview for both supported Markdown extensions', () => {
		expect(shouldOpenInLivePreview('/Vault/Note.md', 'livePreview')).toBe(true);
		expect(shouldOpenInLivePreview('/Vault/Note.MARKDOWN', 'livePreview')).toBe(true);
	});

	it('leaves attachments and non-Live-Preview preferences with VS Code', () => {
		expect(shouldOpenInLivePreview('/Vault/Attachment.pdf', 'livePreview')).toBe(false);
		expect(shouldOpenInLivePreview('/Vault/Note.md', 'default')).toBe(false);
		expect(shouldOpenInLivePreview('/Vault/Note.md', 'prompt')).toBe(false);
		expect(shouldOpenInLivePreview('/Vault/Note.md', undefined)).toBe(false);
	});

	it('does not mistake a suffix or query-like string for a Markdown extension', () => {
		expect(shouldOpenInLivePreview('/Vault/Note.md.exe', 'livePreview')).toBe(false);
		expect(shouldOpenInLivePreview('/Vault/Note.md?download=1', 'livePreview')).toBe(false);
	});
});
