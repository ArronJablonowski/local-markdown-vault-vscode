import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const EXTENSION_ID = 'arronjablonowski.local-markdown-vault';

interface IndexRecord {
	path: string;
	basename: string;
	aliases: string[];
	tags: string[];
	headings: Array<{ text: string; line: number }>;
	properties: Readonly<Record<string, unknown>>;
}

interface SearchResult {
	record: IndexRecord;
	line?: number;
	heading?: string;
	context?: string;
}

interface DevelopmentApi {
	getVaultIndexRecords(): readonly IndexRecord[];
	getVaultRecentPaths(): readonly string[];
	getVaultStorageIdentity(): { id: string; canonicalRootUri: string; legacyIds: readonly string[] } | undefined;
	getVaultCacheUri(): vscode.Uri | undefined;
	flushVaultIndexCache(): Promise<void>;
	searchVault(query: string, limit?: number): Promise<readonly SearchResult[]>;
}

suite('local knowledge navigation', () => {
	let api: DevelopmentApi;
	let root: vscode.Uri;
	let originalDefaultEditor: string | undefined;
	const fixtures: vscode.Uri[] = [];

	suiteSetup(async () => {
		const editorConfig = vscode.workspace.getConfiguration('mdLivePreview');
		originalDefaultEditor = editorConfig.inspect<string>('defaultEditor')?.globalValue;
		await editorConfig.update('defaultEditor', 'textEditor', vscode.ConfigurationTarget.Global);
		const extension = vscode.extensions.getExtension<DevelopmentApi>(EXTENSION_ID);
		assert.ok(extension, `extension ${EXTENSION_ID} is not installed`);
		api = await extension.activate();
		assert.ok(api, 'development knowledge API is unavailable');
		const folder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(folder?.uri.scheme === 'file', 'the integration workspace must be a local folder');
		root = folder.uri;
	});

	suiteTeardown(async () => {
		await vscode.workspace.getConfiguration('mdLivePreview')
			.update('defaultEditor', originalDefaultEditor, vscode.ConfigurationTarget.Global);
	});

	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		for (const fixture of fixtures.splice(0)) {
			try { await vscode.workspace.fs.delete(fixture, { recursive: true }); } catch { /* test already removed it */ }
		}
	});

	test('keys rebuildable storage by the canonical vault URI hash', () => {
		const identity = api.getVaultStorageIdentity();
		assert.ok(identity, 'the vault storage identity is unavailable');
		assert.strictEqual(identity.id, createHash('sha256').update(identity.canonicalRootUri).digest('hex'));
		assert.match(identity.canonicalRootUri, /^file:/);
		assert.match(identity.id, /^[a-f0-9]{64}$/);
		for (const legacy of identity.legacyIds) assert.match(legacy, /^[a-f0-9]{64}$/);
	});

	test('indexes external file changes and removes deleted notes', async () => {
		const folder = await makeFixture();
		const note = vscode.Uri.joinPath(folder, 'Watcher Note.md');
		const relative = relativePath(note);
		await vscode.workspace.fs.writeFile(note, bytes([
			'---',
			'aliases: [Watcher Alias]',
			'tags: [integration, watcher]',
			'---',
			'# Watched Heading',
			'',
			'Needle from the filesystem watcher.',
		].join('\n')));

		const indexed = await waitFor(
			() => api.getVaultIndexRecords().find((record) => record.path === relative),
			15_000,
		);
		assert.strictEqual(indexed.basename, 'Watcher Note');
		assert.deepStrictEqual(indexed.aliases, ['Watcher Alias']);
		assert.ok(indexed.tags.includes('integration'));
		assert.ok(indexed.headings.some((heading) => heading.text === 'Watched Heading'));

		await vscode.workspace.fs.delete(note);
		await waitFor(() => api.getVaultIndexRecords().every((record) => record.path !== relative), 15_000);
	});

	test('searches local content with line context and opens indexed results', async () => {
		const folder = await makeFixture();
		const note = vscode.Uri.joinPath(folder, 'Search Target.md');
		const relative = relativePath(note);
		await vscode.workspace.fs.writeFile(note, bytes([
			'---',
			'aliases: [Project Lantern]',
			'tags: [research/local]',
			'---',
			'# Findings',
			'',
			'The distinct phrase copper-orchid belongs only to this note.',
		].join('\n')));
		await waitFor(() => api.getVaultIndexRecords().some((record) => record.path === relative));

		const results = await api.searchVault('copper-orchid');
		const result = results.find((candidate) => candidate.record.path === relative);
		assert.ok(result, 'content search did not return the indexed note');
		assert.strictEqual(result.heading, 'Findings');
		assert.strictEqual(result.line, 7);
		assert.match(result.context ?? '', /copper-orchid/);

		await vscode.commands.executeCommand('mdLivePreview.openIndexedPath', relative, result.line);
		const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		assert.ok(input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom);
		assert.strictEqual(input.uri.toString(), note.toString());
		assert.strictEqual(api.getVaultRecentPaths()[0], relative);
	});

	test('rejects forged knowledge-view command arguments before navigation', async () => {
		const folder = await makeFixture();
		const guard = vscode.Uri.joinPath(folder, 'Knowledge Command Guard.md');
		const target = vscode.Uri.joinPath(folder, 'Knowledge Command Target.md');
		const relative = relativePath(target);
		await vscode.workspace.fs.writeFile(guard, bytes('# Guard\n'));
		await vscode.workspace.fs.writeFile(target, bytes('---\ntags: [secure/nested]\n---\n# Target\n'));
		await waitFor(() => api.getVaultIndexRecords().some((record) => record.path === relative));
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(guard));

		for (const args of [
			[{}, undefined],
			[relative, 0],
			[relative, Number.NaN],
			[relative, 10_000_001],
			['../outside.md', 1],
		] as const) {
			await assert.doesNotReject(async () => {
				await vscode.commands.executeCommand('mdLivePreview.openIndexedPath', ...args);
			});
		}
		assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), guard.toString());

		for (const tag of [{}, '', 'secure OR path:any', '#secure', 'missing']) {
			await assert.doesNotReject(async () => {
				await vscode.commands.executeCommand('mdLivePreview.searchTag', tag);
			});
		}
		assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), guard.toString());
	});

	test('indexes property names without values and verifies value filters from the note', async () => {
		const folder = await makeFixture();
		const note = vscode.Uri.joinPath(folder, 'Property Privacy.md');
		const relative = relativePath(note);
		await vscode.workspace.fs.writeFile(note, bytes([
			'---',
			'status: ready',
			'password: hunter2',
			'apiToken: secret-token-value',
			'---',
			'# Private properties',
		].join('\n')));

		const indexed = await waitFor(() => api.getVaultIndexRecords().find((record) => record.path === relative));
		assert.deepStrictEqual(indexed.properties, {
			status: null,
			password: null,
			apiToken: null,
		});
		const serialized = JSON.stringify(indexed);
		assert.ok(!serialized.includes('hunter2'));
		assert.ok(!serialized.includes('secret-token-value'));

		const matching = await api.searchVault('property:status=ready');
		assert.ok(matching.some((result) => result.record.path === relative));
		const nonmatching = await api.searchVault('property:status=archived');
		assert.ok(!nonmatching.some((result) => result.record.path === relative));
		const negatedMatching = await api.searchVault('-property:status=archived');
		assert.ok(negatedMatching.some((result) => result.record.path === relative));
		const negatedNonmatching = await api.searchVault('-property:status=ready');
		assert.ok(!negatedNonmatching.some((result) => result.record.path === relative));
	});

	test('persists only structural metadata and rebuilds search after cache deletion', async () => {
		const folder = await makeFixture();
		const note = vscode.Uri.joinPath(folder, 'Disposable Cache Privacy.md');
		const relative = relativePath(note);
		const propertySecret = 'cache-property-secret-7f31';
		const taskSecret = 'cache-task-secret-8a42';
		const bodySecret = 'cache-body-secret-9b53';
		await vscode.workspace.fs.writeFile(note, bytes([
			'---',
			'aliases: [Disposable Privacy Alias]',
			'password: ' + propertySecret,
			'---',
			'# Cache privacy heading',
			'',
			'- [ ] ' + taskSecret,
			'',
			'This searchable sentence contains ' + bodySecret + '.',
		].join('\n')));

		await waitFor(() => api.getVaultIndexRecords().some((record) => record.path === relative));
		assert.ok((await api.searchVault(bodySecret)).some((result) => result.record.path === relative));
		await api.flushVaultIndexCache();

		const cacheUri = api.getVaultCacheUri();
		assert.ok(cacheUri, 'development cache location is unavailable');
		const firstCache = new TextDecoder('utf-8', { fatal: true }).decode(await vscode.workspace.fs.readFile(cacheUri));
		assert.ok(!firstCache.includes(propertySecret), 'persisted cache retained a frontmatter value');
		assert.ok(!firstCache.includes(taskSecret), 'persisted cache retained task text');
		assert.ok(!firstCache.includes(bodySecret), 'persisted cache retained a body-derived search token');
		const firstEnvelope = JSON.parse(firstCache) as { records: Array<{
			path: string;
			properties: Record<string, unknown>;
			tasks: Array<{ text: string }>;
			searchTokens: string[];
		}> };
		const persisted = firstEnvelope.records.find((record) => record.path === relative);
		assert.ok(persisted, 'persisted cache omitted the fixture record');
		assert.strictEqual(persisted.properties.password, null);
		assert.ok(persisted.tasks.every((task) => task.text === ''));
		assert.ok(!persisted.searchTokens.includes(bodySecret));

		await vscode.workspace.fs.delete(cacheUri, { useTrash: false });
		await vscode.commands.executeCommand('mdLivePreview.vault.rebuildIndex');
		const rebuilt = await api.searchVault(bodySecret);
		const result = rebuilt.find((candidate) => candidate.record.path === relative);
		assert.ok(result, 'cache-free rebuild did not restore body search');
		await vscode.commands.executeCommand('mdLivePreview.openIndexedPath', relative, result.line);
		const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		assert.ok(input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom);
		assert.strictEqual(input.uri.toString(), note.toString(), 'cache-free rebuild did not restore navigation');

		await api.flushVaultIndexCache();
		const rebuiltCache = new TextDecoder('utf-8', { fatal: true }).decode(await vscode.workspace.fs.readFile(cacheUri));
		for (const secret of [propertySecret, taskSecret, bodySecret]) {
			assert.ok(!rebuiltCache.includes(secret), `rebuilt cache retained ${secret}`);
		}
	});

	test('does not open an indexed note replaced by an outside-vault symlink', async () => {
		const folder = await makeFixture();
		const guard = vscode.Uri.joinPath(folder, 'Guard.md');
		const target = vscode.Uri.joinPath(folder, 'Indexed Target.md');
		const relative = relativePath(target);
		await vscode.workspace.fs.writeFile(guard, bytes('# Guard\n'));
		await vscode.workspace.fs.writeFile(target, bytes('# Indexed target\n'));
		await waitFor(() => api.getVaultIndexRecords().some((record) => record.path === relative));
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(guard));

		const outside = await mkdtemp(join(tmpdir(), 'mdlp-stale-index-test-'));
		try {
			const secret = join(outside, 'outside.md');
			await writeFile(secret, '# outside secret\n');
			await unlink(target.fsPath);
			await symlink(secret, target.fsPath);
			await vscode.commands.executeCommand('mdLivePreview.openIndexedPath', relative);
			await new Promise((resolve) => setTimeout(resolve, 100));
			assert.strictEqual(
				vscode.window.activeTextEditor?.document.uri.toString(),
				guard.toString(),
				'stale index navigation opened an outside-vault symlink',
			);
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});

	test('updates search results from an unsaved open document', async () => {
		const folder = await makeFixture();
		const note = vscode.Uri.joinPath(folder, 'Dirty Search.md');
		const relative = relativePath(note);
		await vscode.workspace.fs.writeFile(note, bytes('# Draft\n\nOriginal text.\n'));
		await waitFor(() => api.getVaultIndexRecords().some((record) => record.path === relative));

		const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(note));
		await editor.edit((builder) => builder.insert(new vscode.Position(2, 0), 'unsaved-cobalt phrase\n'));
		assert.strictEqual(editor.document.isDirty, true);
		await waitFor(async () => (await api.searchVault('unsaved-cobalt')).some((result) => result.record.path === relative));
		assert.strictEqual(editor.document.isDirty, true, 'indexing unexpectedly saved the note');
	});

	test('records notes opened through the ordinary text editor as recent', async () => {
		const folder = await makeFixture();
		const note = vscode.Uri.joinPath(folder, 'Ordinary Recent.md');
		const relative = relativePath(note);
		await vscode.workspace.fs.writeFile(note, bytes('# Ordinary recent note\n'));
		await waitFor(() => api.getVaultIndexRecords().some((record) => record.path === relative));

		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(note));
		await waitFor(() => api.getVaultRecentPaths()[0] === relative);
	});

	test('prunes excluded notes from the index and recent-note history', async () => {
		const folder = await makeFixture();
		const note = vscode.Uri.joinPath(folder, 'Excluded Recent.md');
		const relative = relativePath(note);
		await vscode.workspace.fs.writeFile(note, bytes('# Excluded recent note\n\nprivate-copper-term\n'));
		await waitFor(() => api.getVaultIndexRecords().some((record) => record.path === relative));
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(note));
		await waitFor(() => api.getVaultRecentPaths()[0] === relative);

		const configuration = vscode.workspace.getConfiguration('mdLivePreview.vault', note);
		const prior = configuration.inspect<string[]>('exclude')?.workspaceFolderValue;
		const effective = configuration.get<string[]>('exclude', []);
		const folderRelative = relativePath(folder);
		try {
			await configuration.update('exclude', [...effective, `/${folderRelative}/**`], vscode.ConfigurationTarget.WorkspaceFolder);
			await waitFor(() => api.getVaultIndexRecords().every((record) => record.path !== relative));
			await waitFor(() => !api.getVaultRecentPaths().includes(relative));
			assert.ok(!(await api.searchVault('private-copper-term')).some((result) => result.record.path === relative));
		} finally {
			await configuration.update('exclude', prior, vscode.ConfigurationTarget.WorkspaceFolder);
			await waitFor(() => api.getVaultIndexRecords().some((record) => record.path === relative));
		}
	});

	async function makeFixture(): Promise<vscode.Uri> {
		const fixture = vscode.Uri.joinPath(root, `.knowledge-test-${Date.now()}-${fixtures.length}`);
		await vscode.workspace.fs.createDirectory(fixture);
		fixtures.push(fixture);
		return fixture;
	}

	function relativePath(uri: vscode.Uri): string {
		return uri.fsPath.slice(root.fsPath.length + 1).replace(/\\/g, '/');
	}
});

function bytes(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

async function waitFor<T>(read: () => T | Promise<T>, timeoutMs = 5_000): Promise<Exclude<T, false | undefined>> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await read();
		if (value) return value as Exclude<T, false | undefined>;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	assert.fail('knowledge index did not converge before the timeout');
}
