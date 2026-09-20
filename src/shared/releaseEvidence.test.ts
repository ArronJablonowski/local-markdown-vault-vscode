import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SBOM = 'local-markdown-vault.cdx.json';

function productionTypeScriptFiles(directory: string): string[] {
	const files: string[] = [];
	for (const name of readdirSync(directory)) {
		const path = join(directory, name);
		if (statSync(path).isDirectory()) files.push(...productionTypeScriptFiles(path));
		else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'testDom.ts') files.push(path);
	}
	return files;
}

describe('release security evidence', () => {
	it('contains no extension-owned telemetry or general-purpose network client', () => {
		const files = productionTypeScriptFiles(join(ROOT, 'src'));
		const forbidden = /\b(?:XMLHttpRequest|WebSocket|EventSource)\b|navigator\.sendBeacon|createTelemetryLogger|from\s+['"]node:(?:http|https|http2|net|tls|dgram)['"]|require\(\s*['"](?:node:)?(?:http|https|http2|net|tls|dgram)['"]\s*\)/;
		for (const file of files) {
			const source = readFileSync(file, 'utf8');
			expect(source, `${file} contains a forbidden networking or telemetry primitive`).not.toMatch(forbidden);
		}

		const fetchSites = files.flatMap((file) => {
			const source = readFileSync(file, 'utf8');
			return [...source.matchAll(/\bfetch\s*\(/g)].map(() => file);
		});
		expect(fetchSites).toEqual([join(ROOT, 'src', 'webview-editor', 'awsShapes.ts')]);

		// The sole fetch is a packaged JSON asset. Its host-minted webview URI is
		// confined by localResourceRoots and connect-src never allows HTTPS.
		const provider = readFileSync(join(ROOT, 'src', 'editor', 'MarkdownLivePreviewProvider.ts'), 'utf8');
		expect(provider).toContain("vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'aws4-shapes.json')");
		expect(provider).toContain("localResourceRoots: localContentRoots");
		expect(provider).toContain("connect-src ${webview.cspSource};");
		expect(provider).not.toMatch(/connect-src[^;]*https:/);
	});

	it('uses one cryptographically secure nonce generator for every scripted webview', () => {
		const providers = [
			join(ROOT, 'src', 'editor', 'MarkdownLivePreviewProvider.ts'),
			join(ROOT, 'src', 'sidebar', 'OutlineViewProvider.ts'),
			join(ROOT, 'src', 'sidebar', 'StyleManagerViewProvider.ts'),
			join(ROOT, 'src', 'sidebar', 'StylePreviewController.ts'),
		];
		for (const provider of providers) {
			const source = readFileSync(provider, 'utf8');
			expect(source).toContain('createCspNonce()');
			expect(source).not.toContain('Math.random()');
		}
		const nonceSource = readFileSync(join(ROOT, 'src', 'shared', 'cspNonce.ts'), 'utf8');
		expect(nonceSource).toContain("randomBytes(CSP_NONCE_BYTES).toString('base64url')");
	});

	it('writes a validated SBOM to a deterministic standalone artifact', () => {
		const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
			scripts?: Record<string, string>;
		};
		const command = manifest.scripts?.['security:sbom'] ?? '';
		expect(command).toContain('--output-reproducible');
		expect(command).toContain('--validate');
		expect(command).toContain(`--output-file ${SBOM}`);
		expect(command).not.toMatch(/--output-file\s+-\b/);
	});

	it('verifies dependency provenance before script-free installation', () => {
		const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
			scripts?: Record<string, string>;
		};
		expect(manifest.scripts?.['security:dependencies']).toBe('node scripts/verify-dependency-policy.mjs');
		const verifier = readFileSync(join(ROOT, 'scripts', 'verify-dependency-policy.mjs'), 'utf8');
		expect(verifier).toContain("resolved.protocol === 'https:'");
		expect(verifier).toContain("resolved.origin === 'https://registry.npmjs.org'");
		expect(verifier).toContain('/^sha512-');
		expect(verifier).toContain('approvedProductionLicenses');
		expect(verifier).toContain('approvedInstallScriptPackages');
		for (const name of ['ci.yml', 'release-validation.yml']) {
			const workflow = readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');
			expect(workflow).toContain('npm run security:dependencies');
			for (const install of workflow.matchAll(/run:\s*(npm ci[^\r\n]*)/g)) {
				expect(install[1], `${name} permits dependency lifecycle scripts`).toContain('--ignore-scripts');
			}
		}
	});

	it('verifies the contents of every production VSIX after packaging', () => {
		const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
			scripts?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		const packageCommand = manifest.scripts?.package ?? '';
		expect(packageCommand).toContain('vsce package --no-dependencies');
		expect(packageCommand).toContain('node scripts/verify-vsix.mjs');
		expect(manifest.scripts?.['package:verify']).toBe('node scripts/verify-vsix.mjs');
		expect(manifest.devDependencies?.jszip).toBe('3.10.1');

		const verifier = readFileSync(join(ROOT, 'scripts', 'verify-vsix.mjs'), 'utf8');
		for (const required of [
			'extension/SECURITY.md',
			'extension/docs/ACCESSIBILITY.md',
			'extension/docs/MIGRATION.md',
			'extension/docs/OBSIDIAN_COMPATIBILITY.md',
			'extension/THIRD-PARTY-NOTICES.md',
		]) {
			expect(verifier).toContain(required);
		}
		expect(verifier).toContain('checkCRC32: true');
		expect(verifier).toContain('unsafeOriginalName');
		expect(verifier).toContain('symbolic link entry');
	});

	it('packages an explicit Obsidian compatibility and security-differences contract', () => {
		const source = readFileSync(join(ROOT, 'docs', 'OBSIDIAN_COMPATIBILITY.md'), 'utf8');
		for (const required of [
			'## Supported note syntax',
			'## Vault and navigation behavior',
			'## Intentional security differences',
			'## Explicit non-goals',
			'Raw HTML is never executed',
			'`.obsidian/` is left untouched',
			'does not provide Obsidian Sync',
		]) {
			expect(source).toContain(required);
		}
		const vscodeIgnore = readFileSync(join(ROOT, '.vscodeignore'), 'utf8');
		expect(vscodeIgnore.split(/\r?\n/)).toContain('!docs/OBSIDIAN_COMPATIBILITY.md');
	});

	it('ships reproducible contributor setup and security-boundary guidance', () => {
		expect(readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim()).toBe('24');
		const contributing = readFileSync(join(ROOT, 'CONTRIBUTING.md'), 'utf8');
		for (const required of [
			'npm run security:dependencies',
			'npm ci --ignore-scripts',
			'npm run test:integration:restricted',
			'npm run test:vsix',
			'VaultService.ts',
			'runtime validators',
			'Do not add telemetry',
			'reporting process in [SECURITY.md]',
		]) {
			expect(contributing).toContain(required);
		}
		const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
		expect(readme).toContain('[Contributing and development workflow](CONTRIBUTING.md)');
	});

	it('retains the SBOM in CI but excludes it from source control and the VSIX', () => {
		const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
		const release = readFileSync(join(ROOT, '.github', 'workflows', 'release-validation.yml'), 'utf8');
		const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
		const vscodeignore = readFileSync(join(ROOT, '.vscodeignore'), 'utf8');
		expect(ci).toContain('npm run security:sbom');
		expect(ci).toContain(`path: ${SBOM}`);
		expect(ci).not.toContain(`security:sbom > ${SBOM}`);
		expect(release).toContain('name: release-sbom');
		expect(release).toContain(`path: ${SBOM}`);
		expect(gitignore.split(/\r?\n/)).toContain(SBOM);
		expect(vscodeignore.split(/\r?\n/)).toContain(SBOM);
	});

	it('pins every GitHub Actions dependency to an immutable commit', () => {
		const workflowDirectory = join(ROOT, '.github', 'workflows');
		const workflows = readdirSync(workflowDirectory).filter((name) => /\.ya?ml$/i.test(name));
		expect(workflows.length).toBeGreaterThan(0);
		for (const name of workflows) {
			const source = readFileSync(join(workflowDirectory, name), 'utf8');
			const references = [...source.matchAll(/uses:\s*[^@\s]+@([^\s#]+)/g)].map((match) => match[1]);
			expect(references.length, `${name} contains no action references`).toBeGreaterThan(0);
			for (const reference of references) expect(reference, `${name} has a mutable action reference`).toMatch(/^[a-f0-9]{40}$/);
		}
	});

	it('runs push-time security and test gates on both supported default-branch names', () => {
		for (const name of ['ci.yml', 'codeql.yml', 'secret-scan.yml']) {
			const source = readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');
			expect(source, `${name} must cover the checked-out master branch`).toContain('branches: [main, master]');
		}
	});

	it('runs hosted build and release gates on the supported Node LTS', () => {
		for (const name of ['ci.yml', 'release-validation.yml']) {
			const source = readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');
			const versions = [...source.matchAll(/node-version:\s*(\d+)/g)].map((match) => Number(match[1]));
			expect(versions.length, `${name} does not select a Node.js runtime`).toBeGreaterThan(0);
			expect(versions, `${name} uses an unsupported Node.js runtime`).toEqual(
				Array.from({ length: versions.length }, () => 24),
			);
		}
	});

	it('pins Linux workflow jobs to the validated Ubuntu release image', () => {
		const workflowDirectory = join(ROOT, '.github', 'workflows');
		for (const name of readdirSync(workflowDirectory).filter((candidate) => /\.ya?ml$/i.test(candidate))) {
			const source = readFileSync(join(workflowDirectory, name), 'utf8');
			expect(source, `${name} can silently migrate to a new Ubuntu image`).not.toContain('ubuntu-latest');
			if (source.includes('ubuntu-')) expect(source).toContain('ubuntu-24.04');
		}
	});

	it('bounds every hosted workflow job with an explicit timeout', () => {
		const workflowDirectory = join(ROOT, '.github', 'workflows');
		for (const name of readdirSync(workflowDirectory).filter((candidate) => /\.ya?ml$/i.test(candidate))) {
			const source = readFileSync(join(workflowDirectory, name), 'utf8');
			const jobs = [...source.matchAll(/^\s+runs-on:\s*.+$/gm)];
			const timeouts = [...source.matchAll(/^\s+timeout-minutes:\s*(\d+)\s*$/gm)].map((match) => Number(match[1]));
			expect(timeouts.length, `${name} has a job without an explicit timeout`).toBe(jobs.length);
			for (const timeout of timeouts) {
				expect(timeout, `${name} has an invalid or excessive job timeout`).toBeGreaterThan(0);
				expect(timeout, `${name} has an invalid or excessive job timeout`).toBeLessThanOrEqual(30);
			}
		}
	});

	it('keeps reference-machine performance budgets out of variable hosted runners', () => {
		const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
			scripts?: Record<string, string>;
		};
		expect(manifest.scripts?.['test:deterministic'])
			.toBe('vitest run --exclude src/vault/vaultPerformance.test.ts');
		for (const name of ['ci.yml', 'release-validation.yml']) {
			const source = readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');
			expect(source).toContain('npm run test:deterministic');
			expect(source).not.toMatch(/run:\s*npm test\s*(?:\r?\n|$)/);
		}
		const performance = readFileSync(join(ROOT, 'src', 'vault', 'vaultPerformance.test.ts'), 'utf8');
		expect(performance).toContain('expect(elapsed).toBeLessThan(3_000)');
		expect(performance).toContain('expect(elapsed).toBeLessThan(500)');
		expect(performance).toContain('expect(p95).toBeLessThan(200)');
	});

	it('runs a real untrusted-workspace extension-host gate in CI and release validation', () => {
		const runner = readFileSync(join(ROOT, 'scripts', 'run-restricted-integration.mjs'), 'utf8');
		const testSource = readFileSync(join(ROOT, 'test', 'integration', 'restricted.test.ts'), 'utf8');
		expect(runner).not.toContain("'--disable-workspace-trust'");
		expect(runner).toContain("'security.workspace.trust.enabled': true");
		expect(testSource).toContain('vscode.workspace.isTrusted, false');
		for (const name of ['ci.yml', 'release-validation.yml']) {
			const source = readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');
			expect(source, `${name} omits the Restricted Mode host gate`).toContain('npm run test:integration:restricted');
		}
	});

	it('rebuilds a deleted vault cache across two real VS Code launches on every release platform', () => {
		const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
			scripts?: Record<string, string>;
		};
		expect(manifest.scripts?.['test:integration:cache-restart'])
			.toContain('node scripts/run-cache-restart-integration.mjs');
		const runner = readFileSync(join(ROOT, 'scripts', 'run-cache-restart-integration.mjs'), 'utf8');
		expect(runner).toContain("for (const phase of ['seed', 'recover'])");
		expect(runner).toContain('MDLP_CACHE_RESTART_PHASE: phase');
		const testSource = readFileSync(join(ROOT, 'test', 'integration', 'cacheRestart.test.ts'), 'utf8');
		expect(testSource).toContain("await vscode.workspace.fs.delete(cacheUri, { useTrash: false })");
		expect(testSource).toContain('startup did not restore body search');
		expect(testSource).toContain('cache-free startup did not restore navigation');
		for (const name of ['ci.yml', 'release-validation.yml']) {
			const source = readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');
			expect(source, `${name} omits the cache-free startup gate`)
				.toContain('npm run test:integration:cache-restart');
		}
	});

	it('installs and tests the packaged VSIX in isolated trusted and untrusted profiles', () => {
		const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
			scripts?: Record<string, string>;
		};
		expect(manifest.scripts?.['test:vsix']).toContain('node scripts/run-vsix-smoke.mjs');
		const runner = readFileSync(join(ROOT, 'scripts', 'run-vsix-smoke.mjs'), 'utf8');
		const testSource = readFileSync(join(ROOT, 'test', 'integration', 'vsix-smoke.test.ts'), 'utf8');
		expect(runner).toContain("'--install-extension', vsix");
		expect(runner).toContain("['trusted', 'restricted']");
		expect(runner).toContain('resolveCliPathFromVSCodeExecutablePath(executable)');
		expect(runner).toContain("process.platform === 'win32'");
		expect(runner).toContain('`--extensionDevelopmentPath=${harness}`');
		expect(testSource).toContain('isolated VSIX directory');
		expect(testSource).toContain('vscode.workspace.isTrusted');
		for (const name of ['ci.yml', 'release-validation.yml']) {
			const source = readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');
			expect(source, `${name} omits the packaged VSIX smoke gate`).toContain('npm run test:vsix');
		}
	});

	it('measures large-note viewport trials independently and keeps the reference budget out of hosted CI', () => {
		const source = readFileSync(join(ROOT, 'test', 'e2e', 'performance.spec.ts'), 'utf8');
		expect(source).toContain("test.describe.configure({ mode: 'serial' })");
		expect(source).toContain("process.env.LMV_PERFORMANCE_GATES !== 'off'");
		expect(source).toContain('expect(elapsedMs).toBeLessThan(1_000)');
		const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
		expect(ci).toContain('LMV_PERFORMANCE_GATES: "off"');
	});

	it('announces completed vault operations through the accessible notification surface', () => {
		const source = readFileSync(join(ROOT, 'src', 'vault', 'registerVault.ts'), 'utf8');
		expect(source).toContain('function announceVaultCompletion(message: string)');
		expect(source).toContain('vscode.window.showInformationMessage(message)');
		for (const message of [
			'Document Vault index rebuilt.',
			'Note "{0}" created.',
			'Folder "{0}" created.',
			'Renamed to "{0}".',
			'{0} vault item(s) moved.',
			'Moved "{0}" to Trash.',
		]) {
			const translationCall = ['vscode.l10n', `.t('${message}'`].join('');
			expect(source, `completion is not announced: ${message}`).toContain(`announceVaultCompletion(${translationCall}`);
		}
	});
});
