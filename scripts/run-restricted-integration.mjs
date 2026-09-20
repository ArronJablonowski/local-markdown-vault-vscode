import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const profileRoot = await mkdtemp(join(tmpdir(), 'mdlp-restricted-test-'));
const userDataDir = join(profileRoot, 'user-data');
const extensionsDir = join(profileRoot, 'extensions');
const settingsDir = join(userDataDir, 'User');

try {
	await Promise.all([mkdir(settingsDir, { recursive: true }), mkdir(extensionsDir, { recursive: true })]);
	await writeFile(join(settingsDir, 'settings.json'), JSON.stringify({
		'security.workspace.trust.enabled': true,
		'security.workspace.trust.startupPrompt': 'never',
		'workbench.startupEditor': 'none',
		'update.mode': 'none',
	}, null, 2));

	const executable = await downloadAndUnzipVSCode('stable');
	const runner = resolve(root, 'node_modules/@vscode/test-cli/out/runner.cjs');
	const testFile = resolve(root, 'out-test/integration/restricted.test.js');
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
				MDLP_RESTRICTED_TEST: '1',
				ELECTRON_RUN_AS_NODE: undefined,
			},
		});
		child.once('error', rejectRun);
		child.once('exit', (code, signal) => {
			if (code === 0) resolveRun();
			else rejectRun(new Error(`Restricted Mode integration host exited with ${code ?? signal ?? 'an unknown status'}.`));
		});
	});
} finally {
	// On Windows, VS Code's agent host can keep its log file open briefly after
	// the main process reports a clean exit. Let Node retry the known transient
	// EBUSY/EPERM/ENOTEMPTY failures instead of turning passing tests into a
	// false-negative release result.
	await rm(profileRoot, {
		recursive: true,
		force: true,
		maxRetries: 10,
		retryDelay: 250,
	});
}
