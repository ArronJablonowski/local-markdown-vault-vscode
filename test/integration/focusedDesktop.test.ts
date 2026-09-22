import * as assert from 'assert';
import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type Frame, type Page } from 'playwright';

const EXTENSION_ID = 'arronjablonowski.local-markdown-vault';
let debugBrowser: Browser | undefined;

const SECURITY_CORPUS = [
	{ file: 'malicious.md', visibleText: 'Hostile Markdown must remain inert' },
	{ file: 'malicious-yaml-alias.md', visibleText: 'The editor must stay responsive' },
	{ file: 'hostile-html-and-urls.md', visibleText: 'URL and HTML boundary fixture' },
	{ file: 'hostile-diagrams.md', visibleText: 'Diagram boundary fixture' },
	{ file: 'hostile-yaml-depth.md', visibleText: 'Deep YAML must leave the editor usable' },
	{
		file: 'hostile-malformed-syntax.md',
		visibleText: 'The editor remains usable after malformed syntax.',
		repeatText: '![[Repeated missing embed]] ',
		repeatCount: 4096,
	},
] as const;

interface VaultServiceApi {
	rootUri: vscode.Uri;
	createFolder(parent: vscode.Uri, name: string): Promise<vscode.Uri>;
	createNote(parent: vscode.Uri, name: string): Promise<vscode.Uri>;
}

interface DevelopmentApi {
	getVaultService(): VaultServiceApi | undefined;
	getVaultIndexRecords(): readonly { path: string }[];
	renameOrMoveMany(requests: readonly {
		source: vscode.Uri;
		destination: vscode.Uri;
		isFolder: boolean;
	}[]): Promise<boolean>;
	settleCaseRenameTransactions(): Promise<void>;
}

