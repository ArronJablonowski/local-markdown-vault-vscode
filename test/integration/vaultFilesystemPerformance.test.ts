import * as assert from 'assert';
import * as vscode from 'vscode';
import { basename, join } from 'node:path';

const EXTENSION_ID = 'arronjablonowski.local-markdown-vault';
const NOTE_COUNT = 8_000;

interface IndexRecord {
	path: string;
	aliases: string[];
	size: number;
}

interface DevelopmentApi {
	getVaultService(): { rootUri: vscode.Uri } | undefined;
	getVaultIndexRecords(): readonly IndexRecord[];
	getVaultTreeRevision(): number;
	getVaultTreeTitle(): string;
	getVaultTreePaths(parentPath?: string): Promise<readonly string[]>;
}

// This is intentionally opt-in: its isolated runner creates 10,000 real files
// with a 1 GiB logical footprint and measures a release machine, not shared CI.
if (process.env.MDLP_RUN_FILESYSTEM_BENCHMARK === '1') {
	suite('10,000-item filesystem performance gates', () => {
		test('meets cold-index and incremental tree/index budgets across five runs', async function () {
			this.timeout(300_000);
			const fixture = process.env.MDLP_PERF_VAULT_ROOT;
			assert.ok(fixture, 'the benchmark runner did not provide its generated vault');
			assert.strictEqual(vscode.workspace.workspaceFolders?.length, 1, 'the benchmark requires one workspace folder');
			assert.strictEqual(vscode.workspace.workspaceFolders?.[0].uri.fsPath, fixture, 'VS Code did not open the generated vault');
			const extension = vscode.extensions.getExtension<DevelopmentApi>(EXTENSION_ID);
			assert.ok(extension, `extension ${EXTENSION_ID} is not installed`);
			const api = await extension.activate();
			assert.ok(api, 'development performance API is unavailable');
			assert.strictEqual(api.getVaultService()?.rootUri.fsPath, fixture);
			assert.strictEqual(api.getVaultTreeTitle(), basename(fixture), 'tree title must match the Finder folder name');
			assert.strictEqual(api.getVaultIndexRecords().length, NOTE_COUNT, 'initial activation did not index all fixture notes');

			const coldRuns: number[] = [];
			for (let run = 0; run < 5; run++) {
				const rebuildStarted = performance.now();
				await vscode.commands.executeCommand('mdLivePreview.vault.rebuildIndex');
				assert.strictEqual(api.getVaultIndexRecords().length, NOTE_COUNT);
				coldRuns.push(performance.now() - rebuildStarted);
			}

			const interactiveUri = vscode.Uri.file(join(fixture, 'Groups', 'Group-002', 'Note-00002.md'));
			const interactiveDocument = await vscode.workspace.openTextDocument(interactiveUri);
			const interactiveEditor = await vscode.window.showTextDocument(interactiveDocument);
			const rebuildWhileEditing = vscode.commands.executeCommand('mdLivePreview.vault.rebuildIndex');
			await waitFor(() => api.getVaultIndexRecords().length === 0, 1_000);
			const interactionMonitor = startEventLoopDelayMonitor();
			const interactionStarted = performance.now();
			const marker = '\nPERF-005 interactive save marker.\n';
			let edited = false;
			let saved = false;
			let interactionMaxDelay = 0;
			try {
				edited = await interactiveEditor.edit((builder) => builder.insert(interactiveDocument.positionAt(interactiveDocument.getText().length), marker));
				saved = await interactiveDocument.save();
			} finally {
				interactionMaxDelay = interactionMonitor.stop();
			}
			assert.ok(edited, 'typing was rejected while the index rebuilt');
			assert.ok(saved, 'saving was rejected while the index rebuilt');
			const interactionElapsed = performance.now() - interactionStarted;
			assert.ok(interactiveDocument.getText().endsWith(marker), 'typing lost content while the index rebuilt');
			assert.ok(interactionElapsed < 500, `typing and saving took ${interactionElapsed.toFixed(1)} ms during rebuild`);
			assert.ok(interactionMaxDelay < 100, `rebuild blocked the extension host for ${interactionMaxDelay.toFixed(1)} ms during typing and save`);
			await rebuildWhileEditing;
			assert.strictEqual(api.getVaultIndexRecords().length, NOTE_COUNT);
			console.info(`[filesystem-performance] interactive-save=${interactionElapsed.toFixed(1)}ms max-delay=${interactionMaxDelay.toFixed(1)}ms`);

			const createRuns: number[] = [];
			const editRuns: number[] = [];
			const renameRuns: number[] = [];
			const deleteRuns: number[] = [];
			const parentPath = 'Groups/Group-000';
			for (let run = 0; run < 5; run++) {
				const sourcePath = `${parentPath}/Latency-${run}.md`;
				const renamedPath = `${parentPath}/Latency-${run}-renamed.md`;
				const source = vscode.Uri.file(join(fixture, ...sourcePath.split('/')));
				const destination = vscode.Uri.file(join(fixture, ...renamedPath.split('/')));

				createRuns.push(await measureConvergence(api, parentPath, async () => {
					await vscode.workspace.fs.writeFile(source, bytes(`# Latency ${run}\n`));
				}, () => Boolean(api.getVaultIndexRecords().find((record) => record.path === sourcePath)),
				(paths) => paths.includes(sourcePath)));

				editRuns.push(await measureConvergence(api, parentPath, async () => {
					await vscode.workspace.fs.writeFile(source, bytes(`---\naliases: [Edited ${run}]\n---\n# Latency ${run}\n`));
				}, () => Boolean(api.getVaultIndexRecords().find((record) =>
					record.path === sourcePath && record.aliases.includes(`Edited ${run}`))),
				(paths) => paths.includes(sourcePath)));

				renameRuns.push(await measureConvergence(api, parentPath, async () => {
					await vscode.workspace.fs.rename(source, destination, { overwrite: false });
				}, () => !api.getVaultIndexRecords().some((record) => record.path === sourcePath) &&
					api.getVaultIndexRecords().some((record) => record.path === renamedPath),
				(paths) => paths.includes(renamedPath) && !paths.includes(sourcePath)));

				deleteRuns.push(await measureConvergence(api, parentPath, async () => {
					await vscode.workspace.fs.delete(destination, { useTrash: false });
				}, () => !api.getVaultIndexRecords().some((record) => record.path === renamedPath),
				(paths) => !paths.includes(renamedPath)));
			}

			const measurements = { coldRuns, createRuns, editRuns, renameRuns, deleteRuns };
			console.info(`[filesystem-performance] ${JSON.stringify(measurements)}`);
			assert.ok(p95(coldRuns) < 3_000, `cold index p95 ${p95(coldRuns).toFixed(1)} ms exceeded 3,000 ms`);
			for (const [operation, samples] of Object.entries({ createRuns, editRuns, renameRuns, deleteRuns })) {
				assert.ok(p95(samples) < 500, `${operation} p95 ${p95(samples).toFixed(1)} ms exceeded 500 ms`);
			}

			const largePath = 'Groups/Group-001/Note-00001.md';
			const largeUri = vscode.Uri.file(join(fixture, ...largePath.split('/')));
			const largeNote = oneMibNote();
			await vscode.workspace.fs.writeFile(largeUri, bytes(largeNote));
			await waitFor(() => api.getVaultIndexRecords().find((record) => record.path === largePath)?.size === largeNote.length, 5_000);
			// Let the independently debounced metadata-cache write finish so this
			// probe attributes delay to opening the editor itself. Cache persistence
			// receives its own responsiveness probe below.
			await new Promise((resolve) => setTimeout(resolve, 2_000));

			const maxExtensionHostDelay = await measureEditorOpenDelay(largeUri);
			const smallNoteDelay = await measureEditorOpenDelay(interactiveUri);
			console.info(`[editor-host-performance] small-note-delay=${smallNoteDelay.toFixed(1)}ms`);
			console.info(`[editor-host-performance] max-continuous-delay=${maxExtensionHostDelay.toFixed(1)}ms`);
			assert.ok(
				maxExtensionHostDelay < 100,
				`opening a 1 MiB note blocked the extension host for ${maxExtensionHostDelay.toFixed(1)} ms`,
			);
		});
	});
}

