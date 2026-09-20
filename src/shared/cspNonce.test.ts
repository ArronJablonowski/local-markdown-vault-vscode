import { describe, expect, it } from 'vitest';
import { createCspNonce } from './cspNonce';

describe('createCspNonce', () => {
	it('creates a fresh 192-bit base64url nonce for each webview document', () => {
		const nonces = new Set(Array.from({ length: 128 }, () => createCspNonce()));
		expect(nonces.size).toBe(128);
		for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9_-]{32}$/);
	});
});
