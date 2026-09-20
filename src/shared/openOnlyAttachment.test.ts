import { describe, expect, it } from 'vitest';
import { isOpenOnlyAttachmentTarget, normalizeOpenOnlyAttachmentTarget } from './openOnlyAttachment';

describe('open-only attachment targets', () => {
	it('accepts PDF and audio paths, including encoded names and vault-root notation', () => {
		expect(normalizeOpenOnlyAttachmentTarget('/References/My%20Paper.PDF')).toBe('References/My Paper.PDF');
		expect(normalizeOpenOnlyAttachmentTarget('Audio\\meeting.m4a')).toBe('Audio/meeting.m4a');
		expect(isOpenOnlyAttachmentTarget('recording.FLAC')).toBe(true);
		expect(isOpenOnlyAttachmentTarget('voice.3gp')).toBe(true);
		expect(isOpenOnlyAttachmentTarget('voice.webm')).toBe(true);
	});

	it('rejects protocols, absolute paths, traversal, malformed encoding, and controls', () => {
		for (const target of [
			'https://example.test/pixel.mp3',
			'javascript:alert(1).pdf',
			'https%3A%2F%2Fexample.test%2Fpixel.mp3',
			'C:\\Windows\\secret.pdf',
			'C%3A%5CWindows%5Csecret.pdf',
			'//server/share/file.pdf',
			'../../secret.pdf',
			'%2e%2e/secret.pdf',
			'folder//file.pdf',
			'bad%2',
			'bad\nfile.pdf',
		]) expect(normalizeOpenOnlyAttachmentTarget(target)).toBeUndefined();
		expect(normalizeOpenOnlyAttachmentTarget(`${'deep/'.repeat(65)}file.pdf`)).toBeUndefined();
	});

	it('does not broaden the allowlist to executable, active, or unknown formats', () => {
		for (const target of ['tool.exe', 'page.html', 'active.svg', 'diagram.drawio', 'movie.mp4', 'note.md']) {
			expect(isOpenOnlyAttachmentTarget(target)).toBe(false);
		}
	});
});
