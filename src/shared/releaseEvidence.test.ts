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

	it('keeps every webview CSP and local resource root at the reviewed minimum', () => {
		const editor = readFileSync(join(ROOT, 'src', 'editor', 'MarkdownLivePreviewProvider.ts'), 'utf8');
		const outline = readFileSync(join(ROOT, 'src', 'sidebar', 'OutlineViewProvider.ts'), 'utf8');
		const manager = readFileSync(join(ROOT, 'src', 'sidebar', 'StyleManagerViewProvider.ts'), 'utf8');
		const preview = readFileSync(join(ROOT, 'src', 'sidebar', 'StylePreviewController.ts'), 'utf8');
		const providers = [editor, outline, manager, preview];

		for (const source of providers) {
			expect(source).toContain("default-src 'none'");
			expect(source).not.toContain("'unsafe-eval'");
			expect(source).not.toMatch(/localResourceRoots[^;]*(?:document|workspace|rootUri)/s);
		}
		expect(providers.filter((source) => source.includes("style-src ${webview.cspSource} 'unsafe-inline'")))
			.toEqual([editor, manager]);
		expect(outline).toContain("style-src ${webview.cspSource}; script-src 'nonce-${nonce}'");
		expect(preview).toContain("style-src ${webview.cspSource} 'nonce-${nonce}'");
		expect(preview.match(/<style nonce="\$\{nonce\}"/g)).toHaveLength(3);
		expect(editor).toContain('Vault files are never resource roots.');
		expect(editor).toContain("connect-src ${webview.cspSource};");
		expect(editor).not.toMatch(/connect-src[^;]*https:/);
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

	it('keeps the focused macOS transaction gate explicit and reproducible', () => {
		const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
			scripts?: Record<string, string>;
		};
		expect(manifest.scripts?.['test:integration:focused:macos'])
			.toContain('node scripts/run-focused-macos-integration.mjs');
		const runner = readFileSync(join(ROOT, 'scripts', 'run-focused-macos-integration.mjs'), 'utf8');
		expect(runner).toContain("process.platform !== 'darwin'");
		expect(runner).toContain("MDLP_FOCUSED_DESKTOP_TEST: '1'");
		expect(runner).toContain('`--remote-debugging-port=${debugPort}`');
		expect(runner).toContain('MDLP_VSCODE_DEBUG_PORT: String(debugPort)');
		const testSource = readFileSync(join(ROOT, 'test', 'integration', 'focusedDesktop.test.ts'), 'utf8');
		expect(testSource).toContain('chromium.connectOverCDP');
		expect(testSource).toContain("frame.locator('.cm-content')");
		expect(testSource).toContain("keyboard.press('Meta+z')");
		expect(testSource).toContain("keyboard.press('Meta+Shift+z')");
		expect(testSource).toContain("keyboard.press('Meta+s')");
		expect(testSource).toContain('Live Preview did not render the external file change');
		expect(testSource).toContain('drives native knowledge pickers and views with keyboard navigation');
		expect(testSource).toContain("executeCommand('mdLivePreview.quickSwitcher')");
		expect(testSource).toContain("executeCommand('mdLivePreview.vaultSearch')");
		expect(testSource).toContain("executeCommand('mdLivePreview.backlinks.focus')");
		expect(testSource).toContain("executeCommand('mdLivePreview.tags.focus')");
		expect(testSource).toContain('Quick Switcher keyboard acceptance did not open the aliased note');
		expect(testSource).toContain('vault-search keyboard acceptance did not open the body-text result');
		expect(testSource).toContain('the native Backlinks view did not distinguish the unlinked mention');
		expect(testSource).toContain('Backlinks source activation did not open the linked note');
		expect(testSource).toContain('keeps relative links, local attachments, split editors, and external edits compatible');
		expect(testSource).toContain('validated local attachment bytes did not reach Live Preview');
		expect(testSource).toContain('relative Markdown link did not open its in-vault target');
		expect(testSource).toContain('external file replacement did not converge in both split Live Preview panes');
		const vaultRegistration = readFileSync(join(ROOT, 'src', 'vault', 'registerVault.ts'), 'utf8');
		expect(vaultRegistration).toContain('alwaysShow: true');
		expect(testSource).toContain("page.on('request', recordRequest)");
		expect(testSource).toContain("'raw Markdown HTML executed in the real webview'");
		expect(testSource).toContain("'hostile Markdown retained an active unsafe URL'");
		expect(testSource).toContain("'opening hostile Markdown disclosed outside-vault file contents'");
		expect(testSource).toContain("'opening hostile Markdown modified an outside-vault canary'");
		expect(testSource).toContain("'opening hostile Markdown created or removed an adjacent outside-vault entry'");
		expect(testSource).toContain("'opening hostile Markdown emitted a remote sentinel request'");
		expect(testSource).toContain("'the checked-in corpus emitted an unsolicited network request'");
		expect(testSource).toContain("'the checked-in corpus modified an outside-vault canary'");
		expect(testSource).toContain("'the corpus command URL closed the VS Code workbench'");
		expect(testSource).toContain('SECURITY_CORPUS.entries()');
		const corpusManifest = JSON.parse(readFileSync(
			join(ROOT, 'test', 'security-corpus', 'manifest.json'),
			'utf8',
		)) as Array<{ file: string }>;
		for (const entry of corpusManifest) expect(testSource).toContain(`file: '${entry.file}'`);
		expect(testSource).toContain("configuration.update('remoteMedia', 'https', vscode.ConfigurationTarget.Workspace)");
		expect(testSource).toContain("'workspace HTTPS opt-in did not emit the expected image request'");
		expect(testSource).toContain("'revoking the workspace opt-in did not restore the blocked-media fallback'");
		expect(testSource).toContain('one undo did not restore the source and link');
		expect(testSource).toContain("executeCommand('mdLivePreview.caseAwareRedo')");
	});

	it('keeps external folder watcher reconciliation in the real extension-host gate', () => {
		const indexSource = readFileSync(join(ROOT, 'src', 'vault', 'VaultIndex.ts'), 'utf8');
		expect(indexSource).toContain("new vscode.RelativePattern(this.vault.rootUri, '**/*')");
		expect(indexSource).toContain('prepareRecordIdentity');
		expect(indexSource).toContain('scheduleMissingRecordPrune');
		expect(indexSource).toContain('pruneMissingRecords');
		const testSource = readFileSync(join(ROOT, 'test', 'integration', 'vault.test.ts'), 'utf8');
		expect(testSource).toContain('converges the tree and index after external Unicode folder create, rename, and delete');
		expect(testSource).toContain('external Unicode folder rename did not converge in the vault index');
		expect(testSource).toContain('external folder deletion did not leave the vault index');
		expect(testSource).toContain('external Unicode folder rename changed note bytes');
	});

	it('tests the packaged VSIX in isolated trusted, untrusted, and disabled profiles', () => {
		const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
			scripts?: Record<string, string>;
		};
		expect(manifest.scripts?.['test:vsix']).toContain('node scripts/run-vsix-smoke.mjs');
		const runner = readFileSync(join(ROOT, 'scripts', 'run-vsix-smoke.mjs'), 'utf8');
		const testSource = readFileSync(join(ROOT, 'test', 'integration', 'vsix-smoke.test.ts'), 'utf8');
		expect(runner).toContain("'--install-extension', vsix");
		expect(runner).toContain("['trusted', 'restricted', 'disabled']");
		expect(runner).toContain("launchArguments.push('--disable-extension', extensionId)");
		expect(runner).toContain('changed .obsidian/app.json');
		expect(runner).toContain('resolveCliPathFromVSCodeExecutablePath(executable)');
		expect(runner).toContain("process.platform === 'win32'");
		expect(runner).toContain('`--extensionDevelopmentPath=${harness}`');
		expect(runner).toContain('`--remote-debugging-port=${debugPort}`');
		expect(runner).toContain('MDLP_VSCODE_DEBUG_PORT: String(debugPort)');
		expect(runner).toContain('changed the linked-note bytes');
		expect(runner).toContain('changed the local-image bytes');
		expect(testSource).toContain('isolated VSIX directory');
		expect(testSource).toContain('vscode.workspace.isTrusted');
		expect(testSource).toContain('walks the packaged trusted vault, editor, media, diagrams, index, and knowledge views');
		expect(testSource).toContain('keeps packaged controls reachable in high contrast at 200 percent zoom');
		expect(testSource).toContain("document.body.classList.contains('vscode-high-contrast')");
		expect(testSource).toContain("executeCommand('workbench.action.zoomIn')");
		expect(testSource).toContain("await editor.press('Escape')");
		expect(testSource).toContain("await editor.press('Tab')");
		expect(testSource).toContain("chromium.connectOverCDP(`http://127.0.0.1:${port}`)");
		expect(testSource).toContain(".mlp-wikilink[data-href=\"wikilink:Packaged%20Target\"]");
		expect(testSource).toContain("executeCommand('mdLivePreview.vault.focus')");
		expect(testSource).toContain("executeCommand('mdLivePreview.quickSwitcher')");
		expect(testSource).toContain("executeCommand('mdLivePreview.backlinks.focus')");
		expect(testSource).toContain("executeCommand('mdLivePreview.tags.focus')");
		expect(testSource).toContain('keeps packaged editing local and disables restricted renderers');
		expect(testSource).toContain('Restricted Mode emitted a remote image request');
		expect(testSource).toContain('Restricted Mode executed a diagram renderer');
		expect(testSource).toContain('leaves an Obsidian vault usable as ordinary files when disabled');
		expect(testSource).toContain("instanceof vscode.TabInputText");
		for (const name of ['ci.yml', 'release-validation.yml']) {
			const source = readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');
			expect(source, `${name} omits the packaged VSIX smoke gate`).toContain('npm run test:vsix');
		}
		const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
		expect(ci).toContain("name: local-markdown-vault-${{ github.sha }}");
		expect(ci).toContain('if-no-files-found: error');
		expect(ci).toContain('retention-days: 14');
		expect(ci.indexOf('npm run test:vsix')).toBeLessThan(ci.indexOf('name: Retain tested preview VSIX'));
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

	it('keeps diagnostics opt-in, local, bounded, and content-redacting', () => {
		const diagnostics = readFileSync(join(ROOT, 'src', 'diagnostics.ts'), 'utf8');
		expect(diagnostics).toContain('const MAX_LOG_ENTRIES = 500');
		expect(diagnostics).toContain('const MAX_LOG_CHARACTERS = 64 * 1024');
		expect(diagnostics).toContain("get<boolean>('enabled', false)");
		expect(diagnostics).toContain("vscode.window.createOutputChannel('Local Markdown Vault')");
		expect(diagnostics).not.toMatch(/\b(?:fetch|https?|writeFile|appendFile|createWriteStream)\b/);
		const sanitizer = readFileSync(join(ROOT, 'src', 'shared', 'diagnosticSanitizer.ts'), 'utf8');
		expect(sanitizer).toContain('value instanceof Error');
		expect(sanitizer).toContain('isSensitiveKey(rawKey)');
		expect(sanitizer).toContain("return '[absolute-path]'");
		expect(sanitizer).toContain("return '[url]'");
	});
});
