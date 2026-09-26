import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Keep macOS's single-instance socket below its 103-byte path ceiling.
const profileRoot = await mkdtemp(join(tmpdir(), 'mdlp-cache-'));
const userDataDir = join(profileRoot, 'u');
const extensionsDir = join(profileRoot, 'e');
const settingsDir = join(userDataDir, 'User');
const vaultRoot = join(profileRoot, 'v');
const notePath = join(vaultRoot, 'Private Restart Note.md');
const obsidianRoot = join(vaultRoot, '.obsidian');

try {
	await Promise.all([
		mkdir(settingsDir, { recursive: true }),
		mkdir(extensionsDir, { recursive: true }),
		mkdir(obsidianRoot, { recursive: true }),
	]);
	await Promise.all([
		writeFile(join(settingsDir, 'settings.json'), JSON.stringify({
			'workbench.startupEditor': 'none',
			'update.mode': 'none',
		}, null, 2)),
		writeFile(join(obsidianRoot, 'app.json'), '{"livePreview":true,"legacyEditor":false}\n'),
		writeFile(notePath, [
			'---',
			'aliases: [Restart Privacy Alias]',
			'password: restart-property-secret-61ad',
			'---',
			'# Restart privacy heading',
			'',
			'- [ ] restart-task-secret-72be',
			'',
			'This searchable sentence contains restart-body-secret-83cf.',
		].join('\n')),
	]);

	const executable = await downloadAndUnzipVSCode('stable');
	// Reuse disk state across fresh hosts so recovery cannot pass from warm memory.
	for (const phase of ['seed', 'recover']) await runPhase(executable, phase);
} finally {
	await rm(profileRoot, {
		recursive: true,
		force: true,
		maxRetries: 10,
		retryDelay: 250,
	});
}

async function runPhase(executable, phase) {
	const runner = resolve(root, 'node_modules/@vscode/test-cli/out/runner.cjs');
	const testFile = resolve(root, 'out-test/integration/cacheRestart.test.js');
	const testOptions = JSON.stringify({
		mochaOpts: { ui: 'tdd', timeout: 60_000 },
		colorDefault: Boolean(process.stdout.isTTY),
		preload: [],
		files: [testFile],
	});
	const args = [
		vaultRoot,
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
				MDLP_CACHE_RESTART_PHASE: phase,
				ELECTRON_RUN_AS_NODE: undefined,
			},
		});
		child.once('error', rejectRun);
		child.once('exit', (code, signal) => {
			if (code === 0) resolveRun();
			else rejectRun(new Error(`Cache restart ${phase} host exited with ${code ?? signal ?? 'an unknown status'}.`));
		});
	});
}
