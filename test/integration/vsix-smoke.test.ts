import * as assert from 'assert';
import * as vscode from 'vscode';
import { isAbsolute, relative } from 'node:path';
import { chromium, type Browser, type Frame, type Page } from 'playwright';

const EXTENSION_ID = 'arronjablonowski.local-markdown-vault';
const mode = process.env.MDLP_VSIX_SMOKE_MODE;
const vsixOnly = mode === 'trusted' || mode === 'restricted' ? test : test.skip;
const disabledOnly = mode === 'disabled' ? test : test.skip;
const NOTE_SOURCE = [
	'# Packaged smoke',
	'',
	'[[Packaged Target]]',
	'',
	'![Packaged local image](pixel.png)',
	'',
	'![Blocked remote image](https://mdlp-vsix.invalid/tracker.png)',
	'',
	'```mermaid',
	'graph TD',
	'  A --> B',
	'```',
	'',
].join('\n');
const OBSIDIAN_SOURCE = '{"livePreview":true,"legacyEditor":false,"theme":"moonstone"}\n';
let debugBrowser: Browser | undefined;

suite('Installed VSIX clean-profile smoke', () => {
	suiteTeardown(async () => {
		await debugBrowser?.close();
		debugBrowser = undefined;
	});

	vsixOnly('loads the packaged extension rather than the development checkout', async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, `extension ${EXTENSION_ID} is not installed`);
		const installedRoot = process.env.MDLP_VSIX_EXTENSIONS_DIR;
		assert.ok(installedRoot, 'the VSIX smoke runner did not identify its isolated extension directory');
		const installedRelative = relative(installedRoot, extension.extensionPath);
		assert.ok(
			installedRelative && !isAbsolute(installedRelative) && installedRelative !== '..' &&
				!installedRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`),
			`the target extension was not loaded from the isolated VSIX directory: ${extension.extensionPath}`,
		);
		assert.strictEqual(extension.packageJSON.version, process.env.MDLP_VSIX_VERSION);
		const productionApi = await extension.activate();
		assert.strictEqual(extension.isActive, true);
		assert.strictEqual(productionApi, undefined, 'the packaged extension exposed its development-only test API');
	});

	vsixOnly('opens packaged Live Preview from a clean profile', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root, 'the VSIX smoke workspace is unavailable');
		const note = vscode.Uri.joinPath(root, 'README.md');
		await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
		const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		assert.ok(input instanceof vscode.TabInputCustom, 'the packaged Live Preview custom editor did not open');
		assert.strictEqual(input.viewType, 'mdLivePreview.editor');
	});

	vsixOnly('matches the requested clean-profile trust state', async () => {
		assert.strictEqual(vscode.workspace.isTrusted, mode === 'trusted');
	});

	(mode === 'trusted' ? test : test.skip)('registers packaged vault and knowledge commands in trusted mode', async () => {
		const commands = new Set(await vscode.commands.getCommands(true));
		for (const command of [
			'mdLivePreview.vault.refresh',
			'mdLivePreview.quickSwitcher',
			'mdLivePreview.vaultSearch',
			'mdLivePreview.vault.rebuildIndex',
		]) {
			assert.ok(commands.has(command), `missing packaged command ${command}`);
		}
		await vscode.commands.executeCommand('mdLivePreview.vault.refresh');
		await vscode.commands.executeCommand('mdLivePreview.vault.rebuildIndex');
	});

	(mode === 'trusted' ? test : test.skip)('walks the packaged trusted vault, editor, media, diagrams, index, and knowledge views', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root, 'the VSIX smoke workspace is unavailable');
		const note = vscode.Uri.joinPath(root, 'README.md');
		const target = vscode.Uri.joinPath(root, 'Packaged Target.md');
		const page = await getWorkbenchPage();
		await page.bringToFront();
		await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');

		const frame = await connectToLivePreviewFrame('Packaged smoke');
		await frame.locator('.cm-content').waitFor({ state: 'visible', timeout: 10_000 });
		const localImage = frame.locator('.mlp-image[alt="Packaged local image"]');
		await waitFor(async () => (await localImage.getAttribute('src'))?.startsWith('blob:') === true,
			'the installed VSIX did not render validated local image bytes');
		await frame.locator('.mlp-mermaid-wrap svg').waitFor({ state: 'visible', timeout: 20_000 });

		const link = frame.locator('.mlp-wikilink[data-href="wikilink:Packaged%20Target"]');
		await link.waitFor({ state: 'visible', timeout: 5_000 });
		await link.click();
		await waitFor(() => activeTabUri()?.toString() === target.toString(),
			'the installed VSIX did not navigate its rendered wikilink');

		await vscode.commands.executeCommand('mdLivePreview.vault.focus');
		await visibleWorkbenchRow(page, 'Packaged Target.md').waitFor({ state: 'visible', timeout: 5_000 });

		await vscode.commands.executeCommand('mdLivePreview.quickSwitcher');
		const quickPick = page.locator('.quick-input-widget:visible');
		await quickPick.waitFor({ state: 'visible', timeout: 5_000 });
		const quickInput = quickPick.locator('.quick-input-box input');
		await quickInput.fill('Packaged Target');
		await quickPick.locator('.monaco-list-row').filter({ hasText: 'Packaged Target' })
			.waitFor({ state: 'visible', timeout: 5_000 });
		await quickInput.press('Escape');

		await vscode.commands.executeCommand('mdLivePreview.backlinks.focus');
		await page.getByRole('treeitem', { name: /^Linked mention in README\.md, line 3$/ })
			.waitFor({ state: 'visible', timeout: 5_000 });
		await vscode.commands.executeCommand('mdLivePreview.tags.focus');
		await page.getByRole('treeitem', { name: /^Tag packaged, 1 note\(s\)$/ })
			.waitFor({ state: 'visible', timeout: 5_000 });
	});

	(mode === 'restricted' ? test : test.skip)('blocks packaged vault mutations in Restricted Mode', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root, 'the VSIX smoke workspace is unavailable');
		const before = (await vscode.workspace.fs.readDirectory(root)).map(([name]) => name).sort();
		await vscode.commands.executeCommand('mdLivePreview.vault.newFolder');
		const after = (await vscode.workspace.fs.readDirectory(root)).map(([name]) => name).sort();
		assert.deepStrictEqual(after, before, 'the packaged extension mutated an untrusted workspace');
	});

	(mode === 'restricted' ? test : test.skip)('keeps packaged editing local and disables restricted renderers', async () => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root, 'the VSIX smoke workspace is unavailable');
		const page = await getWorkbenchPage();
		await page.bringToFront();
		const remoteRequests: string[] = [];
		await page.route('https://mdlp-vsix.invalid/**', async (route) => {
			remoteRequests.push(route.request().url());
			await route.abort();
		});
		try {
			await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.joinPath(root, 'README.md'), 'mdLivePreview.editor');
			await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
			const frame = await connectToLivePreviewFrame('Packaged smoke');
			await frame.locator('.cm-content').waitFor({ state: 'visible', timeout: 10_000 });
			await waitFor(async () => (await frame.locator('.mlp-image[alt="Packaged local image"]').getAttribute('src'))?.startsWith('blob:') === true,
				'Restricted Mode did not retain secure local-image rendering');
			await frame.locator('.mlp-image-blocked').waitFor({ state: 'visible', timeout: 5_000 });
			await delay(750);
			assert.strictEqual(await frame.locator('img[src^="https://mdlp-vsix.invalid/"]').count(), 0,
				'Restricted Mode inserted a remote image URL');
			assert.deepStrictEqual(remoteRequests, [], 'Restricted Mode emitted a remote image request');
			assert.strictEqual(await frame.locator('.mlp-mermaid-wrap, .mlp-drawio-wrap').count(), 0,
				'Restricted Mode executed a diagram renderer');
			assert.ok((await frame.locator('.cm-content').textContent())?.includes('graph TD'),
				'Restricted Mode did not preserve editable diagram source');
		} finally {
			await page.unroute('https://mdlp-vsix.invalid/**');
		}
	});

	disabledOnly('leaves an Obsidian vault usable as ordinary files when disabled', async () => {
		assert.strictEqual(vscode.extensions.getExtension(EXTENSION_ID), undefined,
			'the target extension remained enabled in the disabled-profile smoke test');
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(root, 'the disabled VSIX smoke workspace is unavailable');
		const note = vscode.Uri.joinPath(root, 'README.md');
		const document = await vscode.workspace.openTextDocument(note);
		assert.strictEqual(document.getText(), NOTE_SOURCE, 'the disabled extension left unreadable or changed Markdown');
		await vscode.window.showTextDocument(document);
		assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputText,
			'the disabled extension prevented the note from opening in VS Code\'s text editor');
		assert.strictEqual(
			new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, '.obsidian', 'app.json'))),
			OBSIDIAN_SOURCE,
			'the disabled extension changed Obsidian settings',
		);
	});
});

async function connectToLivePreviewFrame(expectedText: string): Promise<Frame> {
	const browser = await connectToDebugBrowser();
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		for (const context of browser.contexts()) {
			for (const page of context.pages()) {
				for (const frame of page.frames()) {
					if (frame.isDetached()) continue;
					const editor = frame.locator('.cm-content');
					if (await editor.count() > 0 && (await editor.textContent())?.includes(expectedText)) return frame;
				}
			}
		}
		await delay(100);
	}
	assert.fail('could not find the installed Live Preview CodeMirror frame');
}

async function getWorkbenchPage(): Promise<Page> {
	const browser = await connectToDebugBrowser();
	const pages = browser.contexts().flatMap((context) => context.pages());
	assert.ok(pages.length > 0, 'the installed VSIX workbench page is unavailable');
	return pages[0];
}

async function connectToDebugBrowser(): Promise<Browser> {
	if (debugBrowser) return debugBrowser;
	const port = Number(process.env.MDLP_VSCODE_DEBUG_PORT);
	assert.ok(Number.isInteger(port) && port > 0 && port <= 65_535,
		'the installed VSIX runner did not provide a debugging port');
	const deadline = Date.now() + 10_000;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			debugBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
			return debugBrowser;
		} catch (error) {
			lastError = error;
		}
		await delay(100);
	}
	assert.fail(`could not connect to the installed VSIX workbench: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function activeTabUri(): vscode.Uri | undefined {
	const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
	return input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri : undefined;
}

function visibleWorkbenchRow(page: Page, text: string) {
	return page.locator('.monaco-list-row:visible').filter({ hasText: text });
}

async function waitFor(check: () => boolean | Promise<boolean>, message: string, timeoutMs = 10_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await check()) return;
		await delay(50);
	}
	assert.fail(message);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
