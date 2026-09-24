import * as assert from 'assert';
import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser, type Frame, type Page } from 'playwright';
import { largeMixedDocument } from '../fixtures/largeMixedDocument';

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

	teardown(async function () {
		if (this.currentTest?.state === 'failed') {
			const page = await getWorkbenchPage();
			await page.screenshot({ path: `/tmp/mdlp-ui-failed-${this.currentTest.title.slice(0, 32).replace(/[^a-z0-9]/gi, '-')}.png` });
		}
		// Do not remove a fixture while VS Code still has a native save in flight.
		for (const document of vscode.workspace.textDocuments) {
			if (fixtures.some(fixture => document.uri.path.startsWith(fixture.path + '/'))) {
				try { await document.save(); } catch { /* failure diagnostics belong to the test */ }
			}
		}
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		for (const fixture of fixtures.splice(0)) {
			try { await vscode.workspace.fs.delete(fixture, { recursive: true }); } catch { /* already removed */ }
		}
	});

	test('human note-taking from a blank file preserves typed structure, mouse edits, and autosave', async function () {
		this.timeout(120_000);
		const fixture = await makeFixture('human-notes');
		const note = await service.createNote(fixture, 'Planning session');
		await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
		const frame = await connectToLivePreviewFrame();
		const keyboard = frame.page().keyboard;
		const assertTypingFocus = async () => {
			const state = await frame.evaluate(() => {
				const content = document.querySelector<HTMLElement>('.cm-content');
				return {
					editable: content?.isContentEditable,
					focused: document.hasFocus() && document.activeElement === content,
					active: document.activeElement?.outerHTML.slice(0, 500),
					mode: document.querySelector('.mlp-editing-mode-toggle')?.getAttribute('aria-label'),
				};
			});
			assert.ok(state.editable && state.focused, `typing requires an editable, focused CodeMirror: ${JSON.stringify(state)}`);
		};
		const type = async (text: string) => {
			await assertTypingFocus();
			await keyboard.type(text, { delay: 8 });
		};
		const enter = async (count = 1) => { for (let i = 0; i < count; i++) await keyboard.press('Enter'); };
		const disk = async () => Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8');
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
		await frame.locator('.cm-content').click();
		await assertTypingFocus();
		await type('# Planning session');
		await enter(2);
		await type('Today we review **delivery**, *risks*, and ==decisions==. Budget: $15-$25.');
		await enter(2);
		await type('## Agenda');
		await enter();
		await type('- Release checklist');
		await enter();
		await keyboard.press('Tab');
		await type('Review the draft');
		await enter();
		await type('Check accessibility');
		await keyboard.press('Shift+Tab');
		await enter(2);
		await type('## Actions');
		await enter();
		await type('- [ ] Confirm the schedule');
		await enter();
		await type('Notify reviewers');
		await enter(2);
		await type('## Risks');
		await enter();
		await type('> [!warning]+ Release risk');
		await enter();
		await type('Keep the backup local.');
		await enter(2);
		await type('## Example');
		await enter();
		await type('```python');
		await enter();
		await type('print("ready")');
		await enter(2);
		await type('Final decision: ship after review.');
		await waitFor(async () => (await disk()).endsWith('Final decision: ship after review.'), 'typed note did not save').catch(async error => {
			await frame.page().screenshot({ path: '/tmp/mdlp-human-notes-failure.png' });
			throw new Error(`${String(error)}; disk=${JSON.stringify(await disk())}; rendered=${await frame.locator('.cm-content').innerText()}`);
		});
		const source = await disk();
		assert.match(source, /- Release checklist\n  - Review the draft\n- Check accessibility/);
		assert.match(source, /- \[ \] Confirm the schedule\n- \[ \] Notify reviewers/);
		assert.match(source, /> \[!warning\]\+ Release risk\n> Keep the backup local\.\n\n## Example/);
		assert.match(source, /```python\nprint\("ready"\)\n+```\n+Final decision/);
		assert.ok(!(await frame.locator('.cm-content').innerText()).includes('Invalid math'));
		const outline = await connectToFrameWith('#mlp-outline-root');
		await waitFor(async () => await outline.getByRole('button', { name: 'Planning session', exact: true }).count() === 1, 'typed headings did not appear in the outline');
		// Return to the tasks through the real Find UI rather than changing selection in code.
		await keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
		await frame.locator('.cm-search input[name="search"]').fill('Confirm the schedule');
		await keyboard.press('Enter');
		await keyboard.press('Escape');
		await frame.locator('.mlp-checkbox').first().click();
		await waitFor(async () => (await disk()).includes('- [x] Confirm the schedule'), 'mouse checkbox change did not save');
		await frame.getByRole('button', { name: 'Release risk callout', exact: true }).click();
		assert.strictEqual(await frame.getByRole('button', { name: 'Release risk callout', exact: true }).getAttribute('aria-expanded'), 'false');
		await frame.getByRole('button', { name: 'Release risk callout', exact: true }).click();
		const previousClipboard = await vscode.env.clipboard.readText();
		try {
			await frame.getByRole('button', { name: 'Copy code block', exact: true }).click();
			const code = /```python\n([\s\S]*?)\n```/.exec(source)![1];
			await waitFor(async () => await vscode.env.clipboard.readText() === code, 'typed code block did not copy exactly');
		} finally { await vscode.env.clipboard.writeText(previousClipboard); }
		await frame.page().screenshot({ path: '/tmp/mdlp-human-notes-qa.png' });
	});

	test('types a research note with properties, tables, math, footnotes, and diagrams then edits the objects', async function () {
		this.timeout(120_000);
		const fixture = await makeFixture('typed-research');
		const note = await service.createNote(fixture, 'Research notebook');
		await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
		const frame = await connectToLivePreviewFrame();
		const keyboard = frame.page().keyboard;
		const type = (text: string) => keyboard.type(text, { delay: 5 });
		const line = async (text = '') => { await type(text); await keyboard.press('Enter'); };
		const disk = async () => Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8');
		const find = async (text: string) => {
			await keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
			await frame.locator('.cm-search input[name="search"]').fill(text);
			await keyboard.press('Enter'); await keyboard.press('Escape');
		};
		await frame.locator('.cm-content').click();
		for (const text of ['---', 'status: draft', 'priority: 2', 'approved: false', '---', '', '# Research notebook', '', 'A local experiment with $x^2 + y^2$ and a reference[^method].', '', '## Measurements', '| Equipment | Cost |', '| --- | ---: |', '| Sensor | $25 |', '| Cable | $5 |', '', '## Workflow', '```mermaid', 'flowchart LR', 'A[Collect] --> B[Review]']) await line(text);
		await keyboard.press('Enter'); // Leave the code block on its final empty line.
		await line();
		await line('## Architecture');
		await line('```drawio');
		await line('<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Local data" vertex="1" parent="1"><mxGeometry x="0" y="0" width="160" height="60" as="geometry"/></mxCell></root></mxGraphModel>');
		await keyboard.press('Enter');
		await line();
		await line('## Method');
		await line('[^method]: Keep the source files locally.');
		await line();
		await type('End of research.');
		await waitFor(async () => (await disk()).endsWith('End of research.'), 'typed research did not reach disk').catch(async error => {
			throw new Error(`${String(error)}; disk=${JSON.stringify(await disk())}; rendered=${await frame.locator('.cm-content').innerText()}`);
		});
		assert.match(await disk(), /\| Sensor \| \$25 \|/);
		await find('## Architecture');
		await frame.locator('.mlp-drawio-wrap svg').waitFor({ state: 'visible', timeout: 10000 });
		assert.ok((await frame.locator('.mlp-drawio-wrap svg').textContent())?.includes('Local data'));
		await find('## Workflow');
		await frame.locator('.mlp-mermaid-wrap:not(.mlp-drawio-wrap) svg').waitFor({ state: 'visible', timeout: 10000 });
		assert.ok((await frame.locator('.mlp-mermaid-wrap:not(.mlp-drawio-wrap) svg').textContent())?.includes('Collect'));
		await find('# Research notebook');
		await frame.locator('.mlp-math math').waitFor({ state: 'visible' });
		await frame.getByRole('button', { name: 'Edit priority', exact: true }).dblclick();
		await frame.getByRole('textbox', { name: 'Edit priority', exact: true }).fill('4');
		await keyboard.press('Enter');
		await waitFor(async () => (await disk()).includes('priority: 4'), 'property editor did not save');
		await find('## Measurements');
		const cell = frame.locator('.mlp-table td').first();
		await cell.focus(); await keyboard.press('F2');
		await type('**Calibrated sensor**<br>Local only');
		await keyboard.press('Enter');
		await waitFor(async () => (await disk()).includes('**Calibrated sensor**<br>Local only'), 'rich table edit did not save');
		assert.strictEqual(await frame.locator('.mlp-table td').first().locator('br').count(), 1);
		await frame.getByRole('button', { name: 'Table options', exact: true }).click();
		await frame.getByRole('button', { name: 'Add a row', exact: true }).click();
		await waitFor(async () => await frame.locator('.mlp-table tbody tr').count() === 3, 'typed table could not add a row');
		await frame.page().screenshot({ path: '/tmp/mdlp-typed-research-qa.png' });
	});

	test('typed multi-line bullets keep wrapped text aligned in the native editor', async function () {
		this.timeout(120_000);
		const fixture = await makeFixture('wrapped-bullets');
		const note = await service.createNote(fixture, 'Wrapped bullets');
		await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
		const frame = await connectToLivePreviewFrame();
		const keyboard = frame.page().keyboard;
		await frame.locator('.cm-content').click();
		await keyboard.type('# Release review', { delay: 8 });
		await keyboard.press('Enter');
		await keyboard.press('Enter');
		await keyboard.type('- Review the release checklist and record the remaining accessibility, security, and documentation questions before approving the build. Keep the supporting evidence beside each decision so another reviewer can reproduce the result without relying on a separate conversation.', { delay: 5 });
		await keyboard.press('Enter');
		await keyboard.press('Tab');
		await keyboard.type('Confirm that the installation instructions match the packaged extension, test the keyboard shortcuts, and verify that every edited note has reached disk before switching to the next file. Document any differences observed while using a narrow editor window.', { delay: 5 });
		await keyboard.press(process.platform === 'darwin' ? 'Meta+Home' : 'Control+Home');
		const disk = async () => Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8');
		await waitFor(async () => (await disk()).endsWith('narrow editor window.'), 'typed bullets did not save');
		const original = await disk();
		assert.match(original, /\n  - Confirm/);
		const rows = frame.locator('.cm-line[data-mlp-list-text-offset]');
		await waitFor(async () => await rows.count() === 2, 'both bullet prefixes were not rendered');
		for (const row of await rows.all()) {
			await waitFor(async () => row.evaluate(element => {
				const edges = new Map<number, number>();
				const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
				let node: Node | null;
				while ((node = walker.nextNode())) for (const word of node.textContent!.matchAll(/[A-Za-z]+/g)) {
					const range = document.createRange();
					range.setStart(node, word.index!); range.setEnd(node, word.index! + 1);
					const rect = range.getBoundingClientRect();
					const top = Math.round(rect.top);
					edges.set(top, Math.min(edges.get(top) ?? Infinity, rect.left));
				}
				return edges.size > 1 && Math.max(...edges.values()) - Math.min(...edges.values()) < 1.5;
			}), 'wrapped words did not line up with the first word');
		}
		assert.strictEqual(await disk(), original, 'hanging indentation must not rewrite the Markdown');
		await frame.page().screenshot({ path: '/tmp/mdlp-wrapped-bullets-native.png' });
	});

	test('all sidebar setting options persist through the actual host and workspace overrides', async function () {
		this.timeout(120_000);
		await vscode.commands.executeCommand('mdLivePreview.styleManager.focus');
		const frame = await connectToFrameWith('#mlp-sidebar-root');
		const config = vscode.workspace.getConfiguration('mdLivePreview');
		const keys = ['showWhitespace', 'defaultEditor', 'vault.openBehavior', 'defaultEditingMode', 'codeTheme'];
		const originals = keys.map(key => config.inspect(key)?.globalValue);
		const originalWorkspace = config.inspect('showWhitespace')?.workspaceValue;
		try {
			for (const [index, key] of keys.entries()) {
				const control = frame.locator('select').nth(index);
				const values = await control.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
				for (const value of values) {
					await control.selectOption(value);
					await waitFor(() => vscode.workspace.getConfiguration('mdLivePreview').get(key) === value, `${key}=${value} did not persist`);
					await waitFor(async () => await control.inputValue() === value, `${key} reset after host confirmation`);
				}
			}
			// A workspace override must not make the visible control silently ineffective.
			await config.update('showWhitespace', 'on', vscode.ConfigurationTarget.Workspace);
			await waitFor(async () => await frame.locator('select').first().inputValue() === 'on', 'workspace setting did not appear');
			await frame.locator('select').first().selectOption('off');
			await waitFor(() => vscode.workspace.getConfiguration('mdLivePreview').get('showWhitespace') === 'off', 'sidebar cannot change a workspace-overridden setting');
		} finally {
			await config.update('showWhitespace', originalWorkspace, vscode.ConfigurationTarget.Workspace);
			for (const [index, key] of keys.entries()) await config.update(key, originals[index], vscode.ConfigurationTarget.Global);
		}
	});

	test('vault context menus create, rename, copy paths, and move through the UI', async function () {
		this.timeout(120_000);
		const fixture = await makeFixture('menus');
		const rootPath = fixture.path.slice(service.rootUri.path.length + 1);
		await vscode.commands.executeCommand('mdLivePreview.vault.focus');
		const page = await getWorkbenchPage();
		await expandOnlySidebarPane(page, 'Document Vault');
		await delay(300); // Let initial fixture watcher events settle before opening its context menu.
		const row = (label: string) => page.getByRole('treeitem', { name: label, exact: true });
		const menu = async (label: string, action: string) => {
			await row(label).click({ button: 'right' });
			await delay(250); // A human waits for the context-menu opening gesture to finish.
			await page.getByRole('menuitem').filter({ hasText: action }).click({ timeout: 5000 });
		};
		const input = async (value: string) => {
			const box = page.locator('.quick-input-widget:visible .quick-input-box input');
			await box.fill(value, { timeout: 5000 }).catch(async error => {
				await page.screenshot({ path: '/tmp/mdlp-vault-menu-failure.png' });
				throw new Error(`${String(error)}; notifications=${await page.locator('.notifications-toasts').innerText()}`);
			});
			await box.press('Enter');
			await page.locator('.quick-input-widget').waitFor({ state: 'hidden' });
		};
		await menu(`Folder: ${rootPath}`, 'New Folder');
		await input('Review drafts');
		const folder = vscode.Uri.joinPath(fixture, 'Review drafts');
		await waitFor(() => exists(folder), 'New Folder menu failed');
		if (await row(`Folder: ${rootPath}`).getAttribute('aria-expanded') !== 'true') {
			await row(`Folder: ${rootPath}`).click();
			await page.keyboard.press('ArrowRight');
		}
		await menu(`Folder: ${rootPath}/Review drafts`, 'New Note');
		await input('Meeting');
		const note = vscode.Uri.joinPath(folder, 'Meeting.md');
		await waitFor(() => exists(note), 'New Note menu failed');
		await vscode.commands.executeCommand('mdLivePreview.vault.focus');
		if (await row(`Folder: ${rootPath}/Review drafts`).getAttribute('aria-expanded') !== 'true') {
			await row(`Folder: ${rootPath}/Review drafts`).click();
			await page.keyboard.press('ArrowRight');
		}
		await menu(`File: ${rootPath}/Review drafts/Meeting.md`, 'Rename Vault Item');
		await input('Meeting reviewed.md');
		const renamed = vscode.Uri.joinPath(folder, 'Meeting reviewed.md');
		await waitFor(() => exists(renamed), 'Rename menu failed');
		assert.strictEqual(await exists(note), false);
		const oldClipboard = await vscode.env.clipboard.readText();
		try {
			for (const [label, uri] of [[`Folder: ${rootPath}/Review drafts`, folder], [`File: ${rootPath}/Review drafts/Meeting reviewed.md`, renamed]] as const) {
				await menu(label, 'Copy Absolute Path');
				await waitFor(async () => await vscode.env.clipboard.readText() === uri.fsPath, 'absolute path did not copy');
				await menu(label, 'Copy Vault-Relative Path');
				await waitFor(async () => await vscode.env.clipboard.readText() === uri.path.slice(service.rootUri.path.length + 1), 'relative path did not copy');
			}
		} finally { await vscode.env.clipboard.writeText(oldClipboard); }
		await menu(`File: ${rootPath}/Review drafts/Meeting reviewed.md`, 'Move Vault Item…');
		const picker = page.locator('.quick-input-widget:visible');
		await picker.locator('.quick-input-box input').fill(rootPath);
		await picker.locator('.monaco-list-row').filter({ hasText: rootPath }).filter({ hasNotText: 'Review drafts' }).click();
		const moved = vscode.Uri.joinPath(fixture, 'Meeting reviewed.md');
		await waitFor(() => exists(moved), 'Move menu failed');
		// VS Code's extension-test host refuses modal dialogs. Real trash cancel/
		// confirm coverage runs separately without --extensionTestsPath.
		await page.screenshot({ path: '/tmp/mdlp-vault-menu-qa.png' });
	});

	test('theme action buttons create, edit, duplicate, rename, apply, and delete disposable styles', async function () {
		this.timeout(120_000);
		await vscode.commands.executeCommand('mdLivePreview.styleManager.focus');
		await expandOnlySidebarPane(await getWorkbenchPage(), 'CSS Themes');
		const frame = await connectToFrameWith('#mlp-sidebar-root');
		const page = frame.page();
		const original = await frame.getByRole('radio', { checked: true }).getAttribute('aria-label');
		const initialCount = await frame.locator('.mlp-card').count();
		await frame.getByRole('button', { name: '+ New style', exact: true }).click();
		await waitFor(async () => await frame.locator('.mlp-card').count() === initialCount + 1, 'new CSS theme did not appear');
		const card = frame.locator('.mlp-card').filter({ has: frame.getByRole('radio', { name: 'Apply CSS theme New style.css', exact: true }) });
		await card.getByRole('button', { name: 'Edit CSS', exact: true }).click();
		await waitFor(() => vscode.window.activeTextEditor?.document.fileName.endsWith('New style.css') === true, 'Edit CSS did not open source');
		const editor = vscode.window.activeTextEditor!;
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
		await page.keyboard.type('\nh2 { color: #123456; }', { delay: 15 });
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
		await waitFor(() => editor.document.getText().includes('h2 { color: #123456; }') && !editor.document.isDirty, 'CSS edit did not save');
		await card.getByRole('button', { name: 'Duplicate', exact: true }).click();
		await waitFor(async () => await frame.locator('.mlp-card').count() === initialCount + 2, 'Duplicate did not create a theme');
		await card.getByRole('button', { name: 'Rename', exact: true }).click();
		const input = page.locator('.quick-input-widget:visible .quick-input-box input');
		await input.fill('UI review');
		await input.press('Enter');
		const renamed = frame.locator('.mlp-card').filter({ has: frame.getByRole('radio', { name: 'Apply CSS theme UI review.css', exact: true }) });
		await renamed.getByRole('radio').check();
		await waitFor(() => vscode.workspace.getConfiguration('mdLivePreview').get<string[]>('enabledStyles')?.[0] === 'UI review.css', 'Apply did not select the renamed theme');
		// Restore the original before removing only this test's two themes.
		await frame.getByRole('radio', { name: original!, exact: true }).check();
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await renamed.getByRole('button', { name: 'Delete', exact: true }).click();
		const copy = frame.locator('.mlp-card').filter({ has: frame.getByRole('radio', { name: 'Apply CSS theme New style copy.css', exact: true }) });
		await copy.getByRole('button', { name: 'Delete', exact: true }).click();
		await waitFor(async () => await frame.locator('.mlp-card').count() === initialCount, 'Delete did not remove the disposable themes');
	});

	test('large clipboard paste and external replacement keep preview and disk synchronized', async function () {
		this.timeout(120_000);
		const fixture = await makeFixture('large-paste');
		const note = await service.createNote(fixture, 'Large paste');
		await vscode.workspace.fs.writeFile(note, bytes('Start '));
		await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
		const frame = await connectToLivePreviewFrame('Start');
		await frame.locator('.cm-content').click();
		await frame.page().keyboard.press('End');
		const pasted = ('\u{1F642} local note '.repeat(100) + '\n').repeat(800);
		const previousClipboard = await vscode.env.clipboard.readText();
		try {
			await vscode.env.clipboard.writeText(pasted);
			await frame.page().keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
			await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8') === 'Start ' + pasted, 'large paste did not reach disk').catch(async error => {
				const document = await vscode.workspace.openTextDocument(note);
				const disk = Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8');
				throw new Error(`${String(error)}; expectedLength=${pasted.length + 6}; diskLength=${disk.length}; documentLength=${document.getText().length}; dirty=${document.isDirty}; diskStart=${JSON.stringify(disk.slice(0, 20))}; documentStart=${JSON.stringify(document.getText().slice(0, 20))}`);
			});
		} finally { await vscode.env.clipboard.writeText(previousClipboard); }
		await frame.page().keyboard.type('END');
		await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8').endsWith('END'), 'typing after large paste stopped saving');
		const document = await vscode.workspace.openTextDocument(note);
		const replacement = 'External replacement\n' + pasted + '\nExternal final marker';
		const edit = new vscode.WorkspaceEdit();
		edit.replace(note, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), replacement);
		assert.ok(await vscode.workspace.applyEdit(edit));
		await frame.page().keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
		await frame.page().keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
		await frame.locator('.cm-search input[name="search"]').fill('External final marker');
		await frame.page().keyboard.press('Enter');
		await frame.page().keyboard.press('Escape');
		await frame.locator('.cm-line', { hasText: 'External final marker' }).waitFor({ state: 'visible' });
		await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8') === replacement, 'external replacement did not persist');
	});

	test('emoji menu survives autosave and vault indexing until mouse acceptance', async () => {
		const fixture = await makeFixture('emoji-menu');
		const note = await service.createNote(fixture, 'Emoji');
		await vscode.workspace.fs.writeFile(note, bytes('Emoji probe: '));
		await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
		const frame = await connectToLivePreviewFrame('Emoji probe:');
		await frame.locator('.cm-content').click();
		await frame.page().keyboard.press('End');
		await frame.page().keyboard.type(':s', { delay: 150 });
		const option = frame.getByRole('option', { name: /:smile:/ });
		await option.waitFor({ state: 'visible' });
		await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8') === 'Emoji probe: :s', 'emoji query did not autosave');
		for (let i = 0; i < 10; i++) {
			await delay(300);
			assert.ok(await option.isVisible(), 'vault indexing closed the emoji menu');
		}
		await option.click();
		await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8') === 'Emoji probe: 😄', 'selected emoji did not autosave');
	});

	test('large mixed documents preserve exact disk content through native UI edits and file switches', async function () {
		this.timeout(180_000);
		const fixture = await makeFixture('large-mixed');
		for (const sections of [80, 240, 600]) {
			const note = await service.createNote(fixture, `Large ${sections}`);
			const original = largeMixedDocument(sections);
			await vscode.workspace.fs.writeFile(note, bytes(original));
			await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
			const frame = await connectToLivePreviewFrame('Large mixed QA');
			const keyboard = frame.page().keyboard;
			await frame.locator('.cm-content').click();
			await keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
			await frame.locator('.cm-search input[name="search"]').fill('Final editable paragraph.');
			await keyboard.press('Enter');
			await keyboard.press('Escape');
			await frame.locator('.cm-line', { hasText: 'Final editable paragraph.' }).waitFor({ state: 'visible' });
			const previousClipboard = await vscode.env.clipboard.readText();
			try {
				await keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c');
				await waitFor(async () => await vscode.env.clipboard.readText() === 'Final editable paragraph.', 'large-document selected text did not copy');
			} finally {
				await vscode.env.clipboard.writeText(previousClipboard);
			}
			await keyboard.press('ArrowRight');
			await keyboard.type(' Native saved edit.', { delay: 20 });
			const expected = original.replace('Final editable paragraph.', 'Final editable paragraph. Native saved edit.');
			await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8') === expected, 'large-document edit did not save exactly').catch(async error => {
				const doc = await vscode.workspace.openTextDocument(note);
				throw new Error(`${String(error)}; sections=${sections}; dirty=${doc.isDirty}; diskTail=${JSON.stringify(Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8').slice(-100))}; documentTail=${JSON.stringify(doc.getText().slice(-100))}`);
			});
			// Host undo may group rapid typing into multiple transactions.
			for (let attempt = 0; attempt < 20; attempt++) {
				const before = Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8');
				if (before === original) break;
				await keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
				await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8') !== before, 'large-document undo made no progress').catch(async error => {
					throw new Error(`${String(error)}; sections=${sections}; attempt=${attempt}; tail=${JSON.stringify(before.slice(-120))}; documentTail=${JSON.stringify((await vscode.workspace.openTextDocument(note)).getText().slice(-120))}; focus=${await frame.evaluate(() => document.activeElement?.outerHTML.slice(0, 200))}`);
				});
			}
			assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8'), original, 'undo must restore the entire file');
			await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		}
	});

	test('native vault tree mouse drag moves a file and folder and supports undo', async () => {
		const fixture = await makeFixture('drag-ui');
		const target = await service.createFolder(fixture, 'Destination');
		const folder = await service.createFolder(fixture, 'Source folder');
		await service.createNote(folder, 'Child');
		const source = await service.createNote(fixture, 'Drag note');
		const index = await service.createNote(fixture, 'Move links');
		await vscode.workspace.fs.writeFile(index, bytes('[Child](Source%20folder/Child.md)\n'));
		await vscode.commands.executeCommand('mdLivePreview.vault.focus');
		const page = await getWorkbenchPage();
		const rootPath = fixture.path.slice(service.rootUri.path.length + 1);
		const row = (label: string) => page.getByRole('treeitem', { name: label, exact: true });
		await row(`Folder: ${rootPath}`).click();
		await page.keyboard.press('ArrowRight');
		const drag = async (from: string, to: string) => {
			const source = row(from).locator('.monaco-icon-label');
			const destination = row(to).locator('.monaco-icon-label');
			const start = await source.boundingBox(), end = await destination.boundingBox();
			assert.ok(start && end);
			await page.mouse.move(start.x + 30, start.y + 10);
			await page.mouse.down();
			await page.mouse.move(start.x + 50, start.y + 10, { steps: 8 });
			await delay(300);
			await page.mouse.move(end.x + 30, end.y + 10, { steps: 20 });
			await delay(300);
			await page.mouse.up();
		};
		await drag(`File: ${rootPath}/Drag note.md`, `Folder: ${rootPath}/Destination`);
		await waitFor(async () => {
			try { await vscode.workspace.fs.stat(vscode.Uri.joinPath(target, 'Drag note.md')); return true; } catch { return false; }
		}, 'native file drag did not move the file').catch(async error => {
			throw new Error(`${error.message}; notifications=${await page.locator('.notifications-toasts').innerText()}; source=${await row(`File: ${rootPath}/Drag note.md`).evaluate(el => el.outerHTML)}`);
		});
		await assert.rejects(Promise.resolve(vscode.workspace.fs.stat(source)));
		await drag(`Folder: ${rootPath}/Source folder`, `Folder: ${rootPath}/Destination`);
		await waitFor(async () => {
			try { await vscode.workspace.fs.stat(vscode.Uri.joinPath(target, 'Source folder/Child.md')); return true; } catch { return false; }
		}, 'native folder drag did not preserve its child');
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(index));
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
		await vscode.commands.executeCommand('undo');
		await waitFor(async () => {
			try { await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, 'Child.md')); return true; } catch { return false; }
		}, 'undo did not restore the dragged folder');
	});

	test('continuous typing reaches disk before typing stops and survives switching files', async () => {
		const fixture = await makeFixture('immediate-save');
		const note = await service.createNote(fixture, 'Immediate Save');
		await vscode.workspace.fs.writeFile(note, Buffer.from('Autosave probe: '));
		await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
		const frame = await connectToLivePreviewFrame('Autosave probe:');
		await frame.locator('.cm-content').click();
		await frame.page().keyboard.press('End');
		const text = 'abcdefghijklmnopqrstuvwxyz0123456789';
		let finished = false;
		const typing = frame.page().keyboard.type(text, { delay: 70 }).then(() => { finished = true; });
		await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8').includes('abc'), 'typing never reached disk');
		assert.strictEqual(finished, false, 'autosave waited until typing stopped');
		await typing;
		const other = await service.createNote(fixture, 'Other');
		await vscode.commands.executeCommand('vscode.openWith', other, 'mdLivePreview.editor');
		await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8') === `Autosave probe: ${text}`, 'file switch lost trailing edits');
	});

	test('callout table edits and nested tasks autosave while folding preserves source', async () => {
		const fixture = await makeFixture('callout-qa');
		const note = await service.createNote(fixture, 'Callout QA');
		const initial = 'Intro\n\n> [!warning]+ Review\n> - [ ] Task\n>\n> | Name | Value |\n> | --- | --- |\n> | Alpha | Bold |\n\nAfter';
		await vscode.workspace.fs.writeFile(note, Buffer.from(initial));
		await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
		const frame = await connectToLivePreviewFrame('Review');
		const cell = frame.locator('.mlp-table td').first();
		await cell.focus();
		await frame.page().keyboard.press('F2');
		await frame.page().keyboard.type('Updated', { delay: 20 });
		await frame.page().keyboard.press('Enter');
		await frame.locator('.mlp-checkbox').click();
		const expected = initial.replace('Alpha', 'Updated').replace('[ ]', '[x]');
		try {
			await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8') === expected, 'callout table/task edits did not save correctly');
		} catch (error) {
			throw new Error(`${String(error)}; disk=${JSON.stringify(Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8'))}; document=${JSON.stringify((await vscode.workspace.openTextDocument(note)).getText())}`);
		}
		await frame.locator('.cm-line', { hasText: 'After' }).click();
		await frame.locator('.mlp-callout-header').click();
		assert.strictEqual(await frame.locator('.mlp-table').count(), 0);
		await frame.locator('.mlp-callout-header').click();
		await frame.locator('.mlp-table').waitFor({ state: 'visible' });
		assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8'), expected);
	});

	test('list Tab and Shift+Tab update nesting and autosave without extra blank lines', async () => {
		const fixture = await makeFixture('list-qa');
		const note = await service.createNote(fixture, 'List QA');
		const initial = '# Heading\n- Parent\n- Child';
		await vscode.workspace.fs.writeFile(note, Buffer.from(initial));
		await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
		const frame = await connectToLivePreviewFrame('Parent');
		await frame.locator('.cm-line', { hasText: 'Child' }).click();
		await frame.page().keyboard.press('Tab');
		await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8') === '# Heading\n- Parent\n  - Child', 'Tab did not nest and save the bullet');
		await frame.page().keyboard.press('End');
		await frame.page().keyboard.press('Enter');
		await frame.page().keyboard.press('Shift+Tab');
		await frame.page().keyboard.type('Sibling', { delay: 20 });
		await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8') === '# Heading\n- Parent\n  - Child\n- Sibling', 'Shift+Tab did not realign and save the new bullet');
	});

	test('renders complex mixed-content notes and autosaves their table edits in real VS Code', async function () {
		this.timeout(120_000);
		const fixture = await makeFixture('complex-qa');
		const content = vscode.Uri.joinPath(fixture, 'content');
		await vscode.workspace.fs.copy(vscode.Uri.joinPath(extensionUri, 'test/fixtures/complex-qa'), content);
		for (const name of ['01-research-workbench.md', '02-linked-diagram-atlas.md', '03-long-project-review.md', '04-editing-boundaries.md']) {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			const note = vscode.Uri.joinPath(content, name);
			const original = Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8');
			await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
			const frame = await connectToLivePreviewFrame(name.startsWith('04') ? 'Mixed editing boundaries' : 'Properties');
			let mermaid = false, drawio = false;
			for (let step = 0; step < 150; step++) {
				await delay(100);
				assert.strictEqual(await frame.locator('.mlp-mermaid-error, .mlp-math-error').count(), 0, `${name} has a rendering error`);
				// Rendering diagrams is asynchronous. Do not scroll a newly mounted
				// widget out of the virtual viewport before its first SVG can arrive.
				for (const selector of ['.mlp-mermaid-wrap:not(.mlp-drawio-wrap)', '.mlp-drawio-wrap']) {
					if (await frame.locator(selector).count()) {
						await waitFor(async () => await frame.locator(`${selector} svg`).count() > 0, `${name}: diagram did not finish rendering`);
					}
				}
				mermaid ||= await frame.locator('.mlp-mermaid-wrap:not(.mlp-drawio-wrap) svg').count() > 0;
				drawio ||= await frame.locator('.mlp-drawio-wrap svg').count() > 0;
				const end = await frame.locator('.cm-scroller').evaluate(el => {
					if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) return true;
					el.scrollTop += 400;
					return false;
				});
				if (end) break;
			}
			assert.ok(mermaid && drawio, `${name} must render both diagram types`);
			assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8'), original, 'rendering must not mutate a note');
			if (name.startsWith('04')) {
				await frame.locator('.cm-scroller').evaluate(el => { el.scrollTop = 0; });
				await delay(100);
				const cell = frame.locator('.mlp-table td').first();
				await cell.scrollIntoViewIfNeeded();
				await cell.focus();
				await frame.page().keyboard.press('F2');
				await frame.page().keyboard.type('**Saved QA cell**<br>Second line');
				await frame.page().keyboard.press('Enter');
				await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8').includes('**Saved QA cell**<br>Second line'), 'mixed-content table edit was not automatically saved');
				assert.strictEqual(await cell.locator('strong').textContent(), 'Saved QA cell');
			}
		}
	});

	test('a direct native Markdown Editor request safely routes to Live Preview and saves exact typing', async () => {
		const fixture = await makeFixture('native-exit');
		const note = await service.createNote(fixture, 'Native exit');
		const original = '## Native exit\n\n- Parent\n  - Child\n\n';
		await vscode.workspace.fs.writeFile(note, bytes(original));
		await vscode.commands.executeCommand('vscode.openWith', note, 'default');
		const sourceEditor = vscode.window.activeTextEditor;
		assert.ok(sourceEditor && sourceEditor.document.uri.toString() === note.toString());
		const end = sourceEditor.document.positionAt(original.length);
		sourceEditor.selection = new vscode.Selection(end, end);
		await vscode.commands.executeCommand('type', { text: 'Independent paragraph' });
		await sourceEditor.document.save();
		const beforeRoute = original + 'Independent paragraph';
		await vscode.commands.executeCommand('vscode.openWith', note, 'vscode.markdown.editor', { preview: true });
		await waitFor(() => {
			const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
			const input = tab?.input;
			return input instanceof vscode.TabInputCustom && input.viewType === 'mdLivePreview.editor'
				&& input.uri.toString() === note.toString() && tab?.isPreview === false;
		}, 'the unsafe native Markdown Editor did not route to Live Preview');
		const retainedNative = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
			tab.input instanceof vscode.TabInputCustom && tab.input.uri.toString() === note.toString()
				&& tab.input.viewType === 'vscode.markdown.editor');
		assert.strictEqual(retainedNative.length, 1, 'routing must retain the native tab for an explicit user-controlled close');
		assert.strictEqual(sourceEditor.document.getText(), beforeRoute, 'routing changed the document');
		assert.deepStrictEqual(Buffer.from(await vscode.workspace.fs.readFile(note)), Buffer.from(beforeRoute), 'routing changed disk bytes');
		assert.ok(!sourceEditor.document.isDirty && retainedNative.every(tab => !tab.isDirty), 'the explicit close requires a known-clean working copy');
		// This is the user's explicit close, not a production handoff operation.
		// No typing begins until the clean native view is completely gone.
		assert.strictEqual(await vscode.window.tabGroups.close(retainedNative, true), true);
		await waitFor(() => vscode.window.tabGroups.all.every(group => group.tabs.every(tab =>
			!(tab.input instanceof vscode.TabInputCustom && tab.input.uri.toString() === note.toString()
				&& tab.input.viewType === 'vscode.markdown.editor'))), 'the clean native handoff did not finish');
		const frame = await connectToLivePreviewFrame('Independent paragraph');
		assert.strictEqual(sourceEditor.document.getText(), beforeRoute, 'routing changed the document');
		assert.deepStrictEqual(Buffer.from(await vscode.workspace.fs.readFile(note)), Buffer.from(beforeRoute), 'routing changed disk bytes');
		await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
		await frame.locator('.cm-content').click();
		await frame.page().keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
		assert.ok(await frame.locator('.cm-content').evaluate(element =>
			(element as HTMLElement).isContentEditable && document.hasFocus() && document.activeElement === element),
		'typing requires a focused and editable Live Preview');
		await frame.page().keyboard.type(' continued', { delay: 40 });
		const expected = beforeRoute + ' continued';
		await waitFor(async () => sourceEditor.document.getText() === expected
			&& Buffer.from(await vscode.workspace.fs.readFile(note)).equals(Buffer.from(expected)),
		'Live Preview did not preserve and automatically save every typed character').catch(async error => {
			throw new Error(`${String(error)}; host=${JSON.stringify(sourceEditor.document.getText())}; dirty=${sourceEditor.document.isDirty}; disk=${JSON.stringify(Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8'))}`);
		});
		assert.ok(vscode.window.tabGroups.all.every(group => group.tabs.every(tab =>
			!(tab.input instanceof vscode.TabInputCustom && tab.input.uri.toString() === note.toString()
				&& tab.input.viewType === 'vscode.markdown.editor'))), 'the unsafe native editor remained open');
	});

	test('routing a pinned unsaved native request keeps its working copy and allows explicit saving while autosave is paused', async () => {
		const config = vscode.workspace.getConfiguration('mdLivePreview');
		const previous = config.inspect<boolean>('autoSave')?.globalValue;
		const trace: unknown[] = [];
		const subscriptions: vscode.Disposable[] = [];
		try {
			await config.update('autoSave', false, vscode.ConfigurationTarget.Global);
			const fixture = await makeFixture('native-unsaved');
			const note = await service.createNote(fixture, 'Unsaved native route');
			const original = '# Unsaved route\n\nKeep this original.\n';
			const draft = original + '\n- [ ] Unsaved working copy\n\n**Every character matters.**';
			subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
				if (event.document.uri.toString() === note.toString()) trace.push({ event: 'change', time: Date.now(), version: event.document.version, dirty: event.document.isDirty, changes: event.contentChanges, text: event.document.getText() });
			}), vscode.workspace.onDidCloseTextDocument(document => {
				if (document.uri.toString() === note.toString()) trace.push({ event: 'close', time: Date.now(), version: document.version, text: document.getText() });
			}));
			await vscode.workspace.fs.writeFile(note, bytes(original));
			await vscode.commands.executeCommand('vscode.openWith', note, 'default', { preview: false });
			const editor = vscode.window.activeTextEditor;
			assert.ok(editor && editor.document.uri.toString() === note.toString());
			const end = editor.document.positionAt(original.length);
			editor.selection = new vscode.Selection(end, end);
			await vscode.commands.executeCommand('type', { text: draft.slice(original.length) });
			assert.strictEqual(editor.document.getText(), draft);
			assert.ok(editor.document.isDirty, 'the fixture must be genuinely unsaved');
			assert.deepStrictEqual(Buffer.from(await vscode.workspace.fs.readFile(note)), Buffer.from(original));
			await vscode.commands.executeCommand('vscode.openWith', note, 'vscode.markdown.editor', { preview: false });
			await waitFor(() => {
				const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
				return tab?.input instanceof vscode.TabInputCustom && tab.input.uri.toString() === note.toString()
					&& tab.input.viewType === 'mdLivePreview.editor' && !tab.isPreview;
			}, 'the unsaved pinned note was not safely routed to pinned Live Preview');
			assert.strictEqual(editor.document.getText(), draft, 'routing discarded unsaved content before the renderer became ready');
			const frame = await connectToLivePreviewFrame('Every character matters.').catch(async error => {
				console.log('PINNED_ROUTE_FAILURE', JSON.stringify({ text: editor.document.getText(), dirty: editor.document.isDirty, closed: editor.document.isClosed, version: editor.document.version, disk: Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8'), trace: trace.slice(-10) }));
				throw error;
			});
			assert.strictEqual(editor.document.getText(), draft, 'routing discarded unsaved content');
			assert.ok(editor.document.isDirty, 'routing must not silently save an autosave-disabled note');
			assert.deepStrictEqual(Buffer.from(await vscode.workspace.fs.readFile(note)), Buffer.from(original), 'routing wrote an autosave-disabled note');
			const hasNativeTab = () => vscode.window.tabGroups.all.some(group => group.tabs.some(tab =>
				tab.input instanceof vscode.TabInputCustom && tab.input.uri.toString() === note.toString()
					&& tab.input.viewType === 'vscode.markdown.editor'));
			assert.ok(hasNativeTab(), 'a dirty native tab must be retained rather than risk reverting its shared working copy');
			const page = await getWorkbenchPage();
			await waitFor(async () => /automatic saving.*paused/i.test(await page.locator('.notifications-toasts').innerText()),
				'the user was not warned that automatic saving is paused while the dirty native tab remains');
			await config.update('autoSave', true, vscode.ConfigurationTarget.Global);
			await delay(500);
			assert.ok(hasNativeTab(), 'enabling autosave must not close the dirty native tab');
			assert.strictEqual(editor.document.getText(), draft, 'enabling autosave discarded the retained working copy');
			assert.deepStrictEqual(Buffer.from(await vscode.workspace.fs.readFile(note)), Buffer.from(original), 'autosave must remain paused until the unsafe native view can close safely');
			await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
			await frame.locator('.cm-content').click();
			await frame.page().keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
			await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(note)).equals(Buffer.from(draft)),
				'explicit Save from the safe view did not preserve the retained working copy');
		} finally {
			for (const subscription of subscriptions) subscription.dispose();
			await config.update('autoSave', previous, vscode.ConfigurationTarget.Global);
		}
	});

	test('native requests in two split groups preserve content through explicit clean native-tab closure', async () => {
		const fixture = await makeFixture('native-split');
		const note = await service.createNote(fixture, 'Native split route');
		const original = '# Native split route\n\n- [x] Preserve the same working copy in both groups.\n';
		await vscode.workspace.fs.writeFile(note, bytes(original));
		try {
			await vscode.commands.executeCommand('vscode.openWith', note, 'vscode.markdown.editor', { viewColumn: vscode.ViewColumn.One, preview: false });
			await vscode.commands.executeCommand('vscode.openWith', note, 'vscode.markdown.editor', { viewColumn: vscode.ViewColumn.Two, preview: false });
			await waitFor(() => {
				const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
					tab.input instanceof vscode.TabInputCustom && tab.input.uri.toString() === note.toString());
				return tabs.length === 4 && tabs.every(tab => !tab.isPreview)
					&& tabs.filter(tab => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'mdLivePreview.editor').length === 2
					&& tabs.filter(tab => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'vscode.markdown.editor').length === 2;
			}, 'both split groups must contain safe views and retained native tabs');
			assert.strictEqual((await vscode.workspace.openTextDocument(note)).getText(), original);
			assert.deepStrictEqual(Buffer.from(await vscode.workspace.fs.readFile(note)), Buffer.from(original));
			const retainedNative = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
				tab.input instanceof vscode.TabInputCustom && tab.input.uri.toString() === note.toString()
					&& tab.input.viewType === 'vscode.markdown.editor');
			assert.ok(retainedNative.every(tab => !tab.isDirty));
			assert.strictEqual(await vscode.window.tabGroups.close(retainedNative, true), true);
			await waitFor(() => {
				const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
					tab.input instanceof vscode.TabInputCustom && tab.input.uri.toString() === note.toString());
				return tabs.length === 2 && tabs.every(tab => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'mdLivePreview.editor');
			}, 'explicit clean-tab closure must leave both safe split views');
			assert.strictEqual((await vscode.workspace.openTextDocument(note)).getText(), original);
			assert.deepStrictEqual(Buffer.from(await vscode.workspace.fs.readFile(note)), Buffer.from(original));
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await vscode.commands.executeCommand('workbench.action.joinAllGroups');
		}
	});

	test('one Text Editor picker selection stays in source mode with Markdown Editor as default', async () => {
		const config = vscode.workspace.getConfiguration('mdLivePreview');
		const prior = config.inspect<string>('defaultEditor')?.globalValue;
		try {
			await config.update('defaultEditor', 'markdownEditor', vscode.ConfigurationTarget.Global);
			const fixture = await makeFixture('switch-mode');
			const note = await service.createNote(fixture, 'Switch mode');
			const original = '# Switch mode\n\n- Parent\n  - Child\n';
			await vscode.workspace.fs.writeFile(note, bytes(original));
			const page = await getWorkbenchPage();
			for (let attempt = 0; attempt < 3; attempt++) {
				await vscode.commands.executeCommand('vscode.openWith', note, 'vscode.markdown.editor');
				// openWith returns before the safe replacement finishes loading. Opening
				// a picker during that focus handoff can dismiss it before the click.
				await connectToLivePreviewFrame('Switch mode');
				const retainedNative = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
					tab.input instanceof vscode.TabInputCustom && tab.input.uri.toString() === note.toString()
						&& tab.input.viewType === 'vscode.markdown.editor');
				const document = await vscode.workspace.openTextDocument(note);
				assert.strictEqual(document.getText(), original);
				assert.deepStrictEqual(Buffer.from(await vscode.workspace.fs.readFile(note)), Buffer.from(original));
				assert.ok(retainedNative.length === 1 && !document.isDirty && retainedNative.every(tab => !tab.isDirty));
				// Follow the documented explicit-close workflow before trying another
				// viewing mode; routing deliberately does not close native tabs for us.
				assert.strictEqual(await vscode.window.tabGroups.close(retainedNative, true), true);
				await waitFor(() => {
					const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
					return input instanceof vscode.TabInputCustom && input.viewType === 'mdLivePreview.editor';
				}, 'the safe Live Preview replacement was not ready for a viewing-mode change');
				await page.bringToFront();
				await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
				void vscode.commands.executeCommand('workbench.action.reopenWithEditor');
				const choice = page.locator('.quick-input-widget:visible .quick-input-list .monaco-list-row').filter({ hasText: 'Text Editor' });
				await choice.waitFor({ state: 'visible' });
				await choice.click();
				await waitFor(async () => vscode.window.activeTextEditor?.document.uri.toString() === note.toString(), 'one Text Editor selection did not open source');
				await new Promise(resolve => setTimeout(resolve, 2300));
				assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputText);
				assert.strictEqual(vscode.window.activeTextEditor?.document.getText(), original);
			}
		} finally {
			await config.update('defaultEditor', prior, vscode.ConfigurationTarget.Global);
		}
	});

	test('updates whitespace display live without modifying the note', async () => {
		const config = vscode.workspace.getConfiguration('mdLivePreview');
		const previous = config.inspect<string>('showWhitespace')?.workspaceValue;
		try {
			await config.update('showWhitespace', 'off', vscode.ConfigurationTarget.Workspace);
			const fixture = await makeFixture('whitespace');
			const note = await service.createNote(fixture, 'Whitespace');
			const original = 'Whitespace test\n\nTwo spaces here\n';
			await vscode.workspace.fs.writeFile(note, bytes(original));
			await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
			const frame = await connectToLivePreviewFrame('Whitespace test');
			assert.strictEqual(await frame.locator('.mlp-show-whitespace').count(), 0);
			for (const setting of ['on', 'off', 'on']) {
				await config.update('showWhitespace', setting, vscode.ConfigurationTarget.Workspace);
				await waitFor(async () => await frame.locator('.mlp-show-whitespace').count() === (setting === 'on' ? 1 : 0), 'the display did not follow the whitespace setting');
			}
			assert.strictEqual((await vscode.workspace.openTextDocument(note)).getText(), original);
			assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8'), original);
		} finally {
			await config.update('showWhitespace', previous, vscode.ConfigurationTarget.Workspace);
		}
	});

	test('copies mouse-highlighted table and paragraph text to the system clipboard in both modes', async () => {
		const previousClipboard = await vscode.env.clipboard.readText();
		try {
			const fixture = await makeFixture('mouse-copy');
			const note = await service.createNote(fixture, 'Mouse Copy');
			const original = 'Before mouse copy\n\n| Name | Value |\n| --- | --- |\n| Alpha bravo | Charlie delta |\n\nFollowing paragraph\n';
			await vscode.workspace.fs.writeFile(note, bytes(original));
			await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
			await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
			const frame = await connectToLivePreviewFrame('Before mouse copy');
			for (const mode of ['editing', 'locked']) {
				const toggle = frame.locator('.mlp-editing-mode-toggle');
				if (await toggle.getAttribute('aria-pressed') !== String(mode === 'locked')) await toggle.click();
				const first = await frame.locator('.mlp-table td').first().boundingBox();
				const last = await frame.locator('.cm-line', { hasText: /^Following paragraph$/ }).boundingBox();
				assert.ok(first && last);
				await frame.page().mouse.move(first.x + 12, first.y + first.height / 2);
				await frame.page().mouse.down();
				await frame.page().mouse.move(last.x + 180, last.y + last.height / 2, { steps: 20 });
				await frame.page().mouse.up();
				await vscode.env.clipboard.writeText('clipboard sentinel');
				await frame.page().keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c');
				await waitFor(async () => {
					const copied = await vscode.env.clipboard.readText();
					return copied.includes('bravo') && copied.includes('Following');
				}, `mouse selection was not copied in ${mode} mode`);
			}
			assert.strictEqual((await vscode.workspace.openTextDocument(note)).getText(), original);
			assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8'), original);
		} finally {
			await vscode.env.clipboard.writeText(previousClipboard);
		}
	});

	test('refreshes externally edited, deleted, and recreated draw.io references', async () => {
		const fixture = await makeFixture('diagram-refresh');
		const note = await service.createNote(fixture, 'Diagram refresh');
		const diagram = vscode.Uri.joinPath(fixture, 'sample.drawio');
		const xml = (label: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="${label}" vertex="1" parent="1"><mxGeometry x="0" y="0" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel>`;
		await vscode.workspace.fs.writeFile(diagram, bytes(xml('Original')));
		const markdown = 'Diagram refresh fixture\n\n![](sample.drawio)\n\nAfter\n';
		await vscode.workspace.fs.writeFile(note, bytes(markdown));
		await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
		const frame = await connectToLivePreviewFrame('Diagram refresh fixture');
		await waitFor(async () => (await frame.locator('.mlp-drawio-wrap svg').textContent())?.includes('Original') === true, 'initial diagram did not render');
		await vscode.workspace.fs.writeFile(diagram, bytes(xml('Changed')));
		await waitFor(async () => (await frame.locator('.mlp-drawio-wrap svg').textContent())?.includes('Changed') === true, 'changed diagram stayed cached');
		await vscode.workspace.fs.delete(diagram);
		await waitFor(() => frame.locator('.mlp-mermaid-error').isVisible(), 'deleted diagram stayed visible');
		await vscode.workspace.fs.writeFile(diagram, bytes(xml('Recreated')));
		await waitFor(async () => (await frame.locator('.mlp-drawio-wrap svg').textContent())?.includes('Recreated') === true, 'recreated diagram stayed in error state');
		assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8'), markdown);
	});

	test('cuts mouse-selected table text, autosaves, and restores it with host undo', async () => {
		const previousClipboard = await vscode.env.clipboard.readText();
		try {
			const fixture = await makeFixture('mouse-cut');
			const note = await service.createNote(fixture, 'Cut selection');
			const original = 'Before cut\n\n| Name | Value |\n| --- | --- |\n| Alpha bravo | Charlie delta |\n\nAfter\n';
			await vscode.workspace.fs.writeFile(note, bytes(original));
			await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
			const frame = await connectToLivePreviewFrame('Before cut');
			const bounds = await frame.locator('.mlp-table td').first().boundingBox();
			assert.ok(bounds);
			await frame.page().mouse.move(bounds.x + 12, bounds.y + bounds.height / 2);
			await frame.page().mouse.down();
			await frame.page().mouse.move(bounds.x + 53, bounds.y + bounds.height / 2, { steps: 10 });
			await frame.page().mouse.up();
			await frame.page().keyboard.press(process.platform === 'darwin' ? 'Meta+x' : 'Control+x');
			await waitFor(async () => (await vscode.env.clipboard.readText()).trim() === 'Alpha', 'native Cut copied the wrong text');
			await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8') === original.replace('Alpha', ''),
				'the selected text was not cut and automatically saved');
			await frame.page().keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
			await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8') === original,
				'native Paste did not restore the clipboard text at the cut position');
			const undoChanges: string[] = [];
			const undoListener = vscode.workspace.onDidChangeTextDocument(event => {
				if (event.document.uri.toString() === note.toString()) undoChanges.push(event.document.getText());
			});
			await frame.page().keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
			await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8') === original.replace('Alpha', ''),
				'undo did not remove only the pasted text').catch(async (error) => {
				throw new Error(`${error.message}; changes=${JSON.stringify(undoChanges)}; document=${JSON.stringify((await vscode.workspace.openTextDocument(note)).getText())}; focus=${await frame.evaluate(() => document.activeElement?.outerHTML.slice(0, 500))}`);
			}).finally(() => undoListener.dispose());
			await frame.locator('.cm-line').first().click();
			await frame.page().keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
			await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8') === original,
				'host undo did not restore and automatically save the original table');
			await frame.page().keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y');
			await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8') === original.replace('Alpha', ''),
				'one Redo did not replay only the cut').catch(async (error) => {
				throw new Error(`${error.message}; disk=${JSON.stringify(Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8'))}; document=${JSON.stringify((await vscode.workspace.openTextDocument(note)).getText())}; dirty=${(await vscode.workspace.openTextDocument(note)).isDirty}`);
			});
			await frame.page().keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y');
			await waitFor(async () => Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8') === original,
				'second Redo did not replay the paste');
		} finally {
			await vscode.env.clipboard.writeText(previousClipboard);
		}
	});

	test('folds eight-line code in the actual editor without changing the file', async () => {
		const fixture = await makeFixture('fold-code');
		const note = await service.createNote(fixture, 'Fold code');
		const code = Array.from({ length: 8 }, (_, index) => `fold line ${index + 1}`).join('\n');
		const original = `# Fold code\n\n\`\`\`text\n${code}\n\`\`\`\n\nAfter\n`;
		await vscode.workspace.fs.writeFile(note, bytes(original));
		await vscode.commands.executeCommand('vscode.openWith', note, 'mdLivePreview.editor');
		const frame = await connectToLivePreviewFrame('Fold code');
		await frame.getByRole('button', { name: 'Collapse code block', exact: true }).click();
		await waitFor(async () => await frame.getByRole('button', { name: 'Expand code block', exact: true }).count() === 1,
			'the folded block did not expose one expand control');
		assert.ok(!(await frame.locator('.cm-content').textContent())?.includes('fold line 8'));
		await frame.getByRole('button', { name: 'Expand code block', exact: true }).press('Enter');
		await waitFor(async () => (await frame.locator('.cm-content').textContent())?.includes('fold line 8') === true,
			'keyboard expansion did not restore the last code line');
		assert.strictEqual((await vscode.workspace.openTextDocument(note)).getText(), original);
		assert.strictEqual(Buffer.from(await vscode.workspace.fs.readFile(note)).toString('utf8'), original);
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
			await waitFor(async () => (await frame.locator('.mlp-copy-code-btn').textContent()) === '✓',
				'the host clipboard acknowledgment did not update the copy control');
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
		await frame.page().keyboard.insertText(inserted);
		await waitFor(() => document.getText().includes(inserted), 'desktop keyboard input did not reach Live Preview');
		const edited = document.getText();
		assert.notStrictEqual(edited, original);
		await waitFor(async () => new TextDecoder().decode(await vscode.workspace.fs.readFile(note)) === edited,
			'Live Preview input did not autosave');

		const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
		await frame.page().keyboard.press(`${primaryModifier}+z`);
		await waitFor(() => document.getText() === original, 'the platform undo shortcut did not undo the Live Preview edit');
		const redoShortcut = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';
		await frame.page().keyboard.press(redoShortcut);
		await waitFor(() => document.getText() === edited, 'the platform redo shortcut did not redo the Live Preview edit');

		await frame.page().keyboard.press(`${primaryModifier}+s`);
		await waitFor(() => !document.isDirty, 'the platform save shortcut did not save the Live Preview document');
		await waitFor(async () => new TextDecoder().decode(await vscode.workspace.fs.readFile(note)) === edited,
			'the redo/save operation did not reach disk');

		const external = '# External Live Preview update\n';
		await document.save();
		await vscode.workspace.fs.writeFile(note, bytes(external));
		await waitFor(() => document.getText() === external, 'the TextDocument did not receive the external file change').catch(async error => {
			throw new Error(`${String(error)}; dirty=${document.isDirty}; document=${JSON.stringify(document.getText())}; disk=${JSON.stringify(new TextDecoder().decode(await vscode.workspace.fs.readFile(note)))}`);
		});
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
					try {
						const editor = frame.locator('.cm-content');
						if (await editor.count() === 0) continue;
						if (!expectedText || (await editor.textContent())?.includes(expectedText)) return frame;
					} catch (error) {
						// A settings reload or native-to-safe editor transition can detach
						// a candidate between discovery and inspection. Only retry that race.
						if (!frame.isDetached() && !/frame was detached|frame has been detached|execution context was destroyed/i.test(String(error))) throw error;
					}
				}
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	assert.fail('could not find the active Live Preview CodeMirror frame');
}

async function connectToFrameWith(selector: string): Promise<Frame> {
	const browser = await connectToDebugBrowser();
	let found: Frame | undefined;
	await waitFor(async () => {
		for (const page of browser.contexts().flatMap(context => context.pages())) {
			for (const frame of page.frames()) {
				if (!frame.isDetached() && await frame.locator(selector).count()) { found = frame; return true; }
			}
		}
		return false;
	}, `could not find UI frame ${selector}`, 10_000);
	return found!;
}

async function expandOnlySidebarPane(page: Page, title: string): Promise<void> {
	const headers = page.locator('#workbench\\.parts\\.sidebar .pane-header:visible');
	for (let i = 0; i < await headers.count(); i++) {
		const header = headers.nth(i);
		const wanted = (await header.textContent())?.includes(title);
		if ((await header.getAttribute('aria-expanded') === 'true') !== Boolean(wanted)) {
			await header.focus();
			await page.keyboard.press('Enter');
		}
	}
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