suite('focused cross-platform desktop transactions', () => {
	if (process.env.MDLP_FOCUSED_DESKTOP_TEST !== '1') return;

	let api: DevelopmentApi;
	let service: VaultServiceApi;
	let extensionUri: vscode.Uri;
	const fixtures: vscode.Uri[] = [];

	suiteSetup(async function () {
		await bringIsolatedWorkbenchToFront();
		const extension = vscode.extensions.getExtension<DevelopmentApi>(EXTENSION_ID);
		assert.ok(extension, `extension ${EXTENSION_ID} is not installed`);
		extensionUri = extension.extensionUri;
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

	test('copies code through the host when the browser clipboard rejects access', async () => {
		const previousClipboard = await vscode.env.clipboard.readText();
		try {
			const fixture = await makeFixture('copy-code');
			const note = await service.createNote(fixture, 'Copy Code');
			const code = 'console.log("clipboard Ω");';
			await vscode.workspace.fs.writeFile(note, bytes('# Copy test\n\n```js\n' + code + '\n```\n\nAfter'));
			await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
			await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
			const frame = await connectToLivePreviewFrame('Copy test');
			await frame.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: { writeText: () => Promise.reject(new Error('Clipboard permission denied')) },
			}));
			await frame.getByRole('button', { name: 'Copy code block', exact: true }).click();
			await waitFor(async () => (await vscode.env.clipboard.readText()) === code,
				'the code copy button did not write the exact block to the system clipboard');
			assert.strictEqual(await frame.locator('.mlp-copy-code-btn').textContent(), '✓');
		} finally {
			await vscode.env.clipboard.writeText(previousClipboard);
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
		const inserted = 'desktop-live-preview ';
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
		await waitFor(() => document.getText().includes(inserted), 'desktop keyboard input did not reach Live Preview');
		const edited = document.getText();
		assert.notStrictEqual(edited, original);
		await waitFor(() => document.isDirty, 'Live Preview keyboard input did not mark the document dirty');

		const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
		await frame.page().keyboard.press(`${primaryModifier}+z`);
		await waitFor(() => document.getText() === original, 'the platform undo shortcut did not undo the Live Preview edit');
		const redoShortcut = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';
		await frame.page().keyboard.press(redoShortcut);
		await waitFor(() => document.getText() === edited, 'the platform redo shortcut did not redo the Live Preview edit');

		await frame.page().keyboard.press(`${primaryModifier}+s`);
		await waitFor(() => !document.isDirty, 'the platform save shortcut did not save the Live Preview document');
		assert.strictEqual(new TextDecoder().decode(await vscode.workspace.fs.readFile(note)), edited);

		const external = '# External Live Preview update\n';
		await vscode.workspace.fs.writeFile(note, bytes(external));
		await waitFor(() => document.getText() === external, 'the TextDocument did not receive the external file change');
		await waitFor(async () => (await editor.textContent())?.includes('External Live Preview update') === true,
			'Live Preview did not render the external file change');
	});

	test('automatically saves a task checkbox click to the Markdown file', async () => {
		const fixture = await makeFixture('checkbox-autosave');
		const note = await service.createNote(fixture, 'Checkbox Auto Save');
		await vscode.workspace.fs.writeFile(note, bytes('# Tasks\n\n- [ ] Save this change\n'));
		await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');

		const frame = await connectToLivePreviewFrame('Save this change');
		const checkbox = frame.locator('.mlp-checkbox').first();
		assert.strictEqual(await checkbox.getAttribute('aria-checked'), 'false');
		await checkbox.click();

		const document = vscode.workspace.textDocuments.find(
			(candidate) => candidate.uri.toString() === note.toString(),
		);
		assert.ok(document, 'the checkbox note did not have an open TextDocument');
		await waitFor(() => document.getText().includes('- [x] Save this change'),
			'checking the task did not update the Markdown document');
		await waitFor(async () => {
			const diskText = new TextDecoder().decode(await vscode.workspace.fs.readFile(note));
			return diskText.includes('- [x] Save this change') && !document.isDirty;
		}, 'checking the task did not automatically save the Markdown file');
	});

	test('drives native knowledge pickers and views with keyboard navigation', async () => {
		const fixture = await makeFixture('knowledge-pickers');
		const quickTarget = await service.createNote(fixture, 'Desktop Picker Target');
		const searchTarget = await service.createNote(fixture, 'Desktop Search Target');
		const knowledgeTarget = await service.createNote(fixture, 'Desktop Knowledge Target');
		const linkedSource = await service.createNote(fixture, 'Desktop Linked Source');
		const unlinkedSource = await service.createNote(fixture, 'Desktop Unlinked Source');
		const taggedSource = await service.createNote(fixture, 'Desktop Tagged Source');
		const quickRelative = service.rootUri.fsPath === fixture.fsPath
			? 'Desktop Picker Target.md'
			: `${fixture.fsPath.slice(service.rootUri.fsPath.length + 1).replace(/\\/g, '/')}/Desktop Picker Target.md`;
		const searchRelative = service.rootUri.fsPath === fixture.fsPath
			? 'Desktop Search Target.md'
			: `${fixture.fsPath.slice(service.rootUri.fsPath.length + 1).replace(/\\/g, '/')}/Desktop Search Target.md`;
		const knowledgeRelative = service.rootUri.fsPath === fixture.fsPath
			? 'Desktop Knowledge Target.md'
			: `${fixture.fsPath.slice(service.rootUri.fsPath.length + 1).replace(/\\/g, '/')}/Desktop Knowledge Target.md`;
		const linkedRelative = service.rootUri.fsPath === fixture.fsPath
			? 'Desktop Linked Source.md'
			: `${fixture.fsPath.slice(service.rootUri.fsPath.length + 1).replace(/\\/g, '/')}/Desktop Linked Source.md`;
		const unlinkedRelative = service.rootUri.fsPath === fixture.fsPath
			? 'Desktop Unlinked Source.md'
			: `${fixture.fsPath.slice(service.rootUri.fsPath.length + 1).replace(/\\/g, '/')}/Desktop Unlinked Source.md`;
		const taggedRelative = service.rootUri.fsPath === fixture.fsPath
			? 'Desktop Tagged Source.md'
			: `${fixture.fsPath.slice(service.rootUri.fsPath.length + 1).replace(/\\/g, '/')}/Desktop Tagged Source.md`;
		const searchPhrase = `desktop-copper-${Date.now()}`;
		const tagRoot = `desktop-evidence-${Date.now()}`;
		await vscode.workspace.fs.writeFile(quickTarget, bytes([
			'---',
			'aliases: [Desktop Picker Alias]',
			'---',
			'# Quick target',
		].join('\n')));
		await vscode.workspace.fs.writeFile(searchTarget, bytes([
			'# Search target',
			'',
			...Array.from({ length: 24 }, (_, index) => `Search filler ${index + 1}`),
			searchPhrase,
			'',
		].join('\n')));
		await vscode.workspace.fs.writeFile(knowledgeTarget, bytes('# Desktop knowledge target\n'));
		await vscode.workspace.fs.writeFile(linkedSource, bytes('A linked mention: [[Desktop Knowledge Target]].\n'));
		await vscode.workspace.fs.writeFile(unlinkedSource, bytes('An unlinked Desktop Knowledge Target mention.\n'));
		await vscode.workspace.fs.writeFile(taggedSource, bytes([
			'---',
			`tags: [${tagRoot}/nested]`,
			'---',
			'# Desktop tagged source',
		].join('\n')));
		await waitFor(() => {
			const paths = api.getVaultIndexRecords().map((record) => record.path);
			return [quickRelative, searchRelative, knowledgeRelative, linkedRelative, unlinkedRelative, taggedRelative]
				.every((path) => paths.includes(path));
		}, 'knowledge-picker notes did not reach the local index');

		const page = await getWorkbenchPage();
		await page.bringToFront();
		await vscode.commands.executeCommand('mdLivePreview.quickSwitcher');
		await chooseNativeQuickPick(page, 'Desktop Picker Target', 'Desktop Picker Target', 'Desktop Picker Alias');
		await waitFor(() => activeTabUri()?.toString() === quickTarget.toString(),
			'Quick Switcher keyboard acceptance did not open the aliased note');

		const editorConfiguration = vscode.workspace.getConfiguration('mdLivePreview');
		const priorGlobalEditor = editorConfiguration.inspect<string>('defaultEditor')?.globalValue;
		await editorConfiguration.update('defaultEditor', 'livePreview', vscode.ConfigurationTarget.Global);
		try {
			await vscode.commands.executeCommand('mdLivePreview.vaultSearch');
			await chooseNativeQuickPick(page, searchPhrase, 'Desktop Search Target');
			await waitFor(() => {
				const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
				return input instanceof vscode.TabInputCustom
					&& input.viewType === 'mdLivePreview.editor'
					&& input.uri.toString() === searchTarget.toString();
			}, 'vault-search keyboard acceptance did not open the body-text result in Live Preview');
			const searchFrame = await connectToLivePreviewFrame(searchPhrase);
			await waitFor(() => searchFrame.evaluate((phrase) => {
				const anchor = window.getSelection()?.anchorNode;
				const parent = anchor instanceof Element ? anchor : anchor?.parentElement;
				return parent?.closest('.cm-line')?.textContent?.includes(phrase) === true;
			}, searchPhrase), 'vault-search navigation did not place the caret on the matching Live Preview line');
		} finally {
			await editorConfiguration.update('defaultEditor', priorGlobalEditor, vscode.ConfigurationTarget.Global);
		}

		await vscode.commands.executeCommand('mdLivePreview.quickSwitcher');
		await observeAndCancelNativeQuickPick(page, 'Desktop Search Target');

		const knowledgeDocument = await vscode.workspace.openTextDocument(knowledgeTarget);
		await vscode.window.showTextDocument(knowledgeDocument);
		await vscode.commands.executeCommand('mdLivePreview.backlinks.focus');
		const linkedRow = page.getByRole('treeitem', {
			name: /^Linked mention in .*Desktop Linked Source\.md, line 1$/,
		});
		const unlinkedRow = page.getByRole('treeitem', {
			name: /^Unlinked mention in .*Desktop Unlinked Source\.md, line 1$/,
		});
		await linkedRow.waitFor({ state: 'visible', timeout: 5_000 });
		await unlinkedRow.waitFor({ state: 'visible', timeout: 5_000 });
		assert.match(await unlinkedRow.innerText(), /unlinked mention/i,
			'the native Backlinks view did not distinguish the unlinked mention');
		await linkedRow.click();
		await waitFor(() => activeTabUri()?.toString() === linkedSource.toString(),
			'Backlinks source activation did not open the linked note');

		await vscode.commands.executeCommand('mdLivePreview.tags.focus');
		const tagRow = visibleWorkbenchRow(page, `#${tagRoot}`);
		await tagRow.waitFor({ state: 'visible', timeout: 5_000 });
		await tagRow.click();
		await assertNativeQuickPickQuery(page, `tag:${tagRoot}`, 'Desktop Tagged Source');
	});

	test('keeps relative links, local attachments, split editors, and external edits compatible', async () => {
		const fixture = await makeFixture('compatibility');
		const source = await service.createNote(fixture, 'Compatibility Source');
		const target = await service.createNote(fixture, 'Relative Target');
		const image = vscode.Uri.joinPath(fixture, 'pixel.png');
		const marker = `split-external-${Date.now()}`;
		const initial = [
			'# Compatibility source',
			'',
			'[Open relative target](Relative%20Target.md)',
			'',
			'![local attachment](pixel.png)',
			'',
		].join('\n');
		await vscode.workspace.fs.writeFile(target, bytes('# Relative target\n'));
		await vscode.workspace.fs.writeFile(image, Uint8Array.from(Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
			'base64',
		)));
		await vscode.workspace.fs.writeFile(source, bytes(initial));
		await vscode.commands.executeCommand('vscode.openWith', source, 'mdLivePreview.editor');
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
		let frame = await connectToLivePreviewFrame('Compatibility source');
		const editorConfiguration = vscode.workspace.getConfiguration('mdLivePreview');
		const priorGlobalEditor = editorConfiguration.inspect<string>('defaultEditor')?.globalValue;
		try {
			await editorConfiguration.update('defaultEditor', 'livePreview', vscode.ConfigurationTarget.Global);
			const localImage = frame.locator('.mlp-image');
			await waitFor(async () => (await localImage.getAttribute('src'))?.startsWith('blob:') === true,
				'validated local attachment bytes did not reach Live Preview');
			await frame.locator('.cm-content').click();
			await frame.page().keyboard.press('ControlOrMeta+Home');
			const relativeLink = frame.locator('.mlp-link[data-href="Relative%20Target.md"]');
			await relativeLink.waitFor({ state: 'visible', timeout: 5_000 });
			await relativeLink.click();
			await waitFor(() => {
				const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
				return input instanceof vscode.TabInputCustom
					&& input.viewType === 'mdLivePreview.editor'
					&& input.uri.toString() === target.toString();
			}, 'relative Markdown link did not honor the configured Live Preview editor');
		} finally {
			await editorConfiguration.update('defaultEditor', priorGlobalEditor, vscode.ConfigurationTarget.Global);
		}

		await vscode.commands.executeCommand('vscode.openWith', source, 'mdLivePreview.editor');
		await vscode.commands.executeCommand('workbench.action.splitEditorRight');
		await waitFor(() => vscode.window.tabGroups.all.filter((group) => group.tabs.some((tab) => {
			const input = tab.input;
			return input instanceof vscode.TabInputCustom
				&& input.viewType === 'mdLivePreview.editor'
				&& input.uri.toString() === source.toString();
		})).length === 2, 'Live Preview did not open in two split editor groups');
		await waitFor(async () => (await livePreviewFrames('Compatibility source')).length === 2,
			'the split Live Preview webviews did not both mount');

		const external = `${initial}\n${marker}\n`;
		await vscode.workspace.fs.writeFile(source, bytes(external));
		await waitFor(async () => {
			const frames = await livePreviewFrames('Compatibility source');
			if (frames.length !== 2) return false;
			return (await Promise.all(frames.map(async (candidate) =>
				(await candidate.locator('.cm-content').textContent())?.includes(marker) === true))).every(Boolean);
		}, 'external file replacement did not converge in both split Live Preview panes', 10_000);
		frame = await connectToLivePreviewFrame(marker);
		assert.ok((await frame.locator('.cm-content').textContent())?.includes(marker));
	});

	test('opens hostile Markdown without script execution, active unsafe URLs, or remote requests', async () => {
		const fixture = await makeFixture('hostile');
		const note = await service.createNote(fixture, 'Hostile Live Preview');
		const sentinelHost = 'mdlp-security.invalid';
		const sentinel = `host-probe-${Date.now()}`;
		const outsideName = `.mdlp-outside-${Date.now()}.md`;
		const outsideParent = vscode.Uri.joinPath(service.rootUri, '..');
		const outsideUri = vscode.Uri.joinPath(outsideParent, outsideName);
		const outsideSecret = `outside-secret-${randomUUID()}`;
		await vscode.workspace.fs.writeFile(outsideUri, bytes(outsideSecret));
		const outsideEntriesBefore = await entryNames(outsideParent);
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
			`![outside file URI](${outsideUri.toString()})`,
			`![[../../${outsideName}]]`,
			`[encoded outside](..%2F..%2F${encodeURIComponent(outsideName)})`,
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
				await frame.locator('[src^="file:"], [href^="file:"]').count(),
				0,
				'an outside-vault file URI remained active in the real webview',
			);
			assert.strictEqual(
				await frame.locator(`[src*="${sentinelHost}"], [href*="${sentinelHost}"]`).count(),
				0,
				'default-blocked remote media retained an active network URL',
			);
			assert.ok(
				!(await frame.locator('body').textContent())?.includes(outsideSecret),
				'opening hostile Markdown disclosed outside-vault file contents',
			);
			assert.strictEqual(
				new TextDecoder().decode(await vscode.workspace.fs.readFile(outsideUri)),
				outsideSecret,
				'opening hostile Markdown modified an outside-vault canary',
			);
			assert.deepStrictEqual(
				await entryNames(outsideParent),
				outsideEntriesBefore,
				'opening hostile Markdown created or removed an adjacent outside-vault entry',
			);
			assert.deepStrictEqual(sentinelRequests, [], 'opening hostile Markdown emitted a remote sentinel request');
		} finally {
			page.off('request', recordRequest);
			await vscode.workspace.fs.delete(outsideUri, { useTrash: false });
		}
	});

	test('opens the checked-in malicious Markdown corpus without code, network, command, or vault escape', async () => {
		const fixture = await makeFixture('security-corpus');
		const outsideName = `.mdlp-corpus-outside-${Date.now()}.md`;
		const outsideParent = vscode.Uri.joinPath(service.rootUri, '..');
		const outsideUri = vscode.Uri.joinPath(outsideParent, outsideName);
		const outsideSecret = `corpus-outside-secret-${randomUUID()}`;
		await vscode.workspace.fs.writeFile(outsideUri, bytes(outsideSecret));
		const outsideEntriesBefore = await entryNames(outsideParent);
		const page = await getWorkbenchPage();
		const hostileRequests: string[] = [];
		const hostileHosts = ['network.invalid', 'evil.invalid', 'tracker.invalid', 'safe.invalid'];
		const recordRequest = (request: { url(): string }) => {
			if (hostileHosts.some((host) => request.url().includes(host))) hostileRequests.push(request.url());
		};
		page.on('request', recordRequest);
		try {
			for (const [index, entry] of SECURITY_CORPUS.entries()) {
				const corpusUri = vscode.Uri.joinPath(extensionUri, 'test', 'security-corpus', entry.file);
				let source = new TextDecoder().decode(await vscode.workspace.fs.readFile(corpusUri));
				if ('repeatText' in entry) source += `\n${entry.repeatText.repeat(entry.repeatCount)}\n`;
				source += `\n![outside file URI](${outsideUri.toString()})\n![[../../${outsideName}]]\n`;
				const note = await service.createNote(fixture, `Corpus ${index + 1}`);
				await vscode.workspace.fs.writeFile(note, bytes(source));
				await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
				await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
				const frame = await connectToLivePreviewFrame(entry.visibleText);
				await new Promise((resolve) => setTimeout(resolve, 300));

				assert.ok((await frame.locator('.cm-content').textContent())?.includes(entry.visibleText),
					`${entry.file} did not remain visible and editable`);
				assert.strictEqual(await frame.locator([
					'.cm-content script', '.cm-content iframe', '.cm-content object', '.cm-content embed',
					'.cm-content form', '.cm-content foreignObject', '.mlp-mermaid-wrap script',
					'.mlp-mermaid-wrap foreignObject', '.mlp-drawio-wrap script', '.mlp-drawio-wrap foreignObject',
				].join(', ')).count(), 0, `${entry.file} created active hostile DOM`);
				assert.deepStrictEqual(await frame.evaluate(() => ({
					script: (window as unknown as { __markdownScriptRan?: boolean }).__markdownScriptRan,
					handler: (window as unknown as { __markdownHandlerRan?: boolean }).__markdownHandlerRan,
				})), { script: undefined, handler: undefined }, `${entry.file} executed hostile Markdown code`);
				const activeUnsafeUrls = await frame.locator('[href], [src], [action]').evaluateAll((elements, blockedHosts) => elements
					.flatMap((element) => ['href', 'src', 'action'].map((name) => element.getAttribute(name) ?? ''))
					.filter((value) => /^(?:javascript|command|data|file):/i.test(value)
						|| blockedHosts.some((host) => value.includes(host))), hostileHosts);
				assert.deepStrictEqual(activeUnsafeUrls, [], `${entry.file} retained an active hostile URL`);
				assert.ok(!(await frame.locator('body').textContent())?.includes(outsideSecret),
					`${entry.file} disclosed outside-vault file contents`);
			}

			assert.strictEqual(page.isClosed(), false, 'the corpus command URL closed the VS Code workbench');
			assert.deepStrictEqual(hostileRequests, [], 'the checked-in corpus emitted an unsolicited network request');
			assert.strictEqual(new TextDecoder().decode(await vscode.workspace.fs.readFile(outsideUri)), outsideSecret,
				'the checked-in corpus modified an outside-vault canary');
			assert.deepStrictEqual(await entryNames(outsideParent), outsideEntriesBefore,
				'the checked-in corpus created or removed an adjacent outside-vault entry');
		} finally {
			page.off('request', recordRequest);
			await vscode.workspace.fs.delete(outsideUri, { useTrash: false });
		}
	});

	test('allows HTTPS media only through an explicit workspace opt-in and revokes it live', async () => {
		const fixture = await makeFixture('remote-media');
		const note = await service.createNote(fixture, 'Remote Media Policy');
		const visibleText = 'Remote media policy';
		const marker = `remote-opt-in-${Date.now()}`;
		const remoteUrl = `https://mdlp-opt-in.invalid/${marker}.png`;
		await vscode.workspace.fs.writeFile(note, bytes(`# ${visibleText}\n\n![${marker}](${remoteUrl})\n`));
		const settingsUri = vscode.Uri.joinPath(service.rootUri, '.vscode', 'settings.json');
		const originalSettings = await vscode.workspace.fs.readFile(settingsUri);
		const configuration = vscode.workspace.getConfiguration('mdLivePreview', note);
		assert.strictEqual(configuration.inspect('remoteMedia')?.workspaceValue, undefined,
			'the focused fixture must begin without a remote-media workspace opt-in');

		const page = await getWorkbenchPage();
		const requests: string[] = [];
		const routePattern = 'https://mdlp-opt-in.invalid/**';
		await page.route(routePattern, async (route) => {
			requests.push(route.request().url());
			await route.abort();
		});
		try {
			await configuration.update('remoteMedia', 'https', vscode.ConfigurationTarget.Workspace);
			await waitFor(() => vscode.workspace.getConfiguration('mdLivePreview', note)
				.inspect('remoteMedia')?.workspaceValue === 'https', 'workspace HTTPS opt-in did not apply');
			await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
			await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
			let frame = await connectToLivePreviewFrame(visibleText);
			await waitFor(async () => requests.includes(remoteUrl), 'workspace HTTPS opt-in did not emit the expected image request');
			assert.strictEqual(await frame.locator(`img[src="${remoteUrl}"]`).count(), 1,
				'workspace HTTPS opt-in did not produce the expected remote image');

			await configuration.update('remoteMedia', undefined, vscode.ConfigurationTarget.Workspace);
			await waitFor(() => vscode.workspace.getConfiguration('mdLivePreview', note)
				.inspect('remoteMedia')?.workspaceValue === undefined, 'workspace HTTPS opt-in did not revoke');
			await waitFor(async () => {
				try {
					frame = await connectToLivePreviewFrame(visibleText);
					return await frame.locator(`img[src="${remoteUrl}"]`).count() === 0
						&& await frame.locator('.mlp-image-blocked').count() > 0;
				} catch {
					return false;
				}
			}, 'revoking the workspace opt-in did not restore the blocked-media fallback', 10_000);
		} finally {
			await page.unroute(routePattern);
			if (vscode.workspace.getConfiguration('mdLivePreview', note).inspect('remoteMedia')?.workspaceValue !== undefined) {
				await configuration.update('remoteMedia', undefined, vscode.ConfigurationTarget.Workspace);
			}
			await vscode.workspace.fs.writeFile(settingsUri, originalSettings);
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

async function connectToLivePreviewFrame(expectedText?: string): Promise<Frame> {
	const browser = await connectToDebugBrowser();
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		for (const context of browser.contexts()) {
			for (const page of context.pages()) {
				for (const frame of page.frames()) {
					if (frame.isDetached()) continue;
					const editor = frame.locator('.cm-content');
					if (await editor.count() === 0) continue;
					if (!expectedText || (await editor.textContent())?.includes(expectedText)) return frame;
				}
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	assert.fail('could not find the active Live Preview CodeMirror frame');
}

async function livePreviewFrames(expectedText: string): Promise<Frame[]> {
	const browser = await connectToDebugBrowser();
	const matches: Frame[] = [];
	for (const context of browser.contexts()) {
		for (const page of context.pages()) {
			for (const frame of page.frames()) {
				if (frame.isDetached()) continue;
				const editor = frame.locator('.cm-content');
				if (await editor.count() > 0 && (await editor.textContent())?.includes(expectedText)) matches.push(frame);
			}
		}
	}
	return matches;
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
	return (await vscode.workspace.fs.readDirectory(directory)).map(([name]) => name).sort();
}

function activeTabUri(): vscode.Uri | undefined {
	const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
	return input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri : undefined;
}

function visibleWorkbenchRow(page: Page, text: string) {
	return page.locator('.monaco-list-row:visible').filter({ hasText: text });
}

async function observeAndCancelNativeQuickPick(page: Page, expectedItemText: string): Promise<void> {
	const widget = page.locator('.quick-input-widget:visible');
	await widget.waitFor({ state: 'visible', timeout: 5_000 });
	await widget.locator('.monaco-list-row').filter({ hasText: expectedItemText })
		.waitFor({ state: 'visible', timeout: 5_000 });
	await widget.locator('.quick-input-box input').press('Escape');
	await widget.waitFor({ state: 'hidden', timeout: 5_000 });
}

async function assertNativeQuickPickQuery(page: Page, query: string, expectedItemText: string): Promise<void> {
	const widget = page.locator('.quick-input-widget:visible');
	await widget.waitFor({ state: 'visible', timeout: 5_000 });
	const input = widget.locator('.quick-input-box input');
	await waitFor(async () => await input.inputValue() === query,
		`native picker query did not equal ${query}`);
	await widget.locator('.monaco-list-row').filter({ hasText: expectedItemText })
		.waitFor({ state: 'visible', timeout: 5_000 });
	await input.press('Escape');
	await widget.waitFor({ state: 'hidden', timeout: 5_000 });
}

async function chooseNativeQuickPick(
	page: Page,
	query: string,
	expectedItemText: string,
	observedQuery?: string,
): Promise<void> {
	const widget = page.locator('.quick-input-widget:visible');
	await widget.waitFor({ state: 'visible', timeout: 5_000 });
	const input = widget.locator('.quick-input-box input');
	if (observedQuery) {
		await input.fill(observedQuery);
		await widget.locator('.monaco-list-row').filter({ hasText: expectedItemText })
			.waitFor({ state: 'visible', timeout: 5_000 });
	}
	await input.fill(query);
	const item = widget.locator('.monaco-list-row').filter({ hasText: expectedItemText });
	await item.waitFor({ state: 'visible', timeout: 5_000 });
	assert.strictEqual(await item.count(), 1, `native picker did not uniquely show ${expectedItemText}`);
	await input.press('ArrowDown');
	await widget.locator('.monaco-list-row.focused').filter({ hasText: expectedItemText })
		.waitFor({ state: 'visible', timeout: 5_000 });
	await input.press('Enter');
	await widget.waitFor({ state: 'hidden', timeout: 5_000 });
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
