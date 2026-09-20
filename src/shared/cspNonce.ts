import { randomBytes } from 'node:crypto';

const CSP_NONCE_BYTES = 24;

/**
 * Returns a fresh 192-bit CSP nonce using the host's cryptographic RNG.
 *
 * Base64url keeps the value safe in both the CSP source expression and the
 * escaped HTML attribute without reducing the entropy of the random bytes.
 */
export function createCspNonce(): string {
	return randomBytes(CSP_NONCE_BYTES).toString('base64url');
}
