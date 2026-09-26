// Run real keyboard/mouse search journeys in an isolated vault and VS Code
// profile. The fixture vault never contains a user's notes or preferences.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'mdlp-search-'));
const workspace = join(temporary, 'Vault');
const profile = join(temporary, 'u');
const extensions = join(temporary, 'e');
const artifacts = resolve(root, '.vscode-test/vault-search-native');
const port = await reservePort();

try {
	await Promise.all([mkdir(workspace), mkdir(join(profile, 'User'), { recursive: true }), mkdir(extensions), mkdir(artifacts, { recursive: true })]);
	await writeFile(join(profile, 'User/settings.json'), JSON.stringify({
		// Keep edits dirty so search must read open buffers without saving them.
		'files.autoSave': 'off', 'files.hotExit': 'off',
		'mdLivePreview.autoSave': false,
		'mdLivePreview.defaultEditor': 'textEditor',
		'mdLivePreview.vault.openDefaultOnStartup': false,
		'workbench.startupEditor': 'none',
		'window.menuStyle': 'custom', 'window.dialogStyle': 'custom',
		'update.mode': 'none', 'telemetry.telemetryLevel': 'off',
		'git.openRepositoryInParentFolders': 'never',
	}, null, 2));
	const executable = await downloadAndUnzipVSCode('stable');
	const options = JSON.stringify({
		mochaOpts: { ui: 'tdd', timeout: 60_000, ...(process.env.MDLP_SEARCH_TEST_GREP ? { grep: process.env.MDLP_SEARCH_TEST_GREP } : {}) },
		colorDefault: Boolean(process.stdout.isTTY), preload: [],
		files: [resolve(root, 'out-test/integration/vaultSearch.test.js')],
	});
	await new Promise((resolveRun, rejectRun) => {
		const child = spawn(executable, [
			workspace, '--no-sandbox', '--disable-gpu-sandbox', '--disable-updates', '--disable-telemetry',
			'--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-cached-data',
			`--user-data-dir=${profile}`, `--extensions-dir=${extensions}`, `--remote-debugging-port=${port}`,
			`--extensionTestsPath=${resolve(root, 'node_modules/@vscode/test-cli/out/runner.cjs')}`,
			`--extensionDevelopmentPath=${root}`,
		], {
			cwd: root, stdio: 'inherit', env: {
				...process.env, ELECTRON_RUN_AS_NODE: undefined, VSCODE_TEST_OPTIONS: options,
				MDLP_VAULT_SEARCH_TEST: '1', MDLP_SEARCH_TEST_TEMPORARY: temporary,
				MDLP_SEARCH_TEST_ARTIFACTS: artifacts, MDLP_VSCODE_DEBUG_PORT: String(port),
			},
		});
		child.once('error', rejectRun);
		child.once('exit', (code, signal) => code === 0 ? resolveRun() : rejectRun(new Error(
			`Vault search host exited with ${code ?? signal ?? 'an unknown status'}.`,
		)));
	});
} finally {
	await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}

async function reservePort() {
	const server = createServer();
	await new Promise((resolveListen, rejectListen) => {
		server.once('error', rejectListen);
		server.listen(0, '127.0.0.1', resolveListen);
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Could not reserve a local debugging port.');
	await new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()));
	return address.port;
}
