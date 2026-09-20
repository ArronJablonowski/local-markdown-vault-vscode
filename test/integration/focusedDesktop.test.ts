import * as assert from 'assert';
import * as vscode from 'vscode';
import { chromium, type Browser, type Frame, type Page } from 'playwright';

const EXTENSION_ID = 'arronjablonowski.local-markdown-vault';
let debugBrowser: Browser | undefined;

interface VaultServiceApi {
	rootUri: vscode.Uri;
	createFolder(parent: vscode.Uri, name: string): Promise<vscode.Uri>;
	createNote(parent: vscode.Uri, name: string): Promise<vscode.Uri>;
}

interface DevelopmentApi {
	getVaultService(): VaultServiceApi | undefined;
	renameOrMoveMany(requests: readonly {
		source: vscode.Uri;
		destination: vscode.Uri;
		isFolder: boolean;
	}[]): Promise<boolean>;
	settleCaseRenameTransactions(): Promise<void>;
}

suite('focused macOS desktop transactions', () => {
	if (process.env.MDLP_FOCUSED_DESKTOP_TEST !== '1') return;

	let api: DevelopmentApi;
	let service: VaultServiceApi;
	const fixtures: vscode.Uri[] = [];

	suiteSetup(async function () {
		if (process.platform !== 'darwin') this.skip();
		await bringIsolatedWorkbenchToFront();
		const extension = vscode.extensions.getExtension<DevelopmentApi>(EXTENSION_ID);
		assert.ok(extension, `extension ${EXTENSION_ID} is not installed`);
		api = await extension.activate();
		const resolved = api.getVaultService();
		assert.ok(resolved, 'the focused workspace must be a local single-folder vault');
		service = resolved;
	});

	teardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		for (const fixture of fixtures.splice(0)) {
			try { await vscode.workspace.fs.delete(fixture, { recursive: true }); } catch { /* already removed */ }
		}
	});

	test('undo and redo one text edit at a time in the focused editor', async () => {
		const fixture = await makeFixture('text');
		const note = await service.createNote(fixture, 'Focused Editing');
		await vscode.workspace.fs.writeFile(note, bytes('# Title\n'));
		const document = await vscode.workspace.openTextDocument(note);
		await vscode.window.showTextDocument(document);
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');

		await insert(document, 7, ' one');
		await insert(document, 11, ' two');
		assert.strictEqual(document.lineAt(0).text, '# Title one two');
		await vscode.commands.executeCommand('undo');
		await waitFor(() => document.lineAt(0).text === '# Title one', 'undo did not remove exactly one edit');
		await vscode.commands.executeCommand('undo');
		await waitFor(() => document.lineAt(0).text === '# Title', 'second undo did not restore the original text');
		await vscode.commands.executeCommand('redo');
		await waitFor(() => document.lineAt(0).text === '# Title one', 'redo did not restore exactly one edit');
		await vscode.commands.executeCommand('redo');
		await waitFor(() => document.lineAt(0).text === '# Title one two', 'second redo did not restore the final text');
	});

	test('keeps Live Preview keyboard edits, save, and external changes synchronized', async () => {
		const fixture = await makeFixture('live-preview');
		const note = await service.createNote(fixture, 'Focused Live Preview');
		const original = '# Live Preview\n';
		const inserted = 'mac-live-preview ';
		await vscode.workspace.fs.writeFile(note, bytes(original));
		const document = await vscode.workspace.openTextDocument(note);
		await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
		await waitFor(() => {
			const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
			return input instanceof vscode.TabInputCustom && input.viewType === 'mdLivePreview.editor';
		}, 'Live Preview did not become the active custom editor');

		const frame = await connectToLivePreviewFrame();
		const editor = frame.locator('.cm-content');
		await editor.click();
		await frame.page().keyboard.type(inserted);
		await waitFor(() => document.getText().includes(inserted), 'macOS keyboard input did not reach Live Preview');
		const edited = document.getText();
		assert.notStrictEqual(edited, original);
		assert.strictEqual(document.isDirty, true, 'Live Preview keyboard input did not mark the document dirty');

		await frame.page().keyboard.press('Meta+z');
		await waitFor(() => document.getText() === original, 'Cmd+Z did not undo the Live Preview edit in the TextDocument');
		await frame.page().keyboard.press('Meta+Shift+z');
		await waitFor(() => document.getText() === edited, 'Cmd+Shift+Z did not redo the Live Preview edit in the TextDocument');

		await frame.page().keyboard.press('Meta+s');
		await waitFor(() => !document.isDirty, 'Cmd+S did not save the Live Preview document');
		assert.strictEqual(new TextDecoder().decode(await vscode.workspace.fs.readFile(note)), edited);

		const external = '# External Live Preview update\n';
		await vscode.workspace.fs.writeFile(note, bytes(external));
		await waitFor(() => document.getText() === external, 'the TextDocument did not receive the external file change');
		await waitFor(async () => (await editor.textContent())?.includes('External Live Preview update') === true,
			'Live Preview did not render the external file change');
	});

	test('opens hostile Markdown without script execution, active unsafe URLs, or remote requests', async () => {
		const fixture = await makeFixture('hostile');
		const note = await service.createNote(fixture, 'Hostile Live Preview');
		const sentinelHost = 'mdlp-security.invalid';
		const sentinel = `host-probe-${Date.now()}`;
		const remoteUrl = `https://${sentinelHost}/${sentinel}.png`;
		const source = [
			'# Hostile Live Preview',
			`<script>document.documentElement.dataset['${sentinel}'] = 'executed'</script>`,
			`<img src="${remoteUrl}?raw" onerror="document.documentElement.dataset['${sentinel}']='error'">`,
			`![remote tracker](${remoteUrl}?markdown)`,
			'[javascript](javascript:alert(document.domain))',
			'[command](command:workbench.action.files.newUntitledFile)',
			'[data](data:text/html,<script>alert(document.domain)</script>)',
			'[outside](../../../../../../etc/passwd)',
			'',
		].join('\n');
		await vscode.workspace.fs.writeFile(note, bytes(source));

		const page = await getWorkbenchPage();
		const sentinelRequests: string[] = [];
		const recordRequest = (request: { url(): string }) => {
			if (request.url().includes(sentinelHost)) sentinelRequests.push(request.url());
		};
		page.on('request', recordRequest);
		try {
			await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
			await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
			const frame = await connectToLivePreviewFrame();
			const editorText = await frame.locator('.cm-content').textContent();
			assert.ok(editorText?.includes(sentinel), 'raw hostile HTML was not preserved as inert editable text');
			await new Promise((resolve) => setTimeout(resolve, 500));

			assert.strictEqual(
				await frame.evaluate((key) => document.documentElement.dataset[key], sentinel),
				undefined,
				'raw Markdown HTML executed in the real webview',
			);
			const hostileScripts = await frame.locator('script').evaluateAll((scripts, marker) =>
				scripts.filter((script) => script.textContent?.includes(String(marker))).length, sentinel);
			assert.strictEqual(hostileScripts, 0, 'hostile Markdown became an executable script element');
			const unsafeLinks = await frame.locator('a').evaluateAll((links) => links
				.map((link) => link.getAttribute('href') ?? '')
				.filter((href) => /^(?:javascript|command|data):/i.test(href)));
			assert.deepStrictEqual(unsafeLinks, [], 'hostile Markdown retained an active unsafe URL');
			assert.strictEqual(
				await frame.locator(`[src*="${sentinelHost}"], [href*="${sentinelHost}"]`).count(),
				0,
				'default-blocked remote media retained an active network URL',
			);
			assert.deepStrictEqual(sentinelRequests, [], 'opening hostile Markdown emitted a remote sentinel request');
		} finally {
			page.off('request', recordRequest);
		}
	});

	test('undoes and redoes a vault move and link rewrite as one unit', async () => {
		const fixture = await makeFixture('move');
		const archive = await service.createFolder(fixture, 'Archive');
		const source = await service.createNote(fixture, 'Move Target');
		const index = await service.createNote(fixture, 'Move Index');
		await vscode.workspace.fs.writeFile(source, bytes('# Move target\n'));
		await vscode.workspace.fs.writeFile(index, bytes('[[Move Target]]\n'));
		const indexDocument = await vscode.workspace.openTextDocument(index);
		await vscode.window.showTextDocument(indexDocument);
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
		const destination = vscode.Uri.joinPath(archive, 'Moved Target.md');

		assert.strictEqual(await api.renameOrMoveMany([{ source, destination, isFolder: false }]), true);
		await waitFor(async () => await exists(destination) && !(await exists(source)), 'vault move did not commit');
		assert.strictEqual(indexDocument.getText(), '[[Moved Target]]\n');
		await vscode.commands.executeCommand('undo');
		await waitFor(async () => await exists(source) && !(await exists(destination)) && indexDocument.getText() === '[[Move Target]]\n', 'one undo did not restore the source and link');
		await vscode.commands.executeCommand('redo');
		await waitFor(async () => await exists(destination) && !(await exists(source)) && indexDocument.getText() === '[[Moved Target]]\n', 'one redo did not restore the move and link');
	});

	test('replays a case-only rename after undo and keeps one-step inverse behavior', async () => {
		const fixture = await makeFixture('case');
		const source = await service.createNote(fixture, 'FocusedCase');
		const index = await service.createNote(fixture, 'Case Index');
		await vscode.workspace.fs.writeFile(source, bytes('# Focused case\n'));
		await vscode.workspace.fs.writeFile(index, bytes('[[FocusedCase]]\n'));
		const indexDocument = await vscode.workspace.openTextDocument(index);
		await vscode.window.showTextDocument(indexDocument);
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
		const destination = vscode.Uri.joinPath(fixture, 'focusedcase.md');

		assert.strictEqual(await api.renameOrMoveMany([{ source, destination, isFolder: false }]), true);
		await waitFor(async () => (await entryNames(fixture)).includes('focusedcase.md'), 'case-only rename did not commit');
		assert.strictEqual(indexDocument.getText(), '[[focusedcase]]\n');
		await vscode.commands.executeCommand('undo');
		await waitFor(async () => (await entryNames(fixture)).includes('FocusedCase.md'), 'case-only undo did not restore exact casing');
		await api.settleCaseRenameTransactions();
		assert.strictEqual(indexDocument.getText(), '[[FocusedCase]]\n');
		await vscode.commands.executeCommand('mdLivePreview.caseAwareRedo');
		await waitFor(async () => (await entryNames(fixture)).includes('focusedcase.md'), 'case-aware redo did not replay the rename');
		assert.strictEqual(indexDocument.getText(), '[[focusedcase]]\n');
		await vscode.commands.executeCommand('undo');
		await waitFor(async () => (await entryNames(fixture)).includes('FocusedCase.md'), 'replayed transaction did not undo in one step');
		await api.settleCaseRenameTransactions();
		assert.strictEqual(indexDocument.getText(), '[[FocusedCase]]\n');
	});

	async function makeFixture(suffix: string): Promise<vscode.Uri> {
		const fixture = await service.createFolder(service.rootUri, `.focused-${suffix}-${Date.now()}`);
		fixtures.push(fixture);
		return fixture;
	}
});

