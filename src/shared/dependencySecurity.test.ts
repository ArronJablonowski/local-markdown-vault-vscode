import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import katex from 'katex';

const lock = JSON.parse(readFileSync(resolve(__dirname, '../../package-lock.json'), 'utf8'));
const packages = Object.entries(lock.packages) as Array<[string, { version: string }]>;

describe('reviewed security dependency graph', () => {
	it('keeps all copies of patched tools and math libraries above reviewed floors', () => {
		for (const [name, floor] of Object.entries({
			'@vscode/vsce': '4.0.0', vitest: '4.1.12', '@vitest/mocker': '4.1.12',
			'@vitest/coverage-v8': '4.1.12', vite: '8.3.5', 'source-map-js': '1.2.2', katex: '0.18.7', dompurify: '3.4.17',
		})) {
			const copies = packages.filter(([path]) => path.endsWith(`node_modules/${name}`));
			expect(copies.length, name).toBeGreaterThan(0);
			for (const [path, record] of copies) {
				// Lockfile versions are exact stable releases, not semver ranges.
				expect(record.version, path).toMatch(/^\d+\.\d+\.\d+$/);
				const actual = record.version.split('.').map(Number), minimum = floor.split('.').map(Number);
				const firstDifference = actual.findIndex((part, index) => part !== minimum[index]);
				expect(firstDifference === -1 || actual[firstDifference] > minimum[firstDifference], path).toBe(true);
			}
		}
	});
	it('removes vulnerable legacy packaging and shared-cache dependency paths', () => {
		for (const name of ['markdown-it', 'braces', 'http-cache-semantics', 'make-fetch-happen', 'keytar']) {
			expect(packages.filter(([path]) => path.endsWith(`node_modules/${name}`)), name).toEqual([]);
		}
	});
	for (const expression of [String.raw`\href{javascript:alert(1)}{Link}`, String.raw`\includegraphics{https://example.invalid/tracker.png}`]) {
		it(`does not inherit trusted rendering for ${expression}`, () => {
			// Model the advisory without modifying global prototypes or other tests.
			const html = katex.renderToString(expression, Object.create({ trust: true }));
			expect(html).not.toMatch(/<(?:a|img)\b/i);
		});
	}
});
