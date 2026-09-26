import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const profileRoot = await mkdtemp(join(tmpdir(), 'mdlp-vault-history-'));
const userDataDir = join(profileRoot, 'user');
const extensionsDir = join(profileRoot, 'extensions');
const settingsDir = join(userDataDir, 'User');

try {
	await Promise.all([mkdir(settingsDir, { recursive: true }), mkdir(extensionsDir, { recursive: true })]);
	await writeFile(join(settingsDir, 'settings.json'), JSON.stringify({
		'files.autoSave': 'off',
		'mdLivePreview.defaultEditor': 'textEditor',
		'workbench.startupEditor': 'none',
		'window.dialogStyle': 'custom',
		'update.mode': 'none',
	}, null, 2));
	const executable = await downloadAndUnzipVSCode('stable');
	const runner = resolve(root, 'node_modules/@vscode/test-cli/out/runner.cjs');
	const options = JSON.stringify({
		mochaOpts: {
			ui: 'tdd', timeout: 60_000,
			...(process.env.MDLP_HISTORY_TEST_GREP ? { grep: process.env.MDLP_HISTORY_TEST_GREP } : {}),
		},
		colorDefault: Boolean(process.stdout.isTTY), preload: [],
		files: [resolve(root, 'out-test/integration/vaultMoveHistory.test.js')],
	});
	await new Promise((resolveRun, rejectRun) => {
		const child = spawn(executable, [
			resolve(root, 'test/fixtures'), '--no-sandbox', '--disable-gpu-sandbox',
			'--disable-updates', '--disable-telemetry', '--disable-workspace-trust',
			'--skip-welcome', '--skip-release-notes', '--no-cached-data',
			`--user-data-dir=${userDataDir}`, `--extensions-dir=${extensionsDir}`,
			`--extensionTestsPath=${runner}`, `--extensionDevelopmentPath=${root}`,
		], {
			cwd: root, stdio: 'inherit',
			env: { ...process.env, VSCODE_TEST_OPTIONS: options, MDLP_VAULT_MOVE_HISTORY_TEST: '1', ELECTRON_RUN_AS_NODE: undefined },
		});
		child.once('error', rejectRun);
		child.once('exit', (code, signal) => {
			if (code === 0) resolveRun();
			else rejectRun(new Error(`Vault move history host exited with ${code ?? signal ?? 'an unknown status'}.`));
		});
	});
} finally {
	await rm(profileRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
