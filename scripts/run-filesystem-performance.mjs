import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// VS Code's macOS single-instance socket has a 103-byte path ceiling.
const profileRoot = await mkdtemp(join(tmpdir(), 'mdlp-perf-'));
const userDataDir = join(profileRoot, 'u');
const extensionsDir = join(profileRoot, 'e');
const settingsDir = join(userDataDir, 'User');
const vaultRoot = join(profileRoot, 'v');
const runner = resolve(root, 'node_modules/@vscode/test-cli/out/runner.cjs');
const testFile = resolve(root, 'out-test/integration/vaultFilesystemPerformance.test.js');

try {
	await Promise.all([mkdir(settingsDir, { recursive: true }), mkdir(extensionsDir, { recursive: true }), createFixture(vaultRoot)]);
	await writeFile(join(settingsDir, 'settings.json'), JSON.stringify({
		'workbench.startupEditor': 'none',
		'update.mode': 'none',
	}, null, 2));
	const executable = await downloadAndUnzipVSCode('stable');
	const testOptions = JSON.stringify({
		mochaOpts: { ui: 'tdd', timeout: 300_000 },
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
				MDLP_RUN_FILESYSTEM_BENCHMARK: '1',
				MDLP_PERF_VAULT_ROOT: vaultRoot,
				ELECTRON_RUN_AS_NODE: undefined,
			},
		});
		child.once('error', rejectRun);
		child.once('exit', (code, signal) => {
			if (code === 0) resolveRun();
			else rejectRun(new Error(`Filesystem performance host exited with ${code ?? signal ?? 'an unknown status'}.`));
		});
	});
} finally {
	await rm(profileRoot, { recursive: true, force: true });
}

async function createFixture(vaultRoot) {
	const noteCount = 8_000;
	const attachmentCount = 2_000;
	const totalBytes = 1024 ** 3;
	const groupCount = 100;
	const groupsRoot = join(vaultRoot, 'Groups');
	const attachmentsRoot = join(vaultRoot, 'Attachments');
	await Promise.all([
		mkdir(attachmentsRoot, { recursive: true }),
		...Array.from({ length: groupCount }, (_, index) => mkdir(join(groupsRoot, `Group-${String(index).padStart(3, '0')}`), { recursive: true })),
	]);
	const notes = Array.from({ length: noteCount }, (_, index) => {
		const links = Array.from({ length: 13 }, (__, offset) => `[[Note-${(index + offset + 1) % noteCount}]]`).join(' ');
		return `---\ntags: [fixture/group-${index % 20}]\naliases: [Alias ${index}]\n---\n# Note ${index}\n\n${links}\n\nUnicode Ω${index}.\n`;
	});
	let noteBytes = 0;
	await runBounded(notes, 64, async (content, index) => {
		const encoded = Buffer.from(content);
		noteBytes += encoded.byteLength;
		const group = `Group-${String(index % groupCount).padStart(3, '0')}`;
		await writeFile(join(groupsRoot, group, `Note-${String(index).padStart(5, '0')}.md`), encoded);
	});
	const attachmentBytes = totalBytes - noteBytes;
	if (attachmentBytes <= 0) throw new Error('Note fixture exceeded the 1 GiB logical-size budget.');
	const baseSize = Math.floor(attachmentBytes / attachmentCount);
	const remainder = attachmentBytes % attachmentCount;
	// Sparse attachments exercise logical size without writing 1 GiB of payload data.
	await runBounded(Array.from({ length: attachmentCount }, (_, index) => index), 64, async (index) => {
		const handle = await open(join(attachmentsRoot, `Attachment-${String(index).padStart(4, '0')}.bin`), 'w');
		try { await handle.truncate(baseSize + (index < remainder ? 1 : 0)); }
		finally { await handle.close(); }
	});
}

async function runBounded(items, concurrency, work) {
	let cursor = 0;
	await Promise.all(Array.from({ length: concurrency }, async () => {
		while (cursor < items.length) {
			const index = cursor++;
			await work(items[index], index);
		}
	}));
}
