import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

if (process.platform !== 'darwin') throw new Error('The focused desktop gate currently supports macOS only.');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const profileRoot = await mkdtemp(join(tmpdir(), 'mdlp-focus-'));
const userDataDir = join(profileRoot, 'u');
const extensionsDir = join(profileRoot, 'e');
const settingsDir = join(userDataDir, 'User');

try {
	await Promise.all([mkdir(settingsDir, { recursive: true }), mkdir(extensionsDir, { recursive: true })]);
	await writeFile(join(settingsDir, 'settings.json'), JSON.stringify({
		'workbench.startupEditor': 'none',
		'update.mode': 'none',
	}, null, 2));
	const executable = await downloadAndUnzipVSCode('stable');
	const runner = resolve(root, 'node_modules/@vscode/test-cli/out/runner.cjs');
	const testFile = resolve(root, 'out-test/integration/focusedDesktop.test.js');
	const testOptions = JSON.stringify({
		mochaOpts: { ui: 'tdd', timeout: 60_000 },
		colorDefault: Boolean(process.stdout.isTTY),
		preload: [],
		files: [testFile],
	});
	const args = [
		resolve(root, 'test/fixtures'),
		'--no-sandbox',
		'--disable-gpu-sandbox',
		'--disable-updates',
		'--disable-telemetry',
		'--disable-workspace-trust',
		'--skip-welcome',
		'--skip-release-notes',
		'--no-cached-data',
		`--user-data-dir=${userDataDir}`,
		`--extensions-dir=${extensionsDir}`,
		`--extensionTestsPath=${runner}`,
		`--extensionDevelopmentPath=${root}`,
	];

	await new Promise((resolveRun, rejectRun) => {
		const child = spawn(executable, args, {
			cwd: root,
			stdio: 'inherit',
			env: {
				...process.env,
				VSCODE_TEST_OPTIONS: testOptions,
				MDLP_FOCUSED_DESKTOP_TEST: '1',
				ELECTRON_RUN_AS_NODE: undefined,
			},
		});
		const focus = setInterval(() => {
			const exactProcess = child.pid === undefined ? undefined : spawnSync('osascript', [
				'-e',
				`tell application "System Events" to set frontmost of first application process whose unix id is ${child.pid} to true`,
			], { stdio: 'ignore' });
			if (exactProcess?.status !== 0) {
				spawnSync('osascript', ['-e', 'tell application "Visual Studio Code" to activate'], { stdio: 'ignore' });
			}
		}, 500);
		child.once('error', (error) => {
			clearInterval(focus);
			rejectRun(error);
		});
		child.once('exit', (code, signal) => {
			clearInterval(focus);
			if (code === 0) resolveRun();
			else rejectRun(new Error(`Focused macOS host exited with ${code ?? signal ?? 'an unknown status'}.`));
		});
	});
} finally {
	await rm(profileRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
