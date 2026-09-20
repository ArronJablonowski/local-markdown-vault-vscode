import { describe, it, expect } from 'vitest';
import { resolveLinkTarget } from './linkTarget';

describe('resolveLinkTarget', () => {
	describe('links the shell should handle', () => {
		it.each(['https://example.com', 'mailto:a@b.c'])(
			'sends %s to the shell unchanged',
			(href) => {
				expect(resolveLinkTarget(href)).toEqual({ kind: 'external', href });
			},
		);

		it('classifies plain HTTP separately so the host can require confirmation', () => {
			const href = 'http://example.com/a?b=1';
			expect(resolveLinkTarget(href)).toEqual({ kind: 'insecureHttp', href });
		});
	});

	describe('links that must never be activated', () => {
		it.each([
			'javascript:alert(1)',
			'x:payload',
			'C:relative-drive-path.md',
			'command:workbench.action.openSettings',
			'vscode://settings',
			'file:///c:/x.md',
			'data:text/html,hello',
			'blob:https://example.com/id',
			'//example.com/tracker.png',
			'\\\\server\\share\\note.md',
			'/etc/passwd',
			'C:/notes/a.md',
			'%2Fetc/passwd',
			'%5C%5Cserver%5Cshare',
			'guide%00.md',
			'https://example.com/ok\ncommand:workbench.action.closeWindow',
			'100%.md',
			'https:missing-authority.example',
			'https:/missing-slash.example',
			'http:missing-authority.example',
			'mailto:',
			'mailto:a@example.com?subject=hello%0d%0abcc:attacker@example.com',
			'mailto:a@example.com?body=hello%00world',
			'mailto:a@example.com?subject=%ZZ',
		])('blocks %s', (value) => {
			expect(resolveLinkTarget(value)).toEqual({ kind: 'blocked', value });
		});
	});

	describe('links relative to the document', () => {
		// The bug this guards: `Uri.parse('./guide.md')` yields a scheme-less URI
		// that resolves against nothing, and the shell was handed a path it could
		// not find — surfacing as a "file not found (0x2)" dialog.
		it.each(['./guide.md', '../notes/a.md', 'guide.md', 'sub/dir/deep.md'])('treats %s as relative', (href) => {
			expect(resolveLinkTarget(href)).toEqual({ kind: 'relative', path: href });
		});

		it('strips a trailing fragment so it cannot land in the filename', () => {
			expect(resolveLinkTarget('guide.md#installation')).toEqual({ kind: 'relative', path: 'guide.md', fragment: '#installation' });
		});

		it('strips a local query while preserving a following fragment', () => {
			expect(resolveLinkTarget('diagram.drawio?v=2')).toEqual({ kind: 'relative', path: 'diagram.drawio' });
			expect(resolveLinkTarget('guide.md?view=preview#installation')).toEqual({
				kind: 'relative', path: 'guide.md', fragment: '#installation',
			});
		});

		it('decodes a target fragment independently from its file path', () => {
			expect(resolveLinkTarget('my%20note.md#Install%20Guide')).toEqual({
				kind: 'relative', path: 'my note.md', fragment: '#Install Guide',
			});
		});

		it('decodes percent-encoding, since the filesystem wants the real name', () => {
			expect(resolveLinkTarget('my%20note.md')).toEqual({ kind: 'relative', path: 'my note.md' });
		});

	});

	describe('same-document anchors', () => {
		it.each(['#heading', '#^block-id'])('classifies %s for internal navigation', (fragment) => {
			expect(resolveLinkTarget(fragment)).toEqual({ kind: 'anchor', fragment });
		});

		it('decodes heading text and rejects malformed encoding', () => {
			expect(resolveLinkTarget('#Install%20Guide')).toEqual({ kind: 'anchor', fragment: '#Install Guide' });
			expect(resolveLinkTarget('#bad%ZZ')).toEqual({ kind: 'blocked', value: '#bad%ZZ' });
		});
	});

	describe('links with nothing to open', () => {
		it.each(['', '   '])('ignores the empty href %o', (href) => {
			expect(resolveLinkTarget(href)).toEqual({ kind: 'ignore' });
		});
	});
});
