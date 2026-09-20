import { describe, expect, it } from 'vitest';
import { BoundedDiagnosticBuffer, DiagnosticRateLimiter, sanitizeDiagnosticEventName, sanitizeDiagnosticFields } from './diagnosticSanitizer';

describe('diagnostic sanitization', () => {
	it('redacts content-bearing and credential-like fields without inspecting them', () => {
		const result = sanitizeDiagnosticFields({
			markdownBody: '# private note', source: 'plain private body', clipboard: 'copied secret', authorization: 'Bearer abc', token: 'abc',
		});
		expect(result).toEqual({
			markdownBody: '[redacted]', source: '[redacted]', clipboard: '[redacted]', authorization: '[redacted]', token: '[redacted]',
		});
	});

	it('redacts URLs, absolute paths, and Error messages while retaining safe relative items', () => {
		const error = new Error('Failed at /Users/alice/private/note.md: secret contents');
		const result = sanitizeDiagnosticFields({
			relativeItem: 'Notes/Plan.md', destination: 'https://tracker.example/pixel',
			posix: '/Users/alice/private.md', windows: 'C:\\Users\\alice\\private.md', error,
		});
		expect(result.relativeItem).toBe('Notes/Plan.md');
		expect(result.destination).toBe('[url]');
		expect(result.posix).toBe('[absolute-path]');
		expect(result.windows).toBe('[absolute-path]');
		expect(result.error).toBe('[error]');
		expect(JSON.stringify(result)).not.toContain('alice');
		expect(JSON.stringify(result)).not.toContain('secret contents');
	});

	it('bounds keys, values, collections, field count, and event names', () => {
		const result = sanitizeDiagnosticFields(Object.fromEntries(
			Array.from({ length: 30 }, (_, index) => [`field ${index}`, index === 0 ? 'x'.repeat(500) : [1, 2, 3]]),
		));
		expect(Object.keys(result)).toHaveLength(16);
		expect(String(result.field_0).length).toBeLessThanOrEqual(200);
		expect(result.field_1).toBe('[array:3]');
		expect(sanitizeDiagnosticEventName('message rejected\n/private')).toBe('message_rejected__private');
	});

	it('evicts old entries to enforce both count and character bounds', () => {
		const buffer = new BoundedDiagnosticBuffer(3, 20);
		buffer.push('one');
		buffer.push('two');
		buffer.push('three');
		buffer.push('four');
		expect(buffer.snapshot()).toEqual(['two', 'three', 'four']);
		buffer.push('x'.repeat(30));
		expect(buffer.size).toBeLessThanOrEqual(3);
		expect(buffer.characterCount).toBeLessThanOrEqual(20);
		buffer.clear();
		expect(buffer.snapshot()).toEqual([]);
	});

	it('rate-limits repeated categories with bounded key storage', () => {
		const limiter = new DiagnosticRateLimiter(1_000, 2);
		expect(limiter.accept('message', 1_000)).toBe(true);
		expect(limiter.accept('message', 1_999)).toBe(false);
		expect(limiter.accept('message', 2_000)).toBe(true);
		expect(limiter.accept('second', 2_000)).toBe(true);
		expect(limiter.accept('third', 2_000)).toBe(true);
		// The oldest distinct key was evicted when the bounded map filled.
		expect(limiter.accept('message', 2_001)).toBe(true);
		limiter.clear();
		expect(limiter.accept('message', 2_002)).toBe(true);
	});
});
