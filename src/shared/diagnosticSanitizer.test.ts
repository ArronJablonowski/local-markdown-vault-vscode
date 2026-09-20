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
			posix: 'path:/Users/alice/My Notes/private.md', windows: 'at "C:\\Users\\alice\\My Notes\\private.md"',
			unc: 'copy(\\\\server\\private share\\note.md)', encoded: 'source=%2FUsers%2Falice%2Fprivate.md', error,
		});
		expect(result.relativeItem).toBe('Notes/Plan.md');
		expect(result.destination).toBe('[url]');
		expect(result.posix).toBe('[absolute-path]');
		expect(result.windows).toBe('[absolute-path]');
		expect(result.unc).toBe('[absolute-path]');
		expect(result.encoded).toBe('[absolute-path]');
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
		expect(sanitizeDiagnosticEventName('message rejected\n/private')).toBe('diagnostic.event');
		expect(sanitizeDiagnosticEventName('protocol.messageRejected')).toBe('protocol.messageRejected');
	});

	it('does not retain sensitive fragments in malformed keys, event names, or apparently safe fields', () => {
		const fields = Object.create(null) as Record<string, unknown>;
		fields['/Users/alice/private.md'] = 'visible value';
		fields['secret value'] = 'not inspected';
		fields.reason = 'authorization=Bearer private-value';
		fields.__proto__ = 'prototype text';
		const result = sanitizeDiagnosticFields(fields);
		expect(result).toEqual({
			field_0: 'visible value',
			field_1: '[redacted]',
			reason: '[redacted]',
			field_3: 'prototype text',
		});
		expect(JSON.stringify(result)).not.toContain('alice');
		expect(sanitizeDiagnosticEventName('/Users/alice/private.md')).toBe('diagnostic.event');
	});

	it('keeps normalized diagnostic keys unique at the maximum key length', () => {
		const key = `k${'x'.repeat(39)}`;
		const result = sanitizeDiagnosticFields({
			[key]: true,
			[`${key}!`]: false,
			field_1: 1,
		});
		expect(Object.keys(result)).toHaveLength(3);
		expect(result[key]).toBe(true);
		expect(result.field_1).toBe(false);
		expect(result.field_1_1).toBe(1);
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
