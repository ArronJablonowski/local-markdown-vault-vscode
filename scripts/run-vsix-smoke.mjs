import { spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } from '@vscode/test-electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
	throw new Error('package.json does not contain a package name and version.');
}
const vsix = resolve(root, `${manifest.name}-${manifest.version}.vsix`);
const runner = resolve(root, 'node_modules/@vscode/test-cli/out/runner.cjs');
const harness = resolve(root, 'test/vsix-harness');
const testFile = resolve(root, 'out-test/integration/vsix-smoke.test.js');
await Promise.all([access(vsix), access(runner), access(harness), access(testFile)]);
const executable = await downloadAndUnzipVSCode('stable');
const cli = resolveCliPathFromVSCodeExecutablePath(executable);
await access(cli);

for (const mode of ['trusted', 'restricted']) {
	await runMode(mode);
}

async function runMode(mode) {
	const profileRoot = await mkdtemp(join(tmpdir(), `mdlp-vsix-${mode}-`));
	const userDataDir = join(profileRoot, 'user-data');
	const extensionsDir = join(profileRoot, 'extensions');
	const workspaceDir = join(profileRoot, 'workspace');
	const settingsDir = join(userDataDir, 'User');
	try {
		await Promise.all([
			mkdir(settingsDir, { recursive: true }),
			mkdir(extensionsDir, { recursive: true }),
			mkdir(workspaceDir, { recursive: true }),
		]);
		await Promise.all([
			writeFile(join(workspaceDir, 'README.md'), '# Packaged smoke\n\n```mermaid\ngraph TD\n  A --> B\n```\n'),
			writeFile(join(settingsDir, 'settings.json'), JSON.stringify({
				'security.workspace.trust.enabled': mode === 'restricted',
				'security.workspace.trust.startupPrompt': 'never',
				'workbench.startupEditor': 'none',
				'update.mode': 'none',
			}, null, 2)),
		]);

		await run(cli, [
			'--install-extension', vsix,
			'--force',
			`--user-data-dir=${userDataDir}`,
			`--extensions-dir=${extensionsDir}`,
			'--disable-telemetry',
		], {}, process.platform === 'win32');

		const testOptions = JSON.stringify({
			mochaOpts: { ui: 'tdd', timeout: 60_000 },
			colorDefault: Boolean(process.stdout.isTTY),
			preload: [],
			files: [testFile],
		});
		await run(executable, [
			workspaceDir,
			'--no-sandbox',
			'--disable-gpu-sandbox',
			'--disable-updates',
			'--disable-telemetry',
			'--skip-welcome',
			'--skip-release-notes',
			'--no-cached-data',
			`--user-data-dir=${userDataDir}`,
			`--extensions-dir=${extensionsDir}`,
			`--extensionTestsPath=${runner}`,
			`--extensionDevelopmentPath=${harness}`,
		], {
			VSCODE_TEST_OPTIONS: testOptions,
			MDLP_VSIX_SMOKE_MODE: mode,
			MDLP_VSIX_EXTENSIONS_DIR: extensionsDir,
			MDLP_VSIX_VERSION: manifest.version,
		});
	} finally {
		// Electron helper processes can finish a fraction after the main process
		// exits and recreate an otherwise empty user-data directory. Repeat the
		// bounded cleanup so CI and developer machines do not accumulate profiles.
		for (let attempt = 0; attempt < 4; attempt++) {
			await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
			await rm(profileRoot, { recursive: true, force: true });
		}
	}
}

async function run(command, args, extraEnv = {}, shell = false) {
	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;
	Object.assign(env, extraEnv);
	await new Promise((resolveRun, rejectRun) => {
		const child = spawn(command, args, { cwd: root, stdio: 'inherit', env, shell });
		child.once('error', rejectRun);
		child.once('exit', (code, signal) => {
			if (code === 0) resolveRun();
			else rejectRun(new Error(`VSIX smoke process exited with ${code ?? signal ?? 'an unknown status'}.`));
		});
	});
}
