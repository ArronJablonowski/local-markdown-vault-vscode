import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'arronjablonowski.local-markdown-vault';
const NOTE_PATH = 'Private Restart Note.md';
const PROPERTY_SECRET = 'restart-property-secret-61ad';
const TASK_SECRET = 'restart-task-secret-72be';
const BODY_SECRET = 'restart-body-secret-83cf';
const OBSIDIAN_SETTINGS = '{"livePreview":true,"legacyEditor":false}\n';

interface IndexRecord {
	path: string;
}

interface SearchResult {
	record: IndexRecord;
	line?: number;
}

interface DevelopmentApi {
	getVaultIndexRecords(): readonly IndexRecord[];
	getVaultCacheUri(): vscode.Uri | undefined;
	flushVaultIndexCache(): Promise<void>;
	searchVault(query: string, limit?: number): Promise<readonly SearchResult[]>;
}

suite('cache-free startup rebuild', () => {
	const phase = process.env.MDLP_CACHE_RESTART_PHASE;
	if (phase !== 'seed' && phase !== 'recover') return;

	test(`${phase} phase`, async () => {
		const folder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(folder?.uri.scheme === 'file', 'cache restart test requires one local folder');
		const extension = vscode.extensions.getExtension<DevelopmentApi>(EXTENSION_ID);
		assert.ok(extension, `extension ${EXTENSION_ID} is not installed`);
		const api = await extension.activate();
		assert.ok(api, 'development cache API is unavailable');
		const note = vscode.Uri.joinPath(folder.uri, NOTE_PATH);
		const obsidianSettings = vscode.Uri.joinPath(folder.uri, '.obsidian', 'app.json');

		await waitFor(() => api.getVaultIndexRecords().some((record) => record.path === NOTE_PATH));
		const results = await api.searchVault(BODY_SECRET);
		const result = results.find((candidate) => candidate.record.path === NOTE_PATH);
		assert.ok(result, `${phase} startup did not restore body search`);
		assert.strictEqual(
			new TextDecoder().decode(await vscode.workspace.fs.readFile(obsidianSettings)),
			OBSIDIAN_SETTINGS,
			`${phase} startup changed Obsidian settings`,
		);

		await api.flushVaultIndexCache();
		const cacheUri = api.getVaultCacheUri();
		assert.ok(cacheUri, 'cache location is unavailable');
		await assertPrivateCache(cacheUri);

		if (phase === 'seed') {
			await vscode.workspace.fs.delete(cacheUri, { useTrash: false });
			await assert.rejects(async () => vscode.workspace.fs.stat(cacheUri));
			return;
		}

		await vscode.commands.executeCommand('mdLivePreview.openIndexedPath', NOTE_PATH, result.line);
		const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		assert.ok(input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom);
		assert.strictEqual(input.uri.toString(), note.toString(), 'cache-free startup did not restore navigation');
	});
});

async function assertPrivateCache(cacheUri: vscode.Uri): Promise<void> {
	const source = new TextDecoder('utf-8', { fatal: true }).decode(await vscode.workspace.fs.readFile(cacheUri));
	for (const secret of [PROPERTY_SECRET, TASK_SECRET, BODY_SECRET]) {
		assert.ok(!source.includes(secret), `persisted cache retained ${secret}`);
	}
	const envelope = JSON.parse(source) as { records: Array<{
		path: string;
		properties: Record<string, unknown>;
		tasks: Array<{ text: string }>;
		searchTokens: string[];
	}> };
	const record = envelope.records.find((candidate) => candidate.path === NOTE_PATH);
	assert.ok(record, 'persisted cache omitted the restart fixture');
	assert.strictEqual(record.properties.password, null);
	assert.ok(record.tasks.every((task) => task.text === ''));
	assert.ok(!record.searchTokens.includes(BODY_SECRET));
}

async function waitFor(read: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await read()) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	assert.fail('cache restart index did not converge before the timeout');
}