async function insert(document: vscode.TextDocument, offset: number, text: string): Promise<void> {
	const edit = new vscode.WorkspaceEdit();
	edit.insert(document.uri, document.positionAt(offset), text);
	assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
}

function bytes(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

async function connectToLivePreviewFrame(): Promise<Frame> {
	const browser = await connectToDebugBrowser();
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		for (const context of browser.contexts()) {
			for (const page of context.pages()) {
				for (const frame of page.frames()) {
					if (await frame.locator('.cm-content').count() > 0) return frame;
				}
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	assert.fail('could not find the active Live Preview CodeMirror frame');
}

async function bringIsolatedWorkbenchToFront(): Promise<void> {
	const page = await getWorkbenchPage();
	await page.bringToFront();
}

async function getWorkbenchPage(): Promise<Page> {
	const browser = await connectToDebugBrowser();
	const pages = browser.contexts().flatMap((context) => context.pages());
	assert.ok(pages.length > 0, 'the isolated VS Code workbench page is unavailable');
	return pages[0];
}

async function connectToDebugBrowser(): Promise<Browser> {
	if (debugBrowser) return debugBrowser;
	const port = Number(process.env.MDLP_VSCODE_DEBUG_PORT);
	assert.ok(Number.isInteger(port) && port > 0 && port <= 65_535, 'the focused runner did not provide a debugging port');
	const deadline = Date.now() + 10_000;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			debugBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
			return debugBrowser;
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	assert.fail(`could not connect to the isolated VS Code workbench: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

async function entryNames(directory: vscode.Uri): Promise<string[]> {
	return (await vscode.workspace.fs.readDirectory(directory)).map(([name]) => name);
}

async function waitFor(
	check: () => boolean | Promise<boolean>,
	message: string,
	timeoutMs = 5_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	assert.fail(message);
}
