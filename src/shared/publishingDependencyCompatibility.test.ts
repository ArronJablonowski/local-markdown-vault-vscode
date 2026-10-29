import { describe, expect, it } from 'vitest';
import { ClientSecretCredential } from '@azure/identity';
import { createHttpHeaders, type HttpClient } from '@azure/core-rest-pipeline';
import { createRequire } from 'node:module';
import { ConfidentialClientApplication } from '@azure/msal-node';

const require = createRequire(import.meta.url);

describe('patched publishing authentication dependencies', () => {
	for (const [mode, Credential] of [['ESM', ClientSecretCredential], ['CommonJS', require('@azure/identity').ClientSecretCredential]] as const) it(`${mode}: Azure Identity completes its client-secret flow with patched MSAL without external requests`, async () => {
		const tenant = '11111111-1111-4111-8111-111111111111';
		const authority = `https://login.microsoftonline.com/${tenant}`;
		const requests: string[] = [];
		const httpClient: HttpClient = {
			async sendRequest(request) {
				requests.push(request.url);
				let body: unknown;
				if (request.url.includes('/.well-known/openid-configuration')) {
					body = { authorization_endpoint: `${authority}/oauth2/v2.0/authorize`, token_endpoint: `${authority}/oauth2/v2.0/token`,
						issuer: `${authority}/v2.0`, jwks_uri: `${authority}/discovery/v2.0/keys`, end_session_endpoint: `${authority}/oauth2/v2.0/logout` };
				} else if (request.url.split('?')[0] === `${authority}/oauth2/v2.0/token`) {
					expect(String(request.body)).toContain('grant_type=client_credentials');
					body = { token_type: 'Bearer', access_token: 'offline-test-token', expires_in: 3600, ext_expires_in: 3600 };
				} else throw new Error(`Unexpected authentication endpoint: ${request.url}`);
				return { request, status: 200, headers: createHttpHeaders({ 'content-type': 'application/json' }), bodyAsText: JSON.stringify(body) };
			},
		};
		const credential = new Credential(tenant, '22222222-2222-4222-8222-222222222222', 'offline-test-secret', {
			disableInstanceDiscovery: true, httpClient,
		});
		const token = await credential.getToken('499b84ac-1321-427f-aa17-267ca6975798/.default');
		expect(token.token).toBe('offline-test-token');
		expect(requests.some(url => new URL(url).pathname.endsWith('/token'))).toBe(true);
		// The second request uses the integrated MSAL cache, not another HTTP call.
		const count = requests.length;
		expect((await credential.getToken('499b84ac-1321-427f-aa17-267ca6975798/.default')).token).toBe(token.token);
		expect(requests).toHaveLength(count);
	});
	it('patched confidential clients reject unsupported instance-aware authentication before contacting an endpoint', async () => {
		const app = new ConfidentialClientApplication({ auth: { clientId: 'offline-test-client', clientSecret: 'offline-test-secret' } });
		await expect(app.getAuthCodeUrl({ scopes: ['offline/.default'], redirectUri: 'http://localhost',
			extraQueryParameters: { instance_aware: 'true' } })).rejects.toMatchObject({ errorCode: 'unsupported_cca_instance_aware' });
	});
});
