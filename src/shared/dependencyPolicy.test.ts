import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
const VERIFIER = join(ROOT, 'scripts', 'verify-dependency-policy.mjs');
let fixtureDirectory: string;
let manifest: Record<string, unknown>;
let lock: { packages: Record<string, Record<string, unknown>> };

beforeAll(() => {
	fixtureDirectory = mkdtempSync(join(tmpdir(), 'lmv-dependency-policy-'));
	manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
	lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
	writeFileSync(join(fixtureDirectory, 'THIRD-PARTY-NOTICES.md'), readFileSync(join(ROOT, 'THIRD-PARTY-NOTICES.md')));
});

afterAll(() => rmSync(fixtureDirectory, { recursive: true, force: true }));

describe('dependency policy command', () => {
	it('accepts the reviewed manifest, lockfile, licenses, and install-script set', () => {
		const result = runPolicy(manifest, lock);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('Dependency policy verified');
	});

	it('rejects manifest and lockfile drift', () => {
		const changed = structuredClone(lock);
		changed.packages[''].dependencies = {};
		expect(runPolicy(manifest, changed).stderr).toContain('package.json dependencies does not match');
	});

	it('rejects unreviewed install scripts and package sources', () => {
		const scripted = structuredClone(lock);
		scripted.packages['node_modules/khroma'].hasInstallScript = true;
		expect(runPolicy(manifest, scripted).stderr).toContain('Unreviewed install script package');

		const insecure = structuredClone(lock);
		insecure.packages['node_modules/khroma'].resolved = 'http://registry.npmjs.org/khroma/-/khroma-2.1.0.tgz';
		expect(runPolicy(manifest, insecure).stderr).toContain('Unapproved package source');
	});

	it('rejects missing production license review and weak integrity', () => {
		const license = structuredClone(lock);
		license.packages['node_modules/mermaid'].license = 'GPL-3.0-only';
		expect(runPolicy(manifest, license).stderr).toContain('Missing or unapproved production license');

		const integrity = structuredClone(lock);
		integrity.packages['node_modules/mermaid'].integrity = 'sha1-unsafe';
		expect(runPolicy(manifest, integrity).stderr).toContain('Missing SHA-512 integrity');
	});
});

function runPolicy(manifestValue: unknown, lockValue: unknown) {
	const manifestPath = join(fixtureDirectory, 'package.json');
	const lockPath = join(fixtureDirectory, 'package-lock.json');
	writeFileSync(manifestPath, JSON.stringify(manifestValue));
	writeFileSync(lockPath, JSON.stringify(lockValue));
	return spawnSync(process.execPath, [
		VERIFIER,
		'--manifest', manifestPath,
		'--lock', lockPath,
		'--notices', join(fixtureDirectory, 'THIRD-PARTY-NOTICES.md'),
	], { encoding: 'utf8' });
}
