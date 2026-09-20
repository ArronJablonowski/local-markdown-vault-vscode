import { spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } from '@vscode/test-electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string' || typeof manifest.publisher !== 'string') {
	throw new Error('package.json does not contain a publisher, name, and version.');
}
const extensionId = `${manifest.publisher}.${manifest.name}`;
const vsix = resolve(root, `${manifest.name}-${manifest.version}.vsix`);
const runner = resolve(root, 'node_modules/@vscode/test-cli/out/runner.cjs');
const harness = resolve(root, 'test/vsix-harness');
const testFile = resolve(root, 'out-test/integration/vsix-smoke.test.js');
await Promise.all([access(vsix), access(runner), access(harness), access(testFile)]);
const executable = await downloadAndUnzipVSCode('stable');
const cli = resolveCliPathFromVSCodeExecutablePath(executable);
await access(cli);

for (const mode of ['trusted', 'restricted', 'disabled']) {
	await runMode(mode);
}

async function runMode(mode) {
	const profileRoot = await mkdtemp(join(tmpdir(), `mdlp-vsix-${mode}-`));
	const debugPort = await reservePort();
	const userDataDir = join(profileRoot, 'user-data');
	const extensionsDir = join(profileRoot, 'extensions');
	const workspaceDir = join(profileRoot, 'workspace');
	const settingsDir = join(userDataDir, 'User');
	const noteSource = [
		'# Packaged smoke',
		'',
		'[[Packaged Target]]',
		'',
		'![Packaged local image](pixel.png)',
		'',
		'![Blocked remote image](https://mdlp-vsix.invalid/tracker.png)',
		'',
		'```mermaid',
		'graph TD',
		'  A --> B',
		'```',
		'',
	].join('\n');
	const targetSource = '# Packaged Target\n\n#packaged/preview\n';
	const pixelSource = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
		'base64',
	);
	const obsidianSource = '{"livePreview":true,"legacyEditor":false,"theme":"moonstone"}\n';
	try {
		await Promise.all([
			mkdir(settingsDir, { recursive: true }),
			mkdir(extensionsDir, { recursive: true }),
			mkdir(workspaceDir, { recursive: true }),
			mkdir(join(workspaceDir, '.obsidian'), { recursive: true }),
		]);
		await Promise.all([
			writeFile(join(workspaceDir, 'README.md'), noteSource),
			writeFile(join(workspaceDir, 'Packaged Target.md'), targetSource),
			writeFile(join(workspaceDir, 'pixel.png'), pixelSource),
			writeFile(join(workspaceDir, '.obsidian', 'app.json'), obsidianSource),
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
		const launchArguments = [
			workspaceDir,
			'--no-sandbox',
			'--disable-gpu-sandbox',
			'--disable-updates',
			'--disable-telemetry',
			'--skip-welcome',
			'--skip-release-notes',
			'--no-cached-data',
			`--remote-debugging-port=${debugPort}`,
			`--user-data-dir=${userDataDir}`,
			`--extensions-dir=${extensionsDir}`,
			`--extensionTestsPath=${runner}`,
			`--extensionDevelopmentPath=${harness}`,
		];
		if (mode === 'disabled') launchArguments.push('--disable-extension', extensionId);
		await run(executable, launchArguments, {
			VSCODE_TEST_OPTIONS: testOptions,
			MDLP_VSIX_SMOKE_MODE: mode,
			MDLP_VSIX_EXTENSIONS_DIR: extensionsDir,
			MDLP_VSIX_VERSION: manifest.version,
			MDLP_VSCODE_DEBUG_PORT: String(debugPort),
		});
		if (await readFile(join(workspaceDir, 'README.md'), 'utf8') !== noteSource) {
			throw new Error(`${mode} VSIX smoke changed the Markdown note bytes.`);
		}
		if (await readFile(join(workspaceDir, 'Packaged Target.md'), 'utf8') !== targetSource) {
			throw new Error(`${mode} VSIX smoke changed the linked-note bytes.`);
		}
		if (!pixelSource.equals(await readFile(join(workspaceDir, 'pixel.png')))) {
			throw new Error(`${mode} VSIX smoke changed the local-image bytes.`);
		}
		if (await readFile(join(workspaceDir, '.obsidian', 'app.json'), 'utf8') !== obsidianSource) {
			throw new Error(`${mode} VSIX smoke changed .obsidian/app.json.`);
		}
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

async function reservePort() {
	const server = createServer();
	await new Promise((resolveListen, rejectListen) => {
		server.once('error', rejectListen);
		server.listen(0, '127.0.0.1', resolveListen);
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Could not reserve a local debugging port.');
	await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
	return address.port;
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