async function measureConvergence(
	api: DevelopmentApi,
	parentPath: string,
	action: () => Promise<void>,
	indexReady: () => boolean,
	treeReady: (paths: readonly string[]) => boolean,
): Promise<number> {
	const revision = api.getVaultTreeRevision();
	const started = performance.now();
	await action();
	await waitFor(async () => {
		if (api.getVaultTreeRevision() <= revision || !indexReady()) return false;
		return treeReady(await api.getVaultTreePaths(parentPath));
	}, 5_000);
	return performance.now() - started;
}

async function waitFor(
	check: () => boolean | Promise<boolean>,
	timeoutMs: number,
	detail?: () => string,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	assert.fail(`condition was not met within ${timeoutMs} ms${detail ? ` (${detail()})` : ''}`);
}

function p95(samples: readonly number[]): number {
	const ordered = [...samples].sort((a, b) => a - b);
	return ordered[Math.ceil(ordered.length * 0.95) - 1];
}

function bytes(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

function oneMibNote(): string {
	const size = 1024 * 1024;
	const heading = '# One MiB extension-host probe\n\n';
	const line = 'A plain Markdown line used to measure extension-host responsiveness.\n';
	return (heading + line.repeat(Math.ceil((size - heading.length) / line.length))).slice(0, size);
}

function startEventLoopDelayMonitor(intervalMs = 5): { stop(): number } {
	let expected = performance.now() + intervalMs;
	let maxDelay = 0;
	const timer = setInterval(() => {
		const now = performance.now();
		maxDelay = Math.max(maxDelay, now - expected);
		expected = now + intervalMs;
	}, intervalMs);
	return {
		stop: () => {
			clearInterval(timer);
			return maxDelay;
		},
	};
}

async function measureEditorOpenDelay(uri: vscode.Uri): Promise<number> {
	const monitor = startEventLoopDelayMonitor();
	let maxDelay = 0;
	try {
		await new Promise((resolve) => setTimeout(resolve, 50));
		await vscode.commands.executeCommand('vscode.openWith', uri, 'mdLivePreview.editor');
		const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		assert.ok(input instanceof vscode.TabInputCustom, 'the performance note did not open in Live Preview');
		await new Promise((resolve) => setTimeout(resolve, 500));
	} finally {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		maxDelay = monitor.stop();
	}
	return maxDelay;
}
